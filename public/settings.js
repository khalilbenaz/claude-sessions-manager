'use strict';
// Réglages (#6), modèles de session (#14), diagnostic (#7), journaux (#23), mises à jour (#3), assistant (#25).
(() => {
  const F = window.csmFeatures;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const dlg = $('#dlgSettings');

  function page(name) {
    dlg.querySelectorAll('.setNav [data-st]').forEach(b => b.classList.toggle('on', b.dataset.st === name));
    dlg.querySelectorAll('.setPages > section').forEach(s => { s.hidden = s.dataset.st !== name; });
    if (name === 'diag') loadDiag();
    if (name === 'logs') loadLogs();
    if (name === 'templates') renderTemplates();
    if (name === 'about') renderAbout();
  }
  dlg.querySelectorAll('.setNav [data-st]').forEach(b => { b.onclick = () => page(b.dataset.st); });
  $('#setClose').onclick = () => dlg.close();
  dlg.addEventListener('close', () => terms.get(active)?.term.focus());

  // Champs data-set="clé" liés aux réglages du serveur, enregistrés à chaque changement.
  function fill() {
    dlg.querySelectorAll('[data-set]').forEach(el => {
      const v = SETTINGS[el.dataset.set];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    });
    $('#editorCmdRow').hidden = SETTINGS.editor !== 'custom';
  }
  dlg.querySelectorAll('[data-set]').forEach(el => {
    el.addEventListener('change', () => {
      const k = el.dataset.set;
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      saveSettings({ [k]: v });
      if (k === 'editor') $('#editorCmdRow').hidden = v !== 'custom';
      if (k === 'fontSize') { LS.set('csm.font', v); for (const tt of terms.values()) tt.term.options.fontSize = v; fitAll(); }
      if (k === 'notifications' && v && 'Notification' in window) Notification.requestPermission();
      if (k === 'lang') setTimeout(() => location.reload(), 300);
    });
  });
  $('#soundTest').onclick = () => playSound($('[data-set=sound]').value);

  F.openSettings = async (which = 'general') => {
    fill();
    try {
      const eds = await api('GET', '/api/editors');
      const sel = $('#setEditor');
      sel.innerHTML = `<option value="auto">${t('Automatique')}</option>` + eds.map(e => `<option value="${e.id}">${esc(e.label)}</option>`).join('') + `<option value="custom">${t('Commande personnalisée…')}</option>`;
      sel.value = SETTINGS.editor || 'auto';
    } catch { }
    if (!dlg.open) dlg.showModal();
    page(which);
  };
  $('#btnSettings').onclick = () => F.openSettings();
  $('#openPrompts').onclick = () => { dlg.close(); F.openPrompts(active); };

  // ---------------------------------------------------------------- modèles
  async function renderTemplates() {
    const list = await loadTemplates();
    const ul = $('#tplList');
    if (!list.length) { ul.innerHTML = `<li class="hint">${t('Aucun modèle pour l’instant.')}</li>`; return; }
    ul.innerHTML = list.map((x, i) => `<li data-i="${i}"><div><b>${esc(x.name)}</b><small>${esc(x.cwd)}${x.worktree ? ' · ⎇ worktree' : ''}${x.model ? ' · ' + esc(x.model) : ''}${x.group ? ' · ' + esc(x.group) : ''}</small></div>
      <span class="acts"><button data-a="run">${t('Lancer')}</button><button data-a="ren">${t('Renommer')}</button><button data-a="del" class="danger">${t('Supprimer')}</button></span></li>`).join('');
    ul.querySelectorAll('li[data-i]').forEach(li => {
      const x = list[+li.dataset.i];
      li.querySelector('[data-a=run]').onclick = () => { dlg.close(); openNew(x); };
      li.querySelector('[data-a=ren]').onclick = async () => { const n = await askName(t('Renommer le modèle'), x.name, ' '); if (n) { x.name = n; await api('PUT', '/api/templates', list); renderTemplates(); } };
      li.querySelector('[data-a=del]').onclick = async () => { if (!confirm(`${t('Supprimer le modèle')} « ${x.name} » ?`)) return; list.splice(+li.dataset.i, 1); await api('PUT', '/api/templates', list); renderTemplates(); };
    });
  }

  // ---------------------------------------------------------------- diagnostic et journaux
  let diagText = '';
  async function loadDiag() {
    const out = $('#diagOut'); out.textContent = t('Chargement…');
    try {
      const d = await api('GET', '/api/diag');
      const app = window.csmNative?.appVersion?.();
      diagText = [
        `Claude Sessions ${app || d.app} (${t('serveur')} ${d.app}, ${d.runtime})`,
        `${t('Système')} : ${d.platform}`,
        `claude : ${d.claude.ok ? '✓ ' + d.claude.version : '✗ ' + t('introuvable ou en erreur')} — ${d.claude.path}`,
        `git : ${d.git.ok ? '✓ ' + d.git.version : '✗ ' + t('introuvable (worktrees et panneau Modifications indisponibles)')}`,
        `hooks : ${d.hooks.ok ? '✓' : '✗'} ${d.hooks.file}`,
        `${t('Données')} : ${d.data}`,
        `${t('Code')} : ${d.code}`,
        `${t('Sessions')} : ${d.sessions.alive}/${d.sessions.total} ${t('actives')} · ${t('mémoire')} ${d.memory} Mo · ${t('en service depuis')} ${Math.round(d.uptime / 60)} min`,
        '', `— ${t('dernières lignes du journal')} —`, d.logTail,
      ].join('\n');
      out.textContent = diagText;
      out.classList.toggle('bad', !d.claude.ok);
    } catch (e) { out.textContent = e.message; }
  }
  $('#diagRefresh').onclick = loadDiag;
  $('#diagCopy').onclick = () => clip.copy('```\n' + diagText + '\n```').then(() => toast(t('Rapport copié — à coller dans une issue GitHub')));

  let logText = '';
  async function loadLogs() {
    try { logText = (await api('GET', '/api/logs?lines=2000')).text; } catch (e) { logText = e.message; }
    renderLogs();
  }
  function renderLogs() {
    const q = $('#logFilter').value.toLowerCase();
    const lines = logText.split('\n').filter(l => !q || l.toLowerCase().includes(q));
    const out = $('#logOut');
    out.innerHTML = lines.map(l => `<span class="${/erreur|error|uncaught|échec|✗/i.test(l) ? 'lerr' : /\[maj\]/.test(l) ? 'lupd' : ''}">${esc(l)}</span>`).join('\n');
    out.scrollTop = out.scrollHeight;
  }
  $('#logFilter').oninput = renderLogs;
  $('#logRefresh').onclick = loadLogs;

  // ---------------------------------------------------------------- à propos / mises à jour
  let upd = null;
  const UPD_LABEL = {
    dev: 'Version de développement : mises à jour automatiques désactivées.', idle: '', checking: 'Recherche de mises à jour…',
    uptodate: 'Claude Sessions est à jour.', disabled: 'Mises à jour automatiques désactivées dans les réglages.',
    downloading: 'Téléchargement de la version {v}… {p}', ready: 'Version {v} prête : redémarre pour l’installer.',
    available: 'Version {v} disponible au téléchargement.', error: 'Échec de la vérification : {e}',
  };
  const updText = st => t(UPD_LABEL[st.status] || '').replace('{v}', st.version || '').replace('{p}', st.progress ? st.progress + ' %' : '').replace('{e}', st.error || '');
  function renderAbout() {
    $('#aboutVersion').textContent = window.csmNative?.appVersion?.() || document.querySelector('meta[name="csm-version"]').content;
    $('#updateStatus').textContent = upd ? updText(upd) : (window.csmNative ? '' : t('Dans le navigateur : mettre à jour avec git pull puis csm restart.'));
    $('#updateCheck').hidden = !window.csmNative?.update;
  }
  function onUpdate(st) {
    upd = st;
    const bar = $('#updateBar');
    bar.hidden = !(st.status === 'ready' || st.status === 'available');
    $('#updateMsg').textContent = updText(st);
    $('#btnUpdate').textContent = st.status === 'ready' ? t('Redémarrer pour mettre à jour') : t('Télécharger');
    if (dlg.open) renderAbout();
  }
  $('#btnUpdate').onclick = () => window.csmNative?.update('install');
  $('#updateCheck').onclick = async () => { $('#updateStatus').textContent = t('Recherche de mises à jour…'); onUpdate(await window.csmNative.update('check')); };
  if (window.csmNative?.onUpdate) { window.csmNative.onUpdate(onUpdate); window.csmNative.update('state').then(st => st && onUpdate(st)); }

  // ---------------------------------------------------------------- assistant de premier lancement
  async function welcome() {
    if (SETTINGS.onboarded) return;
    if (sessions.size) { saveSettings({ onboarded: true }); return; } // déjà utilisé : pas d'assistant
    const d = $('#dlgWelcome');
    const box = $('#welcomeCheck');
    box.innerHTML = `<p class="hint">${t('Vérification de l’installation…')}</p>`;
    d.showModal();
    try {
      const r = await api('GET', '/api/diag');
      box.innerHTML = [
        [r.claude.ok, r.claude.ok ? `Claude Code ${esc(r.claude.version)}` : t('Claude Code introuvable : installe-le (docs.claude.com/claude-code) puis relance l’application.')],
        [r.git.ok, r.git.ok ? esc(r.git.version) : t('git introuvable : worktrees et panneau Modifications indisponibles (facultatif).')],
      ].map(([ok, txt]) => `<div class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${txt}</div>`).join('');
      $('#welcomeCwd').value = r.data && !sessions.size ? '' : '';
    } catch (e) { box.textContent = e.message; }
    const choice = await new Promise(res => d.addEventListener('close', () => res(d.returnValue), { once: true }));
    saveSettings({ onboarded: true });
    if (choice === 'ok') {
      const cwd = $('#welcomeCwd').value.trim();
      if (cwd) { try { const s = await api('POST', '/api/sessions', { cwd, args: SETTINGS.defaultModel ? `--model ${SETTINGS.defaultModel}` : '' }); sessions.set(s.id, s); ensureTerm(s.id); select(s.id); } catch (e) { alert(e.message); } }
      else openNew();
    }
  }
  $('#welcomeBrowse').onclick = async () => {
    const p = window.csmNative ? await window.csmNative.pickFolder('') : (await api('POST', '/api/pick-folder', { initial: '' }).catch(() => ({}))).path;
    if (p) $('#welcomeCwd').value = p;
  };
  window.addEventListener('csm:ready', () => setTimeout(welcome, 800));
})();
