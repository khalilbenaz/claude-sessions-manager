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
    if (name === 'sync') loadSync();
    if (name === 'general') api('GET', '/api/sync').then(renderEngine).catch(() => { });
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
      const v = el.type === 'checkbox' ? el.checked : el.type === 'number' || typeof SETTINGS[k] === 'number' ? Number(el.value) : el.value;
      saveSettings({ [k]: v });
      if (k === 'editor') $('#editorCmdRow').hidden = v !== 'custom';
      if (k === 'fontSize') { LS.set('csm.font', v); for (const tt of terms.values()) tt.term.options.fontSize = v; fitAll(); }
      if (k === 'notifications' && v && 'Notification' in window) Notification.requestPermission();
      if (k === 'lang') setTimeout(() => location.reload(), 300);
      if (k.startsWith('sync')) setTimeout(() => syncNow(), 300);
    });
  });
  $('#soundTest').onclick = () => playSound($('[data-set=sound]').value);

  F.openSettings = async (which = 'general') => {
    fill();
    dlg.querySelectorAll('.app-only').forEach(el => { el.hidden = !window.csmNative; });
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
    if (!list.length) {
      ul.innerHTML = `<li class="empty"><div><b>${t('Aucun modèle pour l’instant.')}</b><small>${t('Un modèle relance en un clic une session type : même dossier, groupe, modèle Claude, mode, worktree et premier prompt.')}</small></div>
        <span class="acts">${active ? `<button data-a="from" class="primary">${t('Créer depuis la session active')}</button>` : ''}<button data-a="new">${t('Nouvelle session…')}</button></span></li>`;
      ul.querySelector('[data-a=from]')?.addEventListener('click', async () => { await saveSessionAsTemplate(active); renderTemplates(); });
      ul.querySelector('[data-a=new]').onclick = () => { dlg.close(); openNew(); };
      return;
    }
    ul.innerHTML = list.map((x, i) => `<li data-i="${i}"><div><b>${esc(x.name)}</b><small>${esc(x.cwd)}${x.worktree ? ' · ⎇ worktree' : ''}${x.model ? ' · ' + esc(x.model) : ''}${x.group ? ' · ' + esc(x.group) : ''}</small></div>
      <span class="acts"><button data-a="run">${t('Lancer')}</button><button data-a="ren">${t('Renommer')}</button><button data-a="del" class="danger">${t('Supprimer')}</button></span></li>`).join('');
    ul.querySelectorAll('li[data-i]').forEach(li => {
      const x = list[+li.dataset.i];
      li.querySelector('[data-a=run]').onclick = () => { dlg.close(); openNew(x); };
      li.querySelector('[data-a=ren]').onclick = async () => { const n = await askName(t('Renommer le modèle'), x.name, ' '); if (n) { x.name = n; await api('PUT', '/api/templates', list); renderTemplates(); } };
      li.querySelector('[data-a=del]').onclick = async () => { if (!confirm(`${t('Supprimer le modèle')} « ${x.name} » ?`)) return; list.splice(+li.dataset.i, 1); await api('PUT', '/api/templates', list); renderTemplates(); };
    });
  }

  // ---------------------------------------------------------------- synchronisation (#27)
  // Pas de code : « Créer un code » (le serveur le génère et l'enregistre) ou « J'ai déjà un code ».
  // Avec un code : affiché en clair, copiable, pour le saisir sur les autres machines.
  const count = (n, label) => n ? ` · ${t(label)} : ${n}` : '';
  const memInfo = st => (!st.memory ? ''
    : st.memAvailable === false ? ` · ${t('claude-mem introuvable sur cette machine')}`
    : count(st.memReceived, 'mémoire reçue') + count(st.memSent, 'mémoire envoyée'))
    + count(st.nmReceived, 'résumés reçus') + count(st.nmSent, 'résumés envoyés');
  const ENGINE_HINT = "Au démarrage, Claude reçoit ce qui a été fait avant dans le même dossier. Ne concerne que les sessions lancées par l'app ; le terminal garde ses propres réglages.";
  function renderEngine(st) {
    const el = $('#memEngineInfo');
    if (!el || !st) return;
    const mi = st.memInstall || '';
    el.textContent = t(ENGINE_HINT) + (!['claude-mem', 'both'].includes(st.memEngine) ? ''
      : mi === 'installing' ? ' · ' + t('installation de claude-mem…')
      : mi.startsWith('error') ? ' · ' + t('installation de claude-mem impossible') + mi.slice(5)
      : st.memInstalled ? ' · ' + t('claude-mem installé') : '');
  }
  function renderSync(st) {
    if (!st) return;
    renderEngine(st);
    F.syncMachine = st.machine;
    $('#syncMachine').placeholder = st.machine;
    $('#syncServer').placeholder = st.server;
    $('#syncSetup').hidden = st.enabled;
    $('#syncOn').hidden = !st.enabled;
    $('#syncCodeShow').textContent = st.code || '';
    const when = st.lastOk ? new Date(st.lastOk).toLocaleTimeString() : '';
    $('#syncStatus').textContent = st.invalid ? t('Code de synchro invalide : vérifie qu’il a bien 20 caractères (XXXX-XXXX-XXXX-XXXX-XXXX).')
      : !st.enabled ? t('Synchronisation désactivée.')
      : st.lastError ? `✗ ${st.lastError}`
      : st.lastOk ? `✓ ${t('Synchronisé')} · ${when}${st.pending ? ` · ${st.pending} ${t('en attente')}` : ''}${memInfo(st)}`
      : t('Synchronisation…');
    $('#syncStatus').classList.toggle('bad', !!(st.invalid || st.lastError));
  }
  async function loadSync() { try { renderSync(await api('GET', '/api/sync')); } catch (e) { $('#syncStatus').textContent = e.message; } }
  async function syncNow() {
    $('#syncStatus').textContent = t('Synchronisation…');
    try { renderSync(await api('POST', '/api/sync/now')); } catch (e) { $('#syncStatus').textContent = e.message; }
  }
  async function useCode(code) { await saveSettings({ syncCode: code }); await syncNow(); }
  $('#syncNow').onclick = syncNow;
  $('#syncCopy').onclick = () => clip.copy($('#syncCodeShow').textContent).then(() => toast(t('Code copié : saisis-le dans Réglages › Synchronisation sur ton autre machine. Ne le partage avec personne d’autre.')));
  $('#syncOff').onclick = async () => {
    if (!confirm(t('Désactiver la synchronisation sur cette machine ? Les sessions restent ici. Garde ton code si tu veux la réactiver.'))) return;
    await useCode('');
  };
  $('#syncNew').onclick = async () => {
    const b = $('#syncNew'); b.disabled = true;
    $('#syncStatus').textContent = t('Création du code…');
    try { const r = await api('POST', '/api/sync/code'); await useCode(r.code); }
    catch (e) { $('#syncStatus').textContent = `✗ ${e.message}`; $('#syncStatus').classList.add('bad'); }
    finally { b.disabled = false; }
  };
  $('#syncJoin').onclick = async () => {
    const code = $('#syncJoinCode').value.trim();
    if (!code) return $('#syncJoinCode').focus();
    await useCode(code);
    if (!$('#syncOn').hidden) $('#syncJoinCode').value = '';
  };
  $('#syncJoinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#syncJoin').click(); });
  window.addEventListener('csm:sync', e => { if (dlg.open) renderSync(e.detail); });
  window.addEventListener('csm:ready', () => api('GET', '/api/sync').then(st => { F.syncMachine = st.machine; render(); }).catch(() => { }));

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
    dev: 'Version de développement : mises à jour automatiques désactivées.', store: 'Version Microsoft Store : les mises à jour sont installées par le Store.', idle: '', checking: 'Recherche de mises à jour…',
    uptodate: 'Claude Sessions est à jour.', disabled: 'Mises à jour automatiques désactivées dans les réglages.',
    downloading: 'Téléchargement de la version {v}… {p}', ready: 'Version {v} prête : installation automatique dès que la fenêtre est en arrière-plan, ou redémarre maintenant.',
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
