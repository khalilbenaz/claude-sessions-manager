'use strict';
const $ = s => document.querySelector(s);
const TOKEN = window.CSM_TOKEN;
const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
const LS = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

const sessions = new Map(); // id -> public view
const terms = new Map();    // id -> { term, fit, el }
let active = LS.get('csm.active', null);
let ws = null;
let historyCache = [];

const STATUS_LABEL = { starting: 'démarrage', working: 'travaille', attention: 'attend une réponse', idle: 'prêt', exited: 'arrêtée' };

async function api(method, url, body) {
  const r = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json', 'X-CSM-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// ------------------------------------------------------------------ terminaux
function ensureTerm(id) {
  if (terms.has(id)) return terms.get(id);
  const el = document.createElement('div');
  el.className = 'term';
  $('#terms').appendChild(el);
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace', fontSize: LS.get('csm.font', 14),
    cursorBlink: true, scrollback: 10000, allowProposedApi: true, macOptionIsMeta: true,
    theme: { background: '#101114', foreground: '#e6e6e6', cursor: '#d97757', selectionBackground: '#3a4150' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => window.open(uri, '_blank')));
  term.open(el);
  term.onData(d => send({ t: 'input', id, d }));
  // Images / fichiers : glisser-déposer ou coller → copie enregistrée par le serveur, chemin collé dans Claude.
  el.addEventListener('dragover', e => { if (hasFiles(e.dataTransfer)) { e.preventDefault(); el.classList.add('dropping'); } });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('dropping'); });
  el.addEventListener('drop', e => {
    el.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    attachFiles(id, files);
  });
  el.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (!files.length) return; // texte : xterm s'en charge
    e.preventDefault(); e.stopImmediatePropagation();
    attachFiles(id, files);
  }, true); // phase de capture : avant le gestionnaire de xterm, qui ne garderait que le texte
  term.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && e.altKey && globalShortcut(e)) return false;
    // Windows : Ctrl+C avec sélection = copier ; Ctrl+V = coller (texte) via le presse-papiers du navigateur.
    // macOS : Cmd+C / Cmd+V sont natifs ; Ctrl+C et Ctrl+V restent à Claude (interrompre, coller une image).
    if (!IS_MAC && e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false;
    }
    if (!IS_MAC && e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') return false; // laisse l'événement paste natif
    if ((IS_MAC ? e.metaKey : e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) { zoom(e.key); e.preventDefault(); return false; }
    return true;
  });
  const t = { term, fit, el };
  terms.set(id, t);
  return t;
}

function zoom(k) {
  let size = LS.get('csm.font', 14);
  size = k === '0' ? 14 : Math.max(9, Math.min(28, size + (k === '-' ? -1 : 1)));
  LS.set('csm.font', size);
  for (const t of terms.values()) t.term.options.fontSize = size;
  fitActive();
}

// redraw=true : force Claude à repeindre tout l'écran (le PTY ne signale un resize que si la taille change,
// d'où l'aller-retour rows-1 → rows). Nécessaire après un changement de session ou une reconnexion,
// car le terminal caché a reçu la sortie à une autre taille.
function fitActive(redraw) {
  const id = active, t = id && terms.get(id);
  if (!t || !t.el.classList.contains('show')) return;
  try { t.fit.fit(); } catch { }
  const { cols, rows } = t.term;
  if (!redraw && t.sent === `${cols}x${rows}`) return;
  t.sent = `${cols}x${rows}`;
  if (redraw) send({ t: 'resize', id, cols, rows: rows - 1 });
  setTimeout(() => send({ t: 'resize', id, cols, rows }), redraw ? 80 : 0);
  t.term.refresh(0, rows - 1);
}
new ResizeObserver(() => requestAnimationFrame(() => fitActive(false))).observe($('#terms'));
let redrawTimer = null;
function scheduleRedraw() { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => fitActive(true), 150); }

// ------------------------------------------------------------------ WebSocket
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?token=${TOKEN}`);
  ws.onopen = () => $('#conn').classList.remove('off');
  ws.onclose = () => { $('#conn').classList.add('off'); setTimeout(connect, 1500); };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'sessions') {
      const ids = new Set(m.list.map(s => s.id));
      for (const id of [...sessions.keys()]) if (!ids.has(id)) removeLocal(id);
      for (const s of m.list) { sessions.set(s.id, s); const t = ensureTerm(s.id); t.term.reset(); }
      if (!sessions.has(active)) active = sorted()[0]?.id || null;
      render(); select(active);
    } else if (m.t === 'replay' || m.t === 'out') {
      ensureTerm(m.id).term.write(m.d);
      if (m.t === 'out' && m.id !== active) bump(m.id);
      if (m.t === 'replay' && m.id === active) scheduleRedraw();
    } else if (m.t === 'clear') {
      terms.get(m.id)?.term.reset();
    } else if (m.t === 'session') {
      const prev = sessions.get(m.s.id);
      sessions.set(m.s.id, m.s);
      ensureTerm(m.s.id);
      notifyTransition(prev, m.s);
      render();
      if (!active) select(m.s.id);
      if (m.s.id === active) renderBar();
    } else if (m.t === 'removed') {
      removeLocal(m.id);
      if (active === m.id) active = sorted()[0]?.id || null;
      render(); select(active);
    }
  };
}

function removeLocal(id) {
  sessions.delete(id);
  const t = terms.get(id);
  if (t) { t.term.dispose(); t.el.remove(); terms.delete(id); }
}

const unread = new Set();
function bump(id) { if (!unread.has(id)) { unread.add(id); render(); } }

// ------------------------------------------------------------------ notifications
function notifyTransition(prev, s) {
  if (!prev || prev.status === s.status) return;
  const focused = document.hasFocus() && s.id === active;
  const important = s.status === 'attention' || (s.status === 'idle' && prev.status === 'working');
  if (!important || focused) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(`${s.name} — ${s.status === 'attention' ? 'attend une réponse' : 'terminé'}`, {
      body: s.message || s.cwd, tag: s.id, icon: 'icon.svg', silent: false,
    });
    n.onclick = () => { window.focus(); select(s.id); n.close(); };
  }
}

// ------------------------------------------------------------------ rendu
function sorted() { return [...sessions.values()].sort((a, b) => (a.order || 0) - (b.order || 0)); }

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.floor(s)}s`; if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}j`;
}

function render() {
  const ul = $('#list');
  ul.innerHTML = '';
  sorted().forEach((s, i) => {
    const li = document.createElement('li');
    li.className = `${s.id === active ? 'active' : ''} ${s.status}`;
    li.draggable = true;
    li.dataset.id = s.id;
    li.title = `${s.cwd}\n${STATUS_LABEL[s.status] || s.status}${s.message ? ' — ' + s.message : ''}`;
    li.innerHTML = `<span class="dot ${s.status}"></span><span class="n"></span><span class="acts"><button class="ren" title="Renommer">✎</button><span class="k">${i < 9 ? i + 1 : ''}${unread.has(s.id) && s.id !== active ? ' •' : ''}</span></span><span class="sub"></span>`;
    li.querySelector('.n').textContent = s.name;
    li.querySelector('.sub').textContent = `${STATUS_LABEL[s.status] || s.status}${s.message && s.status !== 'working' ? ' · ' + s.message : ''} · ${ago(s.statusSince)}`;
    li.onclick = () => select(s.id);
    li.ondblclick = () => renameSession(s.id);
    li.querySelector('.ren').onclick = e => { e.stopPropagation(); renameSession(s.id); };
    li.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); sessionMenu(s.id, e.clientX, e.clientY); };
    li.ondragstart = e => e.dataTransfer.setData('text/plain', s.id);
    li.ondragover = e => { e.preventDefault(); li.classList.add('dragover'); };
    li.ondragleave = () => li.classList.remove('dragover');
    li.ondrop = e => {
      e.preventDefault(); li.classList.remove('dragover');
      const from = e.dataTransfer.getData('text/plain'); if (!from || from === s.id) return;
      const ids = sorted().map(x => x.id).filter(x => x !== from);
      ids.splice(ids.indexOf(s.id), 0, from);
      api('POST', '/api/order', { ids });
    };
    ul.appendChild(li);
  });
  const attn = [...sessions.values()].filter(s => s.status === 'attention').length;
  document.title = attn ? `(${attn}) Claude Sessions` : 'Claude Sessions';
  document.body.classList.toggle('nosession', sessions.size === 0);
  renderBar();
}
setInterval(render, 15000);

function renderBar() {
  const s = sessions.get(active);
  if (!s) return;
  $('#curDot').className = `dot ${s.status}`;
  $('#curName').textContent = s.name;
  $('#curCwd').textContent = s.cwd;
  $('#curCwd').title = s.cwd + (s.claudeSessionId ? `\nsession ${s.claudeSessionId}` : '');
  $('#curMsg').textContent = `${STATUS_LABEL[s.status] || s.status}${s.message ? ' — ' + s.message : ''}`;
  $('#curMsg').className = `msg ${s.status}`;
  $('#btnKill').disabled = !s.alive;
  $('#btnRestart').textContent = s.alive ? 'Relancer' : (s.claudeSessionId ? 'Reprendre' : 'Relancer');
}

function select(id) {
  if (!id || !sessions.has(id)) { active = null; LS.set('csm.active', null); render(); return; }
  active = id; LS.set('csm.active', id);
  unread.delete(id);
  for (const [k, t] of terms) t.el.classList.toggle('show', k === id);
  render();
  requestAnimationFrame(() => { fitActive(true); terms.get(id)?.term.focus(); });
  const s = sessions.get(id);
  if (s && (s.status === 'attention' || (s.status === 'idle' && s.message === 'terminé'))) api('POST', `/api/sessions/${id}/seen`).catch(() => { });
}

// ------------------------------------------------------------------ actions
// Boîte « Renommer » commune (barre, liste, menu clic droit, historique, Ctrl+Alt+R).
function askName(title, current) {
  const dlg = $('#dlgRename'), input = $('#renInput');
  $('#renTitle').textContent = title;
  input.value = current || '';
  dlg.returnValue = '';
  dlg.showModal();
  input.select();
  return new Promise(resolve => dlg.addEventListener('close', () => {
    const v = input.value.trim();
    resolve(dlg.returnValue === 'ok' && v && v !== current ? v : null);
    terms.get(active)?.term.focus();
  }, { once: true }));
}

async function renameSession(id) {
  const s = sessions.get(id); if (!s) return;
  const name = await askName('Renommer la session', s.name);
  if (!name) return;
  try { const v = await api('POST', `/api/sessions/${id}/rename`, { name }); sessions.set(id, v); render(); }
  catch (e) { alert(`Renommage impossible : ${e.message}`); }
}
function startRename() { if (active) renameSession(active); }
$('#curName').ondblclick = startRename;
$('#btnRename').onclick = startRename;

// ------------------------------------------------------------------ menu clic droit
// Menu propre à l'application partout : le menu du navigateur n'apparaît jamais.
// Entrée = [libellé, action, { kbd, danger, disabled }] ; '-' = séparateur.
// popover : passe au-dessus des boîtes de dialogue modales (top layer).
const MOD = IS_MAC ? '⌘' : 'Ctrl';
function showMenu(items, x, y) {
  const menu = $('#ctx');
  // Une boîte modale rend inerte tout ce qui est hors d'elle : le menu doit vivre dedans pour être cliquable.
  const host = document.querySelector('dialog[open]') || document.body;
  if (menu.parentElement !== host) { hideMenu(); host.appendChild(menu); }
  menu.innerHTML = '';
  for (const it of items.filter((it, i, a) => it !== '-' || (i > 0 && a[i - 1] !== '-' && i < a.length - 1))) {
    if (it === '-') { menu.appendChild(document.createElement('hr')); continue; }
    const [label, fn, o = {}] = it;
    const b = document.createElement('button');
    b.innerHTML = '<span></span><kbd></kbd>';
    b.firstChild.textContent = label;
    b.lastChild.textContent = o.kbd || '';
    if (o.danger) b.className = 'danger';
    b.disabled = !!o.disabled;
    b.onclick = () => { hideMenu(); fn(); };
    menu.appendChild(b);
  }
  if (!menu.matches(':popover-open')) menu.showPopover();
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 6))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 6))}px`;
}
function hideMenu() { const m = $('#ctx'); if (m.matches(':popover-open')) m.hidePopover(); }
$('#ctx').addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const bs = [...$('#ctx').querySelectorAll('button:not(:disabled)')]; if (!bs.length) return;
  const i = bs.indexOf(document.activeElement);
  bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
  e.preventDefault();
});

const clip = {
  copy: t => navigator.clipboard.writeText(t).catch(() => { }),
  read: () => navigator.clipboard.readText().catch(() => ''),
  // Images du presse-papiers (menu « Coller ») ; [] si refusé ou sans image.
  async images() {
    try {
      const out = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) out.push(new File([await item.getType(type)], `image.${type.split('/')[1].replace('jpeg', 'jpg')}`, { type }));
      }
      return out;
    } catch { return []; }
  },
};

const hasFiles = dt => !!dt && [...dt.types].includes('Files');

let pickTarget = null;
function pickFiles(id) { pickTarget = id; $('#fileInput').value = ''; $('#fileInput').click(); }
$('#fileInput').onchange = () => { const f = [...$('#fileInput').files]; if (f.length && pickTarget) attachFiles(pickTarget, f); };
$('#btnAttach').onclick = () => active && pickFiles(active);

async function uploadFile(file) {
  const r = await fetch('/api/upload', {
    method: 'POST', body: file,
    headers: { 'X-CSM-Token': TOKEN, 'X-Filename': encodeURIComponent(file.name || 'image.png'), 'Content-Type': 'application/octet-stream' },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j.path;
}

// Colle les chemins comme le ferait un terminal après un glisser-déposer : Claude détecte les images et les attache.
async function attachFiles(id, files) {
  const t = terms.get(id); if (!t) return;
  toast(`Envoi de ${files.length > 1 ? `${files.length} fichiers` : `« ${files[0].name || 'image'} »`}…`);
  try {
    const paths = [];
    for (const f of files) paths.push(await uploadFile(f));
    const quoted = paths.map(p => (/\s/.test(p) ? `"${p}"` : p));
    t.term.paste(quoted.join(' ') + ' ');
    toast(files.length > 1 ? `${files.length} fichiers ajoutés` : 'Ajouté — il sera envoyé avec ton message');
  } catch (e) { toast(`Échec : ${e.message}`, true); }
  t.term.focus();
}

let toastTimer = null;
function toast(msg, error) {
  const el = $('#toast');
  el.textContent = msg; el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'toast'; }, error ? 5000 : 2500);
}

// Déposer un fichier ailleurs que sur un terminal ne doit pas faire quitter la page.
window.addEventListener('dragover', e => { if (hasFiles(e.dataTransfer)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e.dataTransfer)) return;
  e.preventDefault();
  if (active && !e.target.closest('.term')) attachFiles(active, [...e.dataTransfer.files]);
});

function sessionItems(id) {
  const s = sessions.get(id); if (!s) return [];
  return [
    ['Renommer', () => renameSession(id), { kbd: id === active ? `${MOD}+Alt+R` : '' }],
    [s.alive ? 'Relancer' : 'Reprendre', () => api('POST', `/api/sessions/${id}/restart`)],
    ['Arrêter', () => api('POST', `/api/sessions/${id}/kill`), { disabled: !s.alive }],
    ['Copier le chemin', () => clip.copy(s.cwd)],
    ...(s.claudeSessionId ? [['Copier l’identifiant de session', () => clip.copy(s.claudeSessionId)]] : []),
    '-',
    ['Fermer', () => { select(id); $('#btnClose').click(); }, { danger: true, kbd: id === active ? `${MOD}+Alt+W` : '' }],
  ];
}
// Menu clic droit sur une session de la liste.
function sessionMenu(id, x, y) { showMenu(sessionItems(id), x, y); }

function terminalItems(id) {
  const t = terms.get(id); if (!t) return [];
  const { term } = t;
  return [
    ['Copier', () => { clip.copy(term.getSelection()); term.clearSelection(); term.focus(); }, { disabled: !term.hasSelection(), kbd: IS_MAC ? '⌘C' : 'Ctrl+C' }],
    ['Coller', async () => {
      const imgs = await clip.images();
      if (imgs.length) return attachFiles(id, imgs);
      const txt = await clip.read(); if (txt) term.paste(txt); term.focus();
    }, { kbd: IS_MAC ? '⌘V' : 'Ctrl+V' }],
    ['Joindre un fichier…', () => pickFiles(id)],
    ['Tout sélectionner', () => term.selectAll()],
    ['Effacer l’écran', () => { term.clear(); term.focus(); }],
    '-',
    ['Zoom avant', () => zoom('+'), { kbd: `${MOD}+=` }],
    ['Zoom arrière', () => zoom('-'), { kbd: `${MOD}+-` }],
    ['Taille normale', () => zoom('0'), { kbd: `${MOD}+0` }],
    '-',
    ...sessionItems(id),
  ];
}

function fieldItems(el) {
  const ro = el.readOnly || el.disabled;
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
  const put = txt => { el.focus(); el.setRangeText(txt, a, b, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); };
  return [
    ['Couper', () => { clip.copy(el.value.slice(a, b)); put(''); }, { disabled: ro || b <= a, kbd: `${MOD}+X` }],
    ['Copier', () => { clip.copy(el.value.slice(a, b)); el.focus(); }, { disabled: b <= a, kbd: `${MOD}+C` }],
    ['Coller', async () => put(await clip.read()), { disabled: ro, kbd: `${MOD}+V` }],
    '-',
    ['Tout sélectionner', () => { el.focus(); el.select(); }, { kbd: `${MOD}+A` }],
  ];
}

function appItems() {
  return [
    ['Nouvelle session', openNew, { kbd: `${MOD}+Alt+N` }],
    ['Historique', openHistory, { kbd: `${MOD}+Alt+H` }],
    '-',
    ['Recharger la fenêtre', () => location.reload(), { kbd: 'F5' }],
  ];
}

document.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (e.target.closest('#ctx')) return;
  const x = e.clientX, y = e.clientY, tg = e.target;
  const field = tg.closest('input, textarea');
  if (field && !['checkbox', 'radio', 'button', 'submit'].includes(field.type)) return showMenu(fieldItems(field), x, y);
  const termEl = tg.closest('.term');
  if (termEl) { const id = [...terms].find(([, t]) => t.el === termEl)?.[0]; if (id) return showMenu(terminalItems(id), x, y); }
  const sel = String(getSelection() || '');
  const pageCopy = sel ? [['Copier', () => clip.copy(sel), { kbd: `${MOD}+C` }], '-'] : [];
  if (tg.closest('dialog')) { if (sel) showMenu(pageCopy, x, y); else hideMenu(); return; }
  if (tg.closest('#bar') && active) return showMenu([...pageCopy, ...sessionItems(active)], x, y);
  showMenu([...pageCopy, ...appItems()], x, y);
});

// Entrée dans un champ = bouton principal (sinon le navigateur valide le 1er bouton du formulaire : « Annuler »).
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.target.tagName !== 'INPUT') return;
  const form = e.target.closest('dialog form');
  const ok = form && form.querySelector('button.primary[value]');
  if (!ok) return;
  e.preventDefault();
  form.requestSubmit(ok); // respecte la validation (ex. dossier obligatoire)
}, true);
document.addEventListener('mousedown', e => { if (!$('#ctx').contains(e.target)) hideMenu(); }, true);
// Échap ferme le menu sans fermer la boîte de dialogue en dessous.
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#ctx').matches(':popover-open')) { hideMenu(); e.stopPropagation(); e.preventDefault(); } }, true);
window.addEventListener('blur', hideMenu);
window.addEventListener('resize', hideMenu);
for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', hideMenu);

$('#btnRestart').onclick = () => active && api('POST', `/api/sessions/${active}/restart`);
$('#btnKill').onclick = () => active && api('POST', `/api/sessions/${active}/kill`);
$('#btnClose').onclick = () => {
  const s = sessions.get(active); if (!s) return;
  if (s.alive && !confirm(`Fermer « ${s.name} » ? Le processus Claude sera arrêté (la conversation reste reprenable depuis l'historique).`)) return;
  api('DELETE', `/api/sessions/${active}`);
};

async function loadHistory() {
  try { historyCache = await api('GET', '/api/history'); } catch { historyCache = []; }
  const dirs = [...new Set([...sessions.values()].map(s => s.cwd).concat(historyCache.map(h => h.cwd)).filter(Boolean))];
  $('#dirs').innerHTML = '';
  for (const d of dirs.slice(0, 60)) { const o = document.createElement('option'); o.value = d; $('#dirs').appendChild(o); }
}

function openNew() {
  const f = $('#formNew');
  f.reset();
  f.cwd.value = LS.get('csm.lastCwd', '') || sessions.get(active)?.cwd || '';
  loadHistory();
  $('#dlgNew').showModal();
  f.cwd.select();
}
$('#btnNew').onclick = openNew;
$('#btnBrowse').onclick = async () => {
  const f = $('#formNew'), btn = $('#btnBrowse');
  btn.disabled = true; btn.textContent = 'Ouverture…';
  try {
    const { path } = await api('POST', '/api/pick-folder', { initial: f.cwd.value.trim() });
    if (path) {
      f.cwd.value = path;
      if (!f.name.value.trim()) f.name.placeholder = path.split(/[\\/]/).filter(Boolean).pop() || '(nom du dossier)';
    }
  } catch (e) { alert(`Sélecteur indisponible : ${e.message}`); }
  finally { btn.disabled = false; btn.textContent = 'Parcourir…'; f.cwd.focus(); }
};
$('#dlgNew').addEventListener('close', async () => {
  if ($('#dlgNew').returnValue !== 'ok') return;
  const f = $('#formNew');
  const args = [f.model.value && `--model ${f.model.value}`, f.mode.value && `--permission-mode ${f.mode.value}`, f.extra.value.trim()].filter(Boolean).join(' ');
  const cwd = f.cwd.value.trim().replace(/^"|"$/g, '');
  LS.set('csm.lastCwd', cwd);
  const s = await api('POST', '/api/sessions', { cwd, name: f.name.value.trim() || undefined, args });
  sessions.set(s.id, s); ensureTerm(s.id); select(s.id);
  askNotify();
});

// ------------------------------------------------------------------ historique
let histSel = 0;
function renderHistory() {
  const q = $('#histSearch').value.toLowerCase().trim();
  const items = historyCache.filter(h => !q || `${h.title} ${h.cwd} ${h.lastPrompt} ${h.branch || ''}`.toLowerCase().includes(q)).slice(0, 200);
  histSel = Math.min(histSel, Math.max(0, items.length - 1));
  const ul = $('#histList'); ul.innerHTML = '';
  items.forEach((h, i) => {
    const li = document.createElement('li');
    if (i === histSel) li.classList.add('sel');
    li.innerHTML = `<span class="t"></span><span class="d"></span><span class="c"></span><span class="d"></span><span class="p"></span>`;
    const [t, d1, c, d2, p] = li.children;
    t.textContent = h.title;
    if (h.managed) t.insertAdjacentHTML('beforeend', '<span class="tag">ouverte</span>');
    const ren = document.createElement('button');
    ren.className = 'ren'; ren.textContent = '✎'; ren.title = 'Renommer';
    ren.onclick = e => { e.stopPropagation(); renameHistory(h); };
    t.prepend(ren);
    d1.textContent = new Date(h.mtime).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    c.textContent = h.cwd || '';
    d2.textContent = h.branch || '';
    p.textContent = h.lastPrompt;
    li.onclick = () => resumeHistory(h);
    li.oncontextmenu = e => {
      e.preventDefault(); e.stopPropagation();
      histSel = i; [...ul.children].forEach((x, j) => x.classList.toggle('sel', j === i));
      showMenu([
        [h.managed ? 'Afficher' : 'Reprendre', () => resumeHistory(h), { kbd: 'Entrée' }],
        ['Renommer', () => renameHistory(h)],
        '-',
        ['Copier le chemin', () => clip.copy(h.cwd || ''), { disabled: !h.cwd }],
        ['Copier l’identifiant de session', () => clip.copy(h.id)],
      ], e.clientX, e.clientY);
    };
    ul.appendChild(li);
  });
  ul.children[histSel]?.scrollIntoView({ block: 'nearest' });
  return items;
}
async function renameHistory(h) {
  const name = await askName('Renommer la conversation', h.title);
  $('#histSearch').focus();
  if (!name) return;
  try { await api('POST', `/api/history/${h.id}/rename`, { name }); h.title = name; renderHistory(); }
  catch (err) { alert(`Renommage impossible : ${err.message}`); }
}
async function openHistory() {
  $('#histSearch').value = ''; histSel = 0;
  $('#histList').innerHTML = '<li><span class="t">Chargement…</span></li>';
  $('#dlgHistory').showModal();
  $('#histSearch').focus();
  await loadHistory();
  renderHistory();
}
async function resumeHistory(h) {
  $('#dlgHistory').close();
  const existing = [...sessions.values()].find(s => s.claudeSessionId === h.id);
  if (existing) { select(existing.id); if (!existing.alive) api('POST', `/api/sessions/${existing.id}/restart`); return; }
  const s = await api('POST', '/api/sessions', { cwd: h.cwd, name: h.title.slice(0, 40), resume: h.id });
  sessions.set(s.id, s); ensureTerm(s.id); select(s.id);
}
$('#btnHistory').onclick = openHistory;
$('#histClose').onclick = () => $('#dlgHistory').close();
$('#histSearch').oninput = () => { histSel = 0; renderHistory(); };
$('#histSearch').onkeydown = e => {
  if (e.key === 'ArrowDown') { histSel++; renderHistory(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { histSel = Math.max(0, histSel - 1); renderHistory(); e.preventDefault(); }
  else if (e.key === 'Enter') { const it = renderHistory()[histSel]; if (it) resumeHistory(it); }
};
$('#dlgHistory').addEventListener('close', () => terms.get(active)?.term.focus());

// ------------------------------------------------------------------ sessions ouvertes dans un terminal
let external = [];
async function refreshExternal() {
  try { external = await api('GET', '/api/external'); } catch { return; }
  $('#ext').hidden = external.length === 0;
  $('#extCount').textContent = external.length ? `(${external.length})` : '';
  const ul = $('#extList'); ul.innerHTML = '';
  for (const x of external) {
    const li = document.createElement('li');
    li.title = `${x.cwd}\nPID ${x.pid} · ${x.status === 'busy' ? 'travaille' : 'prête'}\nCliquer pour la ramener dans csm`;
    li.innerHTML = `<span class="dot ${x.status === 'busy' ? 'working' : 'idle'}"></span><span class="n"></span><span class="k">ramener</span><span class="sub"></span>`;
    li.querySelector('.n').textContent = x.title;
    li.querySelector('.sub').textContent = x.cwd;
    li.onclick = () => importExternal([x]);
    li.oncontextmenu = e => {
      e.preventDefault(); e.stopPropagation();
      showMenu([
        ['Ramener dans csm…', () => importExternal([x])],
        ['Copier le chemin', () => clip.copy(x.cwd)],
      ], e.clientX, e.clientY);
    };
    ul.appendChild(li);
  }
}
async function importExternal(items) {
  const busy = items.filter(x => x.status === 'busy');
  $('#impTitle').textContent = items.length > 1 ? `Ramener ${items.length} sessions dans csm` : `Ramener « ${items[0].title} »`;
  $('#impWarn').hidden = !busy.length;
  $('#impWarn').textContent = `⚠ ${busy.length > 1 ? `${busy.length} sessions travaillent` : 'Cette session travaille'} en ce moment : « Déplacer » interrompt la tâche en cours (tu pourras la relancer dans csm). « Copier » ne l'interrompt pas.`;
  const dlg = $('#dlgImport');
  dlg.returnValue = '';
  dlg.showModal();
  const mode = await new Promise(r => dlg.addEventListener('close', () => r(dlg.returnValue), { once: true }));
  if (mode !== 'move' && mode !== 'copy') return;
  $('#btnImportAll').disabled = true;
  try {
    const r = await api('POST', '/api/import', { items, mode });
    for (const s of r.done) { sessions.set(s.id, s); ensureTerm(s.id); }
    if (r.done[0]) select(r.done[0].id);
    if (r.errors.length) alert(r.errors.join('\n'));
  } catch (e) { alert(e.message); }
  finally { $('#btnImportAll').disabled = false; refreshExternal(); }
}
$('#btnImportAll').onclick = () => external.length && importExternal(external);
setInterval(refreshExternal, 5000);
refreshExternal();

// ------------------------------------------------------------------ raccourcis
function globalShortcut(e) {
  if (document.querySelector('dialog[open]')) return false; // pas de raccourci pendant une saisie
  const k = e.key.toLowerCase();
  const list = sorted();
  const idx = list.findIndex(s => s.id === active);
  if (k === 'n') { openNew(); return true; }
  if (k === 'h') { openHistory(); return true; }
  if (k === 'r') { startRename(); return true; }
  if (k === 'w') { $('#btnClose').click(); return true; }
  // Chiffres par touche physique (AZERTY : 1 = « & »). Un caractère AltGr (@ # { [ | \ ^ ] }) n'est pas un raccourci.
  const digit = /^Digit[1-9]$/.test(e.code) && (/^[0-9&é"'(\-è_çà]$/.test(e.key)) ? +e.code.slice(5) : 0;
  if (digit) { if (list[digit - 1]) select(list[digit - 1].id); return true; }
  if (e.key === 'ArrowDown' && list.length) { select(list[(idx + 1) % list.length].id); return true; }
  if (e.key === 'ArrowUp' && list.length) { select(list[(idx - 1 + list.length) % list.length].id); return true; }
  if (k === 'a') { const a = list.find(s => s.status === 'attention' && s.id !== active); if (a) select(a.id); return true; }
  return false;
}
document.addEventListener('keydown', e => { if (e.ctrlKey && e.altKey && globalShortcut(e)) e.preventDefault(); });

function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}
document.addEventListener('click', askNotify, { once: true });

connect();
