'use strict';
// Refonte Atelier (3.31) : Nouvelle session (modèles en cartes, modèle Claude en boutons) et barre d'envoi
// groupé de la vue partagée. Les champs d'origine restent (masqués) : mêmes valeurs, mêmes envois.
(() => {
  const $ = s => document.querySelector(s);
  const F = window.csmFeatures;
  const f = $('#formNew');

  // ---------------------------------------------------------------- modèles en cartes
  function card(value, name, desc, badge) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tplCard'; b.setAttribute('role', 'radio'); b.dataset.v = value;
    const n = document.createElement('span'); n.className = 'tn'; n.textContent = name;
    const d = document.createElement('span'); d.className = 'td'; d.textContent = desc || '';
    b.append(n, d);
    if (badge) { const g = document.createElement('span'); g.className = 'tb'; g.textContent = badge; b.append(g); }
    b.onclick = () => { f.template.value = value; f.template.dispatchEvent(new Event('change')); syncCards(); };
    return b;
  }
  function syncCards() {
    for (const c of $('#tplCards').children) {
      const on = c.dataset.v === f.template.value;
      c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
  // reconstruit les cartes à partir de la liste déroulante (options + groupes d'extensions). Beaucoup de
  // modèles : filtres par provenance (mes modèles, chaque extension) et recherche, au lieu de faire défiler.
  const LSk = 'csm.tplFilter';
  let filter = (() => { try { return localStorage.getItem(LSk) || 'all'; } catch { return 'all'; } })(), query = '';
  function entries() {
    const out = [];
    for (const node of f.template.children) {
      if (node.tagName === 'OPTION' && node.value) {
        const x = (typeof templates !== 'undefined' ? templates : []).find(y => y.id === node.value);
        out.push({ v: node.value, name: node.textContent, desc: x?.cwd ? x.cwd.split(/[\\/]/).filter(Boolean).pop() : '', group: 'mine' });
      } else if (node.tagName === 'OPTGROUP') {
        for (const o of node.children) out.push({ v: o.value, name: o.textContent, desc: '', badge: node.label, group: node.label });
      }
    }
    return out;
  }
  function chip(key, label, n) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tplChip'; b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', filter === key ? 'true' : 'false'); b.classList.toggle('on', filter === key);
    b.append(label); if (n != null) { const c = document.createElement('span'); c.className = 'n'; c.textContent = n; b.append(c); }
    b.onclick = () => { filter = key; try { localStorage.setItem(LSk, key); } catch { } renderCards(); };
    return b;
  }
  function renderCards() {
    const box = $('#tplCards'); if (!box) return;
    let bar = $('#tplFilters');
    if (!bar) { bar = document.createElement('div'); bar.id = 'tplFilters'; bar.className = 'tplFilters'; bar.setAttribute('role', 'tablist'); box.before(bar); }
    const all = entries();
    const groups = [...new Set(all.map(e => e.group))];
    if (filter !== 'all' && !groups.includes(filter)) filter = 'all';
    // la sélection courante reste visible : on bascule sur son groupe si elle est cachée par le filtre
    const cur = all.find(e => e.v === f.template.value);
    if (cur && filter !== 'all' && cur.group !== filter) filter = cur.group;
    const chips = groups.length > 1 ? [chip('all', t('Tous'), all.length), ...groups.map(g => chip(g, g === 'mine' ? t('Mes modèles') : g, all.filter(e => e.group === g).length))] : [];
    if (all.length > 6) {
      let s = $('#tplSearch');
      if (!s) {
        s = document.createElement('input'); s.id = 'tplSearch'; s.type = 'search'; s.placeholder = t('Chercher un modèle…');
        s.setAttribute('aria-label', t('Chercher un modèle')); s.autocomplete = 'off';
        s.oninput = () => { query = s.value.trim().toLowerCase(); renderCards(); s.focus(); };
        s.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); box.querySelector('.tplCard:not(.blank)')?.click(); } };
      }
      chips.push(s);
    }
    bar.replaceChildren(...chips); bar.hidden = !chips.length;
    const shown = all.filter(e => (filter === 'all' || e.group === filter) && (!query || `${e.name} ${e.desc} ${e.badge || ''}`.toLowerCase().includes(query)));
    const blank = card('', t('Session vide'), t('Dossier et modèle seulement')); blank.classList.add('blank');
    box.replaceChildren(blank, ...shown.map(e => card(e.v, e.name, e.desc, filter === 'all' ? e.badge : '')));
    if (!shown.length && query) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = t('Aucun modèle ne correspond.'); box.append(p); }
    syncCards();
  }
  F.renderTemplateCards = renderCards;
  new MutationObserver(renderCards).observe(f.template, { childList: true, subtree: true });
  f.template.addEventListener('change', syncCards);

  // ---------------------------------------------------------------- modèle Claude en boutons
  function syncModel() {
    for (const b of $('#modelSeg').children) {
      const on = b.dataset.v === f.model.value;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
  for (const b of $('#modelSeg').children) b.onclick = () => { f.model.value = b.dataset.v; syncModel(); };
  f.model.addEventListener('change', syncModel);
  // valeurs posées par le code (ouverture, modèle de session) : surveillées à l'ouverture de la fenêtre
  const dlg = $('#dlgNew');
  new MutationObserver(() => {
    if (!dlg.open) return;
    query = ''; const s = $('#tplSearch'); if (s) s.value = '';
    syncModel(); renderCards();
  }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  f.addEventListener('input', () => { syncModel(); });
  f.template.addEventListener('change', () => setTimeout(syncModel, 0));

  // ---------------------------------------------------------------- vue partagée : envoi groupé
  const bar = $('#splitBar');
  function renderBar() {
    const ids = typeof visibleIds === 'function' ? visibleIds().filter(id => sessions.get(id)?.alive) : [];
    const split = document.querySelector('#terms')?.dataset.layout !== '1';
    bar.hidden = !split;
    $('#sbCount').textContent = `${ids.length} ${ids.length > 1 ? t('panneaux') : t('panneau')}`;
    bar.querySelector('button[type=submit]').disabled = !ids.length;
  }
  bar.onsubmit = async e => {
    e.preventDefault();
    const text = $('#sbText').value.trim(); if (!text) return;
    const ids = visibleIds().filter(id => sessions.get(id)?.alive);
    if (!ids.length) return;
    await F.sendTo(ids, text, $('#sbQueue').checked);
    $('#sbText').value = '';
  };
  new MutationObserver(renderBar).observe($('#terms'), { attributes: true, attributeFilter: ['data-layout'] });
  window.addEventListener('csm:session', renderBar);
  window.addEventListener('csm:active', renderBar);
  window.addEventListener('csm:ready', () => { renderBar(); renderCards(); });
})();
