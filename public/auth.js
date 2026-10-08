'use strict';
// Connexion de Claude Code (lib/auth.js) : bandeau quand elle expire bientôt, renouvellement en un clic.
(() => {
  const $ = s => document.querySelector(s);
  let st = null;
  const LATER = 'csm.authLater'; // « Plus tard » : masqué 24 h
  const later = () => { try { return Number(localStorage.getItem(LATER)) || 0; } catch { return 0; } };

  function left(ms) {
    if (ms <= 0) return t('a expiré');
    const d = Math.floor(ms / 86400e3), h = Math.floor(ms % 86400e3 / 3600e3);
    return d >= 1 ? `${t('expire dans')} ${d} ${d > 1 ? t('jours') : t('jour')}` : `${t('expire dans')} ${Math.max(1, h)} h`;
  }

  function render() {
    const b = $('#authBanner'), dlg = $('#dlgAuth');
    const show = st && st.enabled && (st.warn || st.renewing) && (st.expired || st.renewing || Date.now() - later() > 86400e3);
    b.hidden = !show;
    if (show) {
      $('#authText').textContent = st.renewing ? t('Connexion à Claude en cours de renouvellement…') : `${t('Ta connexion à Claude')} ${left(st.msLeft)}.`;
      b.classList.toggle('expired', !!st.expired);
      $('#authLater').hidden = !!st.expired || st.renewing;
    }
    if (dlg.open) {
      $('#authStep').textContent = st.renewing
        ? t('Le navigateur s’est ouvert sur la page de connexion de Claude : connecte-toi et autorise. Si une page affiche un code, colle-le ci-dessous.')
        : st.error ? `${t('Échec')} : ${st.error}` : t('Lance la connexion : le navigateur s’ouvre sur la page de Claude.');
      $('#authLink').hidden = !st.url;
      $('#authLink').href = st.url || '#';
      $('#authCodeRow').hidden = !(st.renewing && st.prompt);
      $('#authGo').hidden = st.renewing;
    }
  }

  async function load() { try { st = await api('GET', '/api/auth'); render(); } catch { } }
  async function renew() {
    const dlg = $('#dlgAuth');
    if (!dlg.open) { dlg.returnValue = ''; dlg.showModal(); }
    try { st = await api('POST', '/api/auth/renew'); wasRenewing = !!st.renewing; watch(); } catch (e) { toast(e.message, true); }
    render();
  }
  $('#authRenew').onclick = renew;
  $('#authGo').onclick = renew;
  $('#authLater').onclick = () => { try { localStorage.setItem(LATER, String(Date.now())); } catch { } render(); };
  $('#authLink').onclick = e => { e.preventDefault(); if (st?.url) window.open(st.url, '_blank'); };
  $('#authCodeSend').onclick = async () => {
    const code = $('#authCode').value.trim(); if (!code) return;
    try { st = await api('POST', '/api/auth/code', { code }); $('#authCode').value = ''; render(); } catch (e) { toast(e.message, true); }
  };
  $('#authCode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#authCodeSend').click(); } });
  // « Fermer » abandonne la connexion en cours (Échap ou fermeture imprévue : elle continue, abandon auto après 15 min)
  $('#dlgAuth').addEventListener('close', () => { if (st?.renewing && $('#dlgAuth').returnValue === 'cancel') api('POST', '/api/auth/cancel').catch(() => { }); });

  // notification système : une fois par jour quand l'expiration approche
  function notify() {
    if (!st?.enabled || !st.warn || SETTINGS.dnd || !SETTINGS.notifications) return;
    const key = 'csm.authNotified', last = (() => { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } })();
    if (Date.now() - last < 86400e3) return;
    try { localStorage.setItem(key, String(Date.now())); } catch { }
    const title = 'Claude Sessions', body = `${t('Ta connexion à Claude')} ${left(st.msLeft)} — ${t('clique pour la renouveler')}`;
    if (window.csmNative?.notify) return window.csmNative.notify(title, body, '');
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, tag: 'csm-auth', icon: 'icon.svg', silent: true });
    n.onclick = () => { window.csmNative ? window.csmNative.focus() : window.focus(); renew(); n.close(); };
  }

  let wasRenewing = false;
  window.addEventListener('csm:auth', e => apply(e.detail.status, e.detail.done));
  // Pendant un renouvellement : état relu directement toutes les secondes (ne dépend pas des messages en direct)
  let poll = null;
  function watch() {
    clearInterval(poll);
    const end = Date.now() + 16 * 60e3;
    poll = setInterval(async () => {
      if (Date.now() > end) return clearInterval(poll);
      try { const x = await api('GET', '/api/auth'); apply(x, false); if (!x.renewing) clearInterval(poll); } catch { }
    }, 1000);
  }
  function apply(next, done) {
    if (!next) return;
    st = next;
    const e = { detail: { done } };
    // fin d'un renouvellement réussi : fenêtre fermée (même si le message « done » s'est perdu)
    const ok = e.detail.done || (wasRenewing && !st.renewing && !st.error && st.renewedAt);
    wasRenewing = !!st.renewing;
    render(); // bandeau d'abord : rien de ce qui suit ne doit l'empêcher de se mettre à jour
    if (ok) {
      try { if ($('#dlgAuth').open) $('#dlgAuth').close(); } catch { }
      try { toast(t('Connexion à Claude renouvelée')); } catch { }
      render();
    }
    try { notify(); } catch { }
  }
  window.addEventListener('csm:ready', () => { load().then(notify); });
  setInterval(() => { if (!st?.renewing) load(); }, 5 * 60e3); // état relu régulièrement (changement fait ailleurs, ex. /login)
  window.csmFeatures = Object.assign(window.csmFeatures || {}, { renewLogin: renew, authState: () => st });
})();
