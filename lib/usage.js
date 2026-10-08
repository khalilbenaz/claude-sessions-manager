'use strict';
// Consommation (#20), chronologie des outils (#21) et export de conversation (#24),
// à partir des transcripts de Claude Code (~/.claude/projects/**/<id>.jsonl).
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');

// Tarifs API publics indicatifs ($ par million de tokens) : entrée, sortie. Cache : lecture ×0,1, écriture ×1,25.
const PRICES = [
  [/opus-4-[01]|opus-4-2025|claude-3-opus/, 15, 75],
  [/opus/, 5, 25],
  [/sonnet/, 3, 15],
  [/haiku-3/, 0.25, 1.25],
  [/haiku/, 1, 5],
  [/fable/, 3, 15],
];
function price(model) {
  for (const [re, i, o] of PRICES) if (re.test(model || '')) return { i, o };
  return { i: 3, o: 15 };
}
function cost(model, u) {
  const p = price(model);
  return ((u.in || 0) * p.i + (u.out || 0) * p.o + (u.cr || 0) * p.i * 0.1 + (u.cw || 0) * p.i * 1.25) / 1e6;
}

// ---------------------------------------------------------------- lecture incrémentale
const cache = new Map(); // fichier -> état
function fresh() { return { size: 0, offset: 0, rest: '', ids: new Set(), models: {}, hours: {}, tools: [], first: 0, last: 0 }; }

function target(input) {
  if (!input || typeof input !== 'object') return '';
  return String(input.file_path || input.path || input.notebook_path || input.command || input.pattern || input.url || input.query || input.description || input.prompt || '').slice(0, 300);
}

function ingest(st, line) {
  if (!line.startsWith('{')) return;
  let o; try { o = JSON.parse(line); } catch { return; }
  const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
  if (ts) { st.first = st.first || ts; st.last = Math.max(st.last, ts); }
  if (o.type !== 'assistant' || !o.message) return;
  const msg = o.message;
  // un même message est écrit sur plusieurs lignes (un bloc par ligne) : usage compté une fois
  const key = msg.id || o.requestId || o.uuid;
  const u = msg.usage;
  if (u && key && !st.ids.has(key)) {
    st.ids.add(key);
    const d = { in: u.input_tokens || 0, out: u.output_tokens || 0, cr: u.cache_read_input_tokens || 0, cw: u.cache_creation_input_tokens || 0 };
    const m = st.models[msg.model || '?'] = st.models[msg.model || '?'] || { in: 0, out: 0, cr: 0, cw: 0 };
    for (const k in d) m[k] += d[k];
    if (ts) {
      const h = Math.floor(ts / 3600e3) * 3600e3;
      const b = st.hours[h] = st.hours[h] || { in: 0, out: 0, cr: 0, cw: 0, cost: 0 };
      for (const k in d) b[k] += d[k];
      b.cost += cost(msg.model, d);
    }
  }
  for (const c of Array.isArray(msg.content) ? msg.content : []) {
    if (c.type === 'tool_use') {
      st.tools.push({ ts, name: c.name, target: target(c.input) });
      if (st.tools.length > 2000) st.tools.splice(0, st.tools.length - 2000);
    }
  }
}

function read(file) {
  let stat; try { stat = fs.statSync(file); } catch { return null; }
  let st = cache.get(file);
  if (!st || stat.size < st.size) { st = fresh(); cache.set(file, st); } // fichier réécrit : on repart de zéro
  if (stat.size > st.offset) {
    const fd = fs.openSync(file, 'r');
    try {
      const CH = 4 * 1024 * 1024;
      while (st.offset < stat.size) {
        const len = Math.min(CH, stat.size - st.offset);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, st.offset);
        st.offset += len;
        const lines = (st.rest + buf.toString('utf8')).split('\n');
        st.rest = lines.pop();
        for (const l of lines) ingest(st, l);
      }
    } finally { fs.closeSync(fd); }
  }
  st.size = stat.size;
  return st;
}

function totals(st, since = 0) {
  const t = { in: 0, out: 0, cr: 0, cw: 0, cost: 0 };
  for (const [h, b] of Object.entries(st.hours)) if (+h + 3600e3 > since) for (const k in t) t[k] += b[k];
  return t;
}

function findTranscript(id) {
  if (!/^[\w-]+$/.test(id || '')) return null;
  try { for (const d of fs.readdirSync(PROJECTS)) { const f = path.join(PROJECTS, d, `${id}.jsonl`); if (fs.existsSync(f)) return f; } } catch { }
  return null;
}

// ---------------------------------------------------------------- export Markdown
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(c => c.type === 'text' ? c.text : '').filter(Boolean).join('\n\n');
}
function exportMarkdown(file, title) {
  const out = [`# ${title || 'Conversation Claude Code'}`, ''];
  let meta = null, last = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!meta && o.cwd) { meta = o; out.push(`> Dossier : \`${o.cwd}\`${o.gitBranch && o.gitBranch !== 'HEAD' ? ` · branche \`${o.gitBranch}\`` : ''} · ${o.timestamp ? new Date(o.timestamp).toLocaleString('fr-FR') : ''}`, ''); }
    if (o.isMeta || o.isSidechain) continue;
    if (o.type === 'user' && o.message) {
      const c = o.message.content;
      if (Array.isArray(c) && c.every(x => x.type === 'tool_result')) continue; // résultats d'outils : trop verbeux
      const t = textOf(c).trim();
      if (!t || t.startsWith('<') || t.startsWith('Caveat:')) continue;
      out.push('## 🧑 Vous', '', t, ''); last = 'user';
    } else if (o.type === 'assistant' && o.message) {
      const parts = [];
      for (const c of Array.isArray(o.message.content) ? o.message.content : []) {
        if (c.type === 'text' && c.text.trim()) parts.push(c.text.trim());
        else if (c.type === 'tool_use') parts.push(`- 🔧 **${c.name}** ${target(c.input) ? '`' + target(c.input).replace(/`/g, "'").slice(0, 160) + '`' : ''}`);
      }
      if (parts.length) { if (last !== 'claude') out.push('## 🤖 Claude', ''); out.push(parts.join('\n\n'), ''); last = 'claude'; }
    }
  }
  return out.join('\n');
}

// Période demandée (?days=1|7|30) : 1 = depuis minuit, sinon fenêtre glissante. Défaut 7 (réponses d'avant).
const PERIODS = [1, 7, 30];
const periodOf = v => (PERIODS.includes(Number(v)) ? Number(v) : 7);
const sinceOf = n => { if (n === 1) { const d = new Date(); d.setHours(0, 0, 0, 0); return +d; } return Date.now() - n * 86400e3; };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// jours calendaires (clés AAAA-MM-JJ locales) couverts par la période, aujourd'hui compris
const dayKeysOf = n => Array.from({ length: n }, (_, i) => dayKey(new Date(Date.now() - i * 86400e3)));
const num = x => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : 0);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Document d'usage reçu d'une autre machine (synchro, csmcfg-usage-*) : agrégats seulement, valeurs bornées.
//   days : { jour: { w: secondes de travail, c: coût estimé, t: tokens } }
//   sessions : { syncId: { n: nom, d: { jour: { w, c, t } } } }
function cleanDoc(d) {
  if (!d || typeof d !== 'object') return null;
  const cell = x => ({ w: Math.round(num(x?.w)), c: Math.round(num(x?.c) * 1e4) / 1e4, t: Math.round(num(x?.t)) });
  const days = {}, sessions = {};
  for (const [k, v] of Object.entries(d.days || {}).slice(0, 45)) if (DAY_RE.test(k)) days[k] = cell(v);
  for (const [id, v] of Object.entries(d.sessions || {}).slice(0, 60)) {
    if (!/^[\w-]{1,40}$/.test(id)) continue;
    const dd = {};
    for (const [k, c] of Object.entries(v?.d || {}).slice(0, 45)) if (DAY_RE.test(k)) dd[k] = cell(c);
    sessions[id] = { n: String(v?.n || '').slice(0, 80), d: dd };
  }
  return { name: String(d.name || '?').slice(0, 80), platform: String(d.platform || '').slice(0, 20), days, sessions };
}

module.exports = function (ctx) {
  const { route, on, json, sessions, history } = ctx;
  const machineName = () => String(ctx.getSettings?.().syncMachine || '').trim() || os.hostname();

  // Temps de travail de Claude : relevé toutes les 15 s (sessions « travaille »), par jour et par session ;
  // « sans toi » = pendant que la file d'attente envoyait les demandes. Gardé 35 jours (DATA/worktime.json).
  const WT = path.join(ctx.DATA, 'worktime.json');
  let wt = {}; try { wt = JSON.parse(fs.readFileSync(WT, 'utf8')); } catch { }
  let wtDirty = false;
  setInterval(() => {
    const k = dayKey(), day = wt[k] || (wt[k] = { total: 0, queued: 0, sessions: {} });
    for (const s of sessions.values()) {
      if (s.status !== 'working' || !s.pty) continue;
      day.total += 15; day.sessions[s.id] = (day.sessions[s.id] || 0) + 15; wtDirty = true;
      if (s.fromQueue) day.queued += 15;
    }
    const old = dayKey(new Date(Date.now() - 35 * 86400e3));
    for (const d of Object.keys(wt)) if (d < old) { delete wt[d]; wtDirty = true; }
  }, 15e3).unref?.();
  setInterval(() => { if (wtDirty) { wtDirty = false; try { fs.writeFileSync(WT, JSON.stringify(wt)); } catch { } } }, 60e3).unref?.();
  // temps de travail cumulé sur les n derniers jours (jour en cours compris)
  const workOver = n => {
    const out = { total: 0, queued: 0, sessions: {} };
    for (const k of dayKeysOf(n)) {
      const d = wt[k]; if (!d) continue;
      out.total += d.total; out.queued += d.queued;
      for (const [id, v] of Object.entries(d.sessions || {})) out.sessions[id] = (out.sessions[id] || 0) + v;
    }
    return out;
  };
  ctx.workTime = (n = 1) => ({
    today: wt[dayKey()] || { total: 0, queued: 0, sessions: {} },
    days: Object.fromEntries(Object.entries(wt).map(([d, v]) => [d, v.total])),
    period: workOver(n), nbDays: n,
  });
  route('GET', /^\/api\/worktime$/, async ({ res, url }) => json(res, 200, ctx.workTime(periodOf(url.searchParams.get('days')))));

  route('GET', /^\/api\/sessions\/(\w+)\/usage$/, async ({ res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const f = findTranscript(s.claudeSessionId);
    if (!f) return json(res, 200, { total: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 }, models: {} });
    const st = read(f);
    const models = Object.fromEntries(Object.entries(st.models).map(([k, v]) => [k, { ...v, cost: cost(k, v) }]));
    json(res, 200, { total: totals(st), models, since: st.first, last: st.last });
  });

  // Quota 7 jours : un point par heure (ou à chaque changement), gardé 8 jours dans DATA/quota7.json, pour la
  // prévision du tableau d'usage (même calcul que pour les 5 h, sur le rythme des dernières 24 h).
  const Q7 = path.join(ctx.DATA, 'quota7.json');
  let hist7 = []; try { hist7 = JSON.parse(fs.readFileSync(Q7, 'utf8')).filter(x => x && Number.isFinite(x.t) && Number.isFinite(x.pct)); } catch { }
  on('quota', (s, d) => {
    const pct = Number(d?.seven?.pct), r = Number(d?.seven?.resetAt);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1000) return;
    const resetAt = Number.isFinite(r) && r > 0 ? r : 0, last = hist7[hist7.length - 1], now = Date.now();
    if (last && last.pct === pct && last.resetAt === resetAt && now - last.t < 3600e3) return;
    hist7.push({ t: now, pct, resetAt });
    while (hist7.length > 400 || (hist7.length && now - hist7[0].t > 8 * 86400e3)) hist7.shift();
    try { fs.writeFileSync(Q7, JSON.stringify(hist7)); } catch { }
  });
  // { hist7, forecast7 } pour GET /api/quota (lib/queue.js) ; forecast7 : null si pas assez de mesures
  ctx.quota7 = () => {
    const sv = ctx.quota?.seven, now = Date.now();
    const hist = hist7.filter(x => !sv || x.resetAt === sv.resetAt).map(x => ({ t: x.t, pct: x.pct }));
    let forecast7 = null;
    const h = hist.filter(x => now - x.t < 24 * 3600e3);
    if (sv && h.length >= 2) {
      const a = h[0], b = h[h.length - 1], dt = (b.t - a.t) / 3600e3;
      if (dt >= (Number(process.env.CSM_QUOTA7_MIN_H) || 0.5)) { // au moins 30 min de mesures
        const perHour = (b.pct - a.pct) / dt;
        if (perHour <= 0) forecast7 = { perHour: 0, limitAt: 0 };
        else { const limitAt = now + ((100 - sv.pct) / perHour) * 3600e3; forecast7 = { perHour, limitAt: sv.resetAt && limitAt > sv.resetAt ? 0 : limitAt }; }
      }
    }
    return { hist7: hist, forecast7 };
  };

  // transcripts de tous les projets modifiés depuis `since`
  function recent(since) {
    const out = [];
    let dirs = []; try { dirs = fs.readdirSync(PROJECTS); } catch { }
    for (const d of dirs) {
      if (/observer-sessions/i.test(d)) continue;
      let files; try { files = fs.readdirSync(path.join(PROJECTS, d)).filter(x => x.endsWith('.jsonl')); } catch { continue; }
      for (const x of files) {
        const file = path.join(PROJECTS, d, x);
        let stat; try { stat = fs.statSync(file); } catch { continue; }
        if (stat.mtimeMs < since) continue;
        const st = read(file); if (st) out.push({ id: path.basename(x, '.jsonl'), st });
      }
    }
    return out;
  }

  // Agrégats de cette machine sur 30 jours, publiés tels quels dans le document de synchro (lib/sync.js) :
  // par jour (travail, coût, tokens) et par session synchronisée (nom, mêmes mesures). Aucun contenu de conversation.
  ctx.usageDoc = () => {
    const since = sinceOf(30), days = {}, ses = {};
    const bySid = new Map([...sessions.values()].filter(s => s.claudeSessionId && s.syncId).map(s => [s.claudeSessionId, s]));
    const cell = (o, k) => o[k] || (o[k] = { w: 0, c: 0, t: 0 });
    for (const { id, st } of recent(since)) {
      const s = bySid.get(id);
      for (const [h, b] of Object.entries(st.hours)) {
        if (+h + 3600e3 <= since) continue;
        const k = dayKey(new Date(+h)), tk = b.in + b.out + b.cr + b.cw;
        const c = cell(days, k); c.c += b.cost; c.t += tk;
        if (s) { const e = ses[s.syncId] || (ses[s.syncId] = { n: s.name, d: {} }), x = cell(e.d, k); x.c += b.cost; x.t += tk; }
      }
    }
    const byId = new Map([...sessions.values()].filter(s => s.syncId).map(s => [s.id, s]));
    for (const k of dayKeysOf(30)) {
      const d = wt[k]; if (!d) continue;
      cell(days, k).w += d.total;
      for (const [sid, v] of Object.entries(d.sessions || {})) {
        const s = byId.get(sid); if (!s) continue;
        const e = ses[s.syncId] || (ses[s.syncId] = { n: s.name, d: {} }); cell(e.d, k).w += v;
      }
    }
    const weight = e => Object.values(e.d).reduce((n, x) => n + x.c + x.w / 3600, 0);
    const top = Object.entries(ses).sort((a, b) => weight(b[1]) - weight(a[1])).slice(0, 40);
    return cleanDoc({ days, sessions: Object.fromEntries(top) });
  };

  // Vue globale sur la période (?days=1|7|30, défaut 7) ; ?scope=all ajoute les autres machines synchronisées.
  route('GET', /^\/api\/usage$/, async ({ res, url }) => {
    const n = periodOf(url.searchParams.get('days')), now = Date.now(), weekAgo = now - 7 * 86400e3, since = sinceOf(n);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const zero = () => ({ in: 0, out: 0, cr: 0, cw: 0, cost: 0 });
    const agg = { h5: zero(), today: zero(), d7: zero() }, period = zero();
    const perDay = {}, top = [];
    const titles = new Map(history().map(h => [h.id, h.title]));
    const managed = new Map([...sessions.values()].filter(s => s.claudeSessionId).map(s => [s.claudeSessionId, s]));
    const work = workOver(n);
    const add = (a, b) => { for (const k in a) a[k] += b[k]; };
    for (const { id, st } of recent(Math.min(weekAgo, since))) {
      add(agg.h5, totals(st, now - 5 * 3600e3)); add(agg.today, totals(st, +today)); add(agg.d7, totals(st, weekAgo));
      const w = totals(st, since); add(period, w);
      for (const [h, b] of Object.entries(st.hours)) {
        if (+h + 3600e3 <= since) continue;
        const day = new Date(+h).toISOString().slice(0, 10);
        perDay[day] = (perDay[day] || 0) + b.in + b.out + b.cr + b.cw;
      }
      const s = managed.get(id);
      if (w.out) top.push({ id, name: s?.name || titles.get(id) || id.slice(0, 8), work: s ? work.sessions[s.id] || 0 : 0, ...w });
    }
    top.sort((a, b) => b.cost - a.cost);
    const out = { ...agg, period, days: n, perDay, top: top.slice(0, 15), note: 'Coût estimé aux tarifs API publics ; indicatif (inclus dans un abonnement Claude).' };
    if (url.searchParams.get('scope') === 'all') {
      const tk = x => x.in + x.out + x.cr + x.cw;
      const keys = dayKeysOf(n), me = machineName();
      const machines = [{ id: '', me: true, name: me, platform: process.platform, work: work.total, cost: period.cost, tokens: tk(period) }];
      const rows = out.top.map(x => ({ machine: me, name: x.name, work: x.work, tokens: tk(x), cost: x.cost }));
      for (const r of ctx.remoteUsage?.() || []) {
        const sum = o => keys.reduce((a, k) => { const c = o[k]; if (c) { a.w += c.w; a.c += c.c; a.t += c.t; } return a; }, { w: 0, c: 0, t: 0 });
        const t = sum(r.days);
        machines.push({ id: r.id, me: false, name: r.name, platform: r.platform, work: t.w, cost: t.c, tokens: t.t });
        for (const v of Object.values(r.sessions)) { const x = sum(v.d); if (x.w || x.c || x.t) rows.push({ machine: r.name, name: v.n, work: x.w, tokens: x.t, cost: x.c }); }
      }
      rows.sort((a, b) => b.cost - a.cost);
      out.all = { machines, rows: rows.slice(0, 30), total: machines.reduce((a, m) => ({ work: a.work + m.work, cost: a.cost + m.cost, tokens: a.tokens + m.tokens }), { work: 0, cost: 0, tokens: 0 }) };
    }
    json(res, 200, out);
  });

  route('GET', /^\/api\/sessions\/(\w+)\/timeline$/, async ({ res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const f = findTranscript(s.claudeSessionId);
    json(res, 200, f ? read(f).tools.slice(-500) : []);
  });

  route('GET', /^\/api\/history\/([\w-]+)\/export$/, async ({ res, m }) => {
    const f = findTranscript(m[1]); if (!f) return json(res, 404, { error: 'conversation introuvable' });
    const title = (history().find(h => h.id === m[1]) || {}).title;
    json(res, 200, { title: title || m[1], markdown: exportMarkdown(f, title) });
  });
};
module.exports.cost = cost;
module.exports.cleanDoc = cleanDoc;
