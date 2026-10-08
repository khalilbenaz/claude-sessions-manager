'use strict';
// Bas de la barre latérale (refonte Atelier) : quotas 5 h et 7 jours (barre d'état de Claude Code) et état de la synchro.
(() => {
  const $ = s => document.querySelector(s);
  let quota = null, sync = null;
  const hm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  const when = ts => {
    if (!ts) return '';
    const d = new Date(ts), today = new Date().toDateString() === d.toDateString();
    return today ? hm(ts) : `${t(DAYS[d.getDay()])} ${hm(ts)}`;
  };
  function line(label, q) {
    const pct = Math.max(0, Math.min(100, Math.round(q.pct)));
    const row = document.createElement('div'); row.className = 'q';
    const a = document.createElement('span'); a.textContent = label;
    const b = document.createElement('span'); b.textContent = `${pct} %${q.resetAt ? ` · ${t('reset')} ${when(q.resetAt)}` : ''}`;
    row.append(a, b);
    const bar = document.createElement('div'); bar.className = 'qbar';
    const i = document.createElement('i'); i.style.width = `${pct}%`; i.className = pct >= 90 ? 'max' : pct >= 70 ? 'hi' : '';
    bar.append(i);
    return [row, bar];
  }
  function render() {
    const box = $('#sideStatus'); if (!box) return;
    const parts = [];
    if (quota?.five) parts.push(...line(t('Quota 5 h'), quota.five));
    if (quota?.seven) parts.push(...line(t('Quota 7 j'), quota.seven));
    if (sync?.enabled) {
      const s = document.createElement('div'); s.className = `syncLine${sync.lastError ? ' bad' : ''}`;
      const dot = document.createElement('b');
      const txt = document.createElement('span');
      txt.textContent = sync.lastError ? t('Synchro : erreur') : `${t('Synchronisé')}${sync.lastOk ? ` · ${hm(sync.lastOk)}` : ''}`;
      s.append(dot, txt); s.title = sync.lastError || '';
      parts.push(s);
    }
    box.replaceChildren(...parts);
    box.hidden = !parts.length;
  }
  async function loadQuota() { try { quota = await api('GET', '/api/quota'); } catch { } render(); }
  async function loadSync() { try { sync = await api('GET', '/api/sync'); } catch { } render(); }
  window.addEventListener('csm:quota', loadQuota);
  window.addEventListener('csm:sync', e => { sync = e.detail || sync; render(); });
  window.addEventListener('csm:ready', () => { loadQuota(); loadSync(); });
  setInterval(render, 60e3); // « reset 13:21 » / jour affiché à jour
})();
