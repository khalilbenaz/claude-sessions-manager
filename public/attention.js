'use strict';
// Centre d'attention (refonte Atelier, 3.32) : toutes les demandes des sessions au même endroit —
// autorisations (Autoriser, Toujours pour ce projet, Refuser), questions (réponse directe) et tâches terminées
// à relire. Les réponses sont des frappes envoyées à la session, exactement comme au clavier dans son terminal
// (1 = oui, 2 = oui pour ce projet, Échap = non). Sessions verrouillées : ni contenu ni action.
(() => {
  const $ = s => document.querySelector(s);
  const F = window.csmFeatures;
  const RISK = /\b(git\s+push|push\s+--force|rm\s+-rf?|rmdir|del\s+\/|drop\s+(table|database)|delete\s+from|truncate|deploy|publish|npm\s+publish|wrangler\s+deploy|kubectl|terraform\s+apply|format\s+[a-z]:|shutdown|curl[^|]*\|\s*(ba)?sh)\b/i;
  const READ_ONLY = /^\s*(Read|Glob|Grep|LS|WebFetch|WebSearch|NotebookRead)\b|\b(Read|Glob|Grep|LS)\(/;

  // dernières lignes utiles du terminal d'une session (contexte de la demande)
  function context(id, n = 12) {
    const tt = terms.get(id); if (!tt) return '';
    const b = tt.term.buffer.active, out = [];
    for (let y = b.length - 1; y >= 0 && out.length < n; y--) {
      const l = b.getLine(y)?.translateToString().replace(/\s+$/, '');
      if (l && l.trim() && !/^[─━═╭╰│\s]+$/.test(l)) out.unshift(l);
    }
    return out.join('\n');
  }
  const ago = ts => { const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 1 ? t('à l’instant') : m < 60 ? `${t('il y a')} ${m} min` : `${t('il y a')} ${Math.round(m / 60)} h`; };

  function items() {
    const out = [];
    for (const s of sorted()) {
      if (s.locked) continue;
      if (s.status === 'attention') {
        const ctx = context(s.id);
        const perm = /permission|autoris|approv|proceed|Do you want/i.test(`${s.message} ${ctx.slice(-400)}`);
        out.push({ s, kind: perm ? 'perm' : 'question', ctx, risk: perm && RISK.test(ctx), readOnly: perm && READ_ONLY.test(ctx) && !RISK.test(ctx) });
      } else if (s.status === 'idle' && s.message === 'terminé' && unread.has(s.id)) {
        out.push({ s, kind: 'review', ctx: context(s.id, 6) });
      }
    }
    // autorisations à risque d'abord, puis autorisations, questions, relectures
    const rank = x => (x.kind === 'perm' ? (x.risk ? 0 : 1) : x.kind === 'question' ? 2 : 3);
    return out.sort((a, b) => rank(a) - rank(b) || a.s.statusSince - b.s.statusSince);
  }

  const keys = (id, d) => send({ t: 'input', id, d });
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, cls, fn) => { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };

  function card(x) {
    const s = x.s, art = el('article', `atCard ${x.kind}${x.risk ? ' risk' : ''}`);
    const head = el('div', 'atHead');
    const dot = el('span', `dot ${s.status}`);
    const kind = x.kind === 'perm' ? (x.risk ? t('autorisation · risque') : x.readOnly ? t('autorisation · lecture') : t('autorisation')) : x.kind === 'question' ? t('question') : t('à relire');
    head.append(dot, el('b', '', s.name), el('span', `atKind k-${x.kind}${x.risk ? ' risk' : ''}`, kind), el('span', 'atWhen', ago(s.statusSince)));
    art.append(head);
    if (x.kind !== 'review' && s.message && s.message !== 'attend une réponse') art.append(el('p', '', t(s.message)));
    if (x.ctx) art.append(el('pre', 'atCtx', x.ctx));
    const acts = el('div', 'atActs');
    const done = () => setTimeout(render, 400);
    if (x.kind === 'perm') {
      acts.append(
        btn(t('Autoriser'), 'primary', () => { keys(s.id, '1'); done(); }),
        btn(t('Toujours pour ce projet'), '', () => { keys(s.id, '2'); done(); }),
        btn(t('Refuser'), 'danger', () => { keys(s.id, '\x1b'); done(); }));
    } else if (x.kind === 'question') {
      const inp = el('input'); inp.placeholder = t('Ta réponse…'); inp.setAttribute('aria-label', `${t('Réponse à')} ${s.name}`);
      const go = () => { const v = inp.value.trim(); if (!v) return; keys(s.id, `\x1b[200~${v}\x1b[201~`); setTimeout(() => keys(s.id, '\r'), 120); inp.value = ''; done(); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      acts.append(inp, btn(t('Répondre'), 'primary', go));
    } else {
      acts.append(btn(t('Marquer comme vu'), '', () => { unread.delete(s.id); api('POST', `/api/sessions/${s.id}/seen`).catch(() => { }); render(); }));
    }
    acts.append(btn(t('Ouvrir la session'), 'ghost', () => { $('#dlgAttention').close(); select(s.id); }));
    art.append(acts);
    return art;
  }

  function render() {
    const list = items();
    // compteur dans la barre du haut
    const b = $('#btnAttention');
    if (b) { b.hidden = !list.length; $('#atCount').textContent = list.length; b.classList.toggle('hot', list.some(x => x.kind === 'perm')); }
    const dlg = $('#dlgAttention'); if (!dlg?.open) return;
    $('#atTitleCount').textContent = list.length;
    const ro = list.filter(x => x.readOnly);
    $('#atReadOnly').hidden = !ro.length;
    $('#atReadOnly').textContent = `${t('Autoriser les lectures seules')} (${ro.length})`;
    $('#atList').replaceChildren(...(list.length ? list.map(card) : [el('p', 'atEmpty', t('Rien à traiter. Tes sessions travaillent.'))]));
  }
  $('#atReadOnly').onclick = () => { for (const x of items().filter(y => y.readOnly)) keys(x.s.id, '1'); setTimeout(render, 400); };
  F.openAttention = () => { const d = $('#dlgAttention'); if (!d.open) d.showModal(); render(); };
  $('#btnAttention').onclick = F.openAttention;
  window.addEventListener('csm:session', () => render());
  setInterval(render, 5000); // « il y a N min »
  window.addEventListener('csm:ready', render);
  F.attentionItems = items;
})();
