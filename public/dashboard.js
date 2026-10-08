'use strict';
// Usage de Claude (refonte Atelier, 3.33) : indicateurs du jour, prévision du quota 5 h, tâches planifiées,
// détail par session. Ouvert par Ctrl+Alt+U, la palette, ou un clic sur les quotas de la barre latérale.
(() => {
  const $ = s => document.querySelector(s);
  const F = window.csmFeatures;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const dur = sec => { const m = Math.round(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  const money = n => `${(n || 0).toFixed(2).replace('.', ',')} $`;
  const tok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n || 0));
  const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  const when = ts => (new Date(ts).toDateString() === new Date().toDateString() ? hm(ts) : `${t(DAYS[new Date(ts).getDay()])} ${hm(ts)}`);

  function kpi(label, value, hint, cls) {
    const k = el('div', `dbKpi${cls ? ' ' + cls : ''}`);
    k.append(el('span', 'kl', label), el('span', 'kv', value), el('span', 'kh', hint || ''));
    return k;
  }

  async function load() {
    const [usage, quota, work, sch] = await Promise.all([
      api('GET', '/api/usage').catch(() => null), api('GET', '/api/quota').catch(() => null),
      api('GET', '/api/worktime').catch(() => null), api('GET', '/api/schedules').catch(() => []),
    ]);
    const all = [...sessions.values()], alive = all.filter(s => s.alive);
    const todo = F.attentionItems ? F.attentionItems() : [];
    const today = work?.today || { total: 0, queued: 0, sessions: {} };

    // indicateurs
    $('#dbKpis').replaceChildren(
      kpi(t('Sessions actives'), String(alive.length), `${all.length} ${t('au total')}`),
      kpi(t('À traiter'), String(todo.length), todo.some(x => x.risk) ? t('dont une autorisation à risque') : todo.length ? t('voir le centre d’attention') : t('rien en attente'), todo.length ? 'warn' : ''),
      kpi(t('Temps de travail de Claude'), dur(today.total), today.queued ? `${t('dont')} ${dur(today.queued)} ${t('sans toi (file d’attente)')}` : t('aujourd’hui')),
      kpi(t('Coût estimé'), money(usage?.today?.cost), `${t('7 jours')} : ${money(usage?.d7?.cost)} · ${t('inclus dans ton abonnement')}`, 'accent'));

    // quota 5 h : historique et prévision
    const qbox = $('#dbQuota'); qbox.replaceChildren();
    if (!quota?.five) qbox.append(el('p', 'hint', t('Pas encore de quota : il arrive avec la barre d’état de Claude Code dès qu’une session répond.')));
    else {
      const fc = quota.forecast;
      const head = el('div', 'dbQHead');
      head.append(el('b', '', `${Math.round(quota.five.pct)} %`), el('span', 'hint', quota.five.resetAt ? `${t('réinitialisation à')} ${when(quota.five.resetAt)}` : ''));
      const note = !fc ? t('Prévision dès quelques minutes de mesures.')
        : fc.limitAt ? `${t('Au rythme actuel, limite atteinte vers')} ${when(fc.limitAt)}`
          : t('Au rythme actuel, pas de limite avant la réinitialisation.');
      head.append(el('span', `dbFc${fc?.limitAt ? ' warn' : ''}`, note));
      const chart = el('div', 'dbChart'); chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', `${t('Quota 5 h')} : ${note}`);
      const pts = quota.hist?.length ? quota.hist : [{ t: Date.now(), pct: quota.five.pct }];
      for (const p of pts.slice(-36)) { const b = el('i'); b.style.height = `${Math.max(2, Math.min(100, p.pct))}%`; b.title = `${hm(p.t)} · ${Math.round(p.pct)} %`; chart.append(b); }
      qbox.append(head, chart, el('p', 'hint', t('Les files d’attente se mettent en pause près de la limite et reprennent à la réinitialisation.')));
      if (quota.seven) qbox.append(el('p', 'hint', `${t('Quota 7 j')} : ${Math.round(quota.seven.pct)} %${quota.seven.resetAt ? ` · ${t('réinitialisation')} ${when(quota.seven.resetAt)}` : ''}`));
    }

    // tâches planifiées
    const jobs = (Array.isArray(sch) ? sch : []).filter(x => x.enabled).sort((a, b) => (a.next || 9e15) - (b.next || 9e15));
    $('#dbJobs').replaceChildren(...(jobs.length ? jobs.slice(0, 6).map(x => {
      const d = el('div', 'dbJob');
      d.append(el('b', '', x.name || (x.text || '').slice(0, 60) || t('Tâche')), el('span', 'hint', x.next ? `${t('prochaine')} : ${when(x.next)}` : t('à l’heure prévue')));
      return d;
    }) : [el('p', 'hint', t('Aucune tâche planifiée.'))]));

    // par session (7 jours) + temps de travail du jour
    const byClaude = new Map(all.filter(s => s.claudeSessionId).map(s => [s.claudeSessionId, s]));
    const rows = (usage?.top || []).map(x => {
      const s = byClaude.get(x.id);
      return { name: s?.name || x.name, time: s ? today.sessions[s.id] || 0 : 0, tokens: (x.in || 0) + (x.out || 0) + (x.cr || 0) + (x.cw || 0), cost: x.cost };
    });
    const tb = $('#dbRows'); tb.replaceChildren();
    for (const r of rows.slice(0, 12)) {
      const tr = el('tr');
      tr.append(el('td', '', r.name), el('td', 'num', r.time ? dur(r.time) : '—'), el('td', 'num', tok(r.tokens)), el('td', 'num', money(r.cost)));
      tb.append(tr);
    }
    if (!rows.length) { const tr = el('tr'); const td = el('td', 'hint', t('Pas encore de consommation sur 7 jours.')); td.colSpan = 4; tr.append(td); tb.append(tr); }
    $('#dbNote').textContent = usage?.note ? t(usage.note) : '';
  }

  F.openUsage = () => { const d = $('#dlgUsage'); if (!d.open) d.showModal(); load(); };
  $('#dbSchedules').onclick = () => { $('#dlgUsage').close(); F.openSettings('schedules'); };
  $('#sideStatus')?.addEventListener('click', e => { if (!e.target.closest('.syncLine')) F.openUsage(); });
  window.addEventListener('csm:quota', () => { if ($('#dlgUsage').open) load(); });
  setInterval(() => { if ($('#dlgUsage').open) load(); }, 30e3);
})();
