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
  // reconstruit les cartes à partir de la liste déroulante (options + groupes d'extensions)
  function renderCards() {
    const box = $('#tplCards'); if (!box) return;
    const cards = [card('', t('Session vide'), t('Dossier et modèle seulement'))];
    for (const node of f.template.children) {
      if (node.tagName === 'OPTION' && node.value) {
        const x = (typeof templates !== 'undefined' ? templates : []).find(y => y.id === node.value);
        cards.push(card(node.value, node.textContent, x?.cwd ? x.cwd.split(/[\\/]/).filter(Boolean).pop() : ''));
      } else if (node.tagName === 'OPTGROUP') {
        for (const o of node.children) cards.push(card(o.value, o.textContent, '', node.label));
      }
    }
    box.replaceChildren(...cards);
    syncCards();
  }
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
  new MutationObserver(() => { if (dlg.open) { syncModel(); syncCards(); } }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
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
