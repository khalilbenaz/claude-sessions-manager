'use strict';
// Extensions (lib/extensions.js) : Réglages › Extensions, et affichage dédié des sessions d'un type d'extension.
// Tout ce qui vient d'une extension ou de la vue écrite par Claude est inséré en texte (textContent), jamais en HTML.
(() => {
  const $ = s => document.querySelector(s);
  const F = window.csmFeatures;
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e[k] = v;
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c) e.append(c);
    return e;
  };

  // ---------------------------------------------------------------- Réglages › Extensions
  async function renderList() {
    const ul = $('#extList'); if (!ul) return;
    let list = [];
    try { list = await api('GET', '/api/extensions'); } catch (e) { ul.replaceChildren(el('li', { class: 'hint', text: e.message })); return; }
    if (!list.length) { ul.replaceChildren(el('li', { class: 'hint', text: t('Aucune extension. Importe un fichier .csm.json reçu ou créé pour toi.') })); return; }
    ul.replaceChildren(...list.map(x => {
      const parts = [];
      if (x.counts.templates) parts.push(`${x.counts.templates} ${t('modèle(s)')}`);
      if (x.counts.sessionTypes) parts.push(`${x.counts.sessionTypes} ${t('type(s) de session')}`);
      if (x.counts.prompts) parts.push(`${x.counts.prompts} ${t('prompt(s)')}`);
      const sw = el('input', { type: 'checkbox', 'aria-label': `${t('Activer')} ${x.name}` });
      sw.checked = !!x.enabled; sw.disabled = !!x.error;
      sw.onchange = () => api('POST', `/api/extensions/${encodeURIComponent(x.id)}/enabled`, { on: sw.checked }).then(renderList).catch(e => toast(e.message, true));
      return el('li', { class: 'extItem' },
        el('label', { class: 'extMain' }, sw,
          el('span', {},
            el('b', { text: `${x.name} ` }), el('span', { class: 'hint', text: `${x.version || ''} · ${x.from ? `${t('reçue de')} ${x.from}` : t(x.source)}` }),
            el('div', { class: 'hint', text: x.error ? `${t('Invalide')} : ${x.error}` : (x.description || parts.join(' · ')) }),
            x.description && parts.length ? el('div', { class: 'hint', text: parts.join(' · ') }) : null)),
        x.removable ? el('button', { type: 'button', class: 'danger', text: t('Supprimer'), onclick: async () => {
          if (!confirm(`${t('Supprimer l’extension')} « ${x.name} » ?`)) return;
          try { await api('DELETE', `/api/extensions/${encodeURIComponent(x.id)}`); renderList(); } catch (e) { toast(e.message, true); }
        } }) : null);
    }));
  }
  async function importFiles(files) {
    for (const f of files) {
      try {
        const r = await api('POST', '/api/extensions', { content: await f.text() });
        toast(`${r.replaced ? t('Extension mise à jour') : t('Extension ajoutée')} : ${r.name}`);
      } catch (e) { toast(`${f.name} : ${e.message}`, true); }
    }
    renderList();
  }
  $('#extImport').onclick = () => $('#extFile').click();
  $('#extFile').onchange = () => { importFiles([...$('#extFile').files]); $('#extFile').value = ''; };
  const zone = $('section[data-st=extensions]');
  zone.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); zone.classList.add('dropping'); } });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('dropping'); });
  zone.addEventListener('drop', e => { zone.classList.remove('dropping'); const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) { e.preventDefault(); e.stopPropagation(); importFiles(fs); } });
  document.querySelector('.setNav [data-st=extensions]')?.addEventListener('click', renderList);
  window.addEventListener('csm:extensions', () => { if (!zone.hidden) renderList(); });

  // ---------------------------------------------------------------- vue d'une session typée
  const LS2 = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
  const modeOf = id => LS2.get(`csm.view.${id}`) || 'view';
  const views = new Map(); // id -> { type, view }

  function section(s, i, id) {
    const box = el('section', { class: `tvSec tv-${s.kind}${s.level === 'warn' ? ' warn' : ''}` });
    if (s.title || s.badge) box.append(el('h3', {}, s.title || '', s.badge ? el('span', { class: 'tvBadge', text: s.badge }) : null));
    if (s.kind === 'text' || s.kind === 'alert') box.append(el('p', { text: s.text }));
    if (s.kind === 'list') box.append(el('ul', {}, s.items.map(x => el('li', { text: x }))));
    if (s.kind === 'kv') box.append(el('dl', {}, s.items.map(x => [el('dt', { text: x.label }), el('dd', { text: x.value })])));
    if (s.kind === 'timeline') box.append(el('ol', { class: 'tvTime' }, s.items.map(x => el('li', {}, el('span', { class: 'tvAt', text: x.at }), el('span', { text: x.text })))));
    if (s.kind === 'table') box.append(el('div', { class: 'tvScroll' }, el('table', {},
      el('thead', {}, el('tr', {}, s.columns.map(c => el('th', { text: c })))),
      el('tbody', {}, s.rows.map(r => el('tr', {}, r.map(c => el('td', { text: c }))))))));
    if (s.kind === 'checklist') box.append(el('ul', { class: 'tvCheck' }, s.items.map(x => el('li', { class: x.done ? 'done' : '' },
      el('span', { class: 'tvBox', 'aria-hidden': 'true', text: x.done ? '✓' : '' }), el('span', {}, el('span', { text: x.label }), x.hint ? el('small', { text: x.hint }) : null)))));
    if (s.kind === 'draft') {
      const ta = el('textarea', { rows: '8', 'aria-label': s.title || t('Brouillon') });
      ta.value = s.text;
      box.append(ta, el('div', { class: 'tvActs' }, s.actions.map((a, j) => el('button', {
        type: 'button', class: j === 0 ? 'primary' : '', text: a.label,
        onclick: () => act(id, { section: i, index: j, draft: ta.value }),
      })), el('button', { type: 'button', text: t('Copier'), onclick: () => navigator.clipboard.writeText(ta.value).then(() => toast(t('Copié'))) })));
    }
    return box;
  }
  async function act(id, body, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    try { await api('POST', `/api/sessions/${id}/view-action`, body); toast(t('Envoyé à la session')); } catch (e) { toast(e.message, true); }
  }
  function boxOf(id) {
    const tt = terms.get(id); if (!tt) return null;
    let b = tt.el.querySelector('.typeView');
    if (!b) { b = el('div', { class: 'typeView', hidden: true }); tt.el.append(b); }
    return b;
  }
  function renderView(id) {
    const s = sessions.get(id), b = boxOf(id), d = views.get(id);
    if (!b) return;
    b.hidden = !(s?.typeInfo && modeOf(id) === 'view') || !!s.locked;
    if (b.hidden) return;
    const ti = s.typeInfo, v = d?.view;
    const head = el('header', { class: 'tvHead' },
      el('span', { class: 'tvType', text: ti.badge || ti.name, style: ti.color ? `--tc:${ti.color}` : null }),
      el('div', { class: 'tvTitle' }, el('h2', { text: v?.title || s.name }), v?.subtitle ? el('div', { class: 'hint', text: v.subtitle }) : null,
        v?.meta?.length ? el('div', { class: 'tvMeta' }, v.meta.map(m => el('span', {}, el('span', { class: 'hint', text: `${m.label} ` }), m.value))) : null),
      el('div', { class: 'tvActs' }, ti.actions.map(a => el('button', {
        type: 'button', class: a.primary ? 'primary' : '', text: a.label,
        onclick: () => act(id, { action: a.id }, a.confirm ? `${a.label} ?` : ''),
      }))));
    const body = v?.sections?.length
      ? el('div', { class: 'tvBody' }, v.sections.map((x, i) => section(x, i, id)))
      : el('p', { class: 'tvEmpty', text: t('L’affichage se remplira quand Claude aura avancé. La conversation reste dans « Terminal ».') });
    b.replaceChildren(head, body);
  }
  async function loadView(id) {
    try { views.set(id, await api('GET', `/api/sessions/${id}/view`)); } catch { }
    renderView(id);
  }
  // barre du haut : badge du type + bascule Vue / Terminal
  F.renderTypeBar = s => {
    const badge = $('#curType'), btn = $('#btnView');
    const ti = s?.typeInfo;
    badge.hidden = btn.hidden = !ti;
    if (!ti) return;
    badge.textContent = ti.badge || ti.name;
    badge.style.setProperty('--tc', ti.color || 'var(--accent)');
    btn.textContent = modeOf(s.id) === 'view' ? t('Terminal') : t('Affichage');
    if (!views.has(s.id)) loadView(s.id); else renderView(s.id);
  };
  $('#btnView').onclick = () => {
    if (!active) return;
    LS2.set(`csm.view.${active}`, modeOf(active) === 'view' ? 'term' : 'view');
    F.renderTypeBar(sessions.get(active));
    if (modeOf(active) === 'term') terms.get(active)?.term.focus();
  };
  window.addEventListener('csm:view', e => { const id = e.detail; if (sessions.get(id)?.typeInfo) loadView(id); });
})();
