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

module.exports = function (ctx) {
  const { route, json, sessions, history } = ctx;

  route('GET', /^\/api\/sessions\/(\w+)\/usage$/, async ({ res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const f = findTranscript(s.claudeSessionId);
    if (!f) return json(res, 200, { total: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 }, models: {} });
    const st = read(f);
    const models = Object.fromEntries(Object.entries(st.models).map(([k, v]) => [k, { ...v, cost: cost(k, v) }]));
    json(res, 200, { total: totals(st), models, since: st.first, last: st.last });
  });

  // Vue globale : transcripts modifiés ces 7 derniers jours.
  route('GET', /^\/api\/usage$/, async ({ res }) => {
    const now = Date.now(), weekAgo = now - 7 * 86400e3;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const agg = { h5: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 }, today: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 }, d7: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 } };
    const perDay = {}, top = [];
    const titles = new Map(history().map(h => [h.id, h.title]));
    const managed = new Map([...sessions.values()].filter(s => s.claudeSessionId).map(s => [s.claudeSessionId, s.name]));
    let dirs = []; try { dirs = fs.readdirSync(PROJECTS); } catch { }
    for (const d of dirs) {
      if (/observer-sessions/i.test(d)) continue;
      let files; try { files = fs.readdirSync(path.join(PROJECTS, d)).filter(x => x.endsWith('.jsonl')); } catch { continue; }
      for (const x of files) {
        const file = path.join(PROJECTS, d, x);
        let stat; try { stat = fs.statSync(file); } catch { continue; }
        if (stat.mtimeMs < weekAgo) continue;
        const st = read(file); if (!st) continue;
        const add = (a, b) => { for (const k in a) a[k] += b[k]; };
        add(agg.h5, totals(st, now - 5 * 3600e3)); add(agg.today, totals(st, +today)); add(agg.d7, totals(st, weekAgo));
        for (const [h, b] of Object.entries(st.hours)) {
          if (+h < weekAgo) continue;
          const day = new Date(+h).toISOString().slice(0, 10);
          perDay[day] = (perDay[day] || 0) + b.in + b.out + b.cr + b.cw;
        }
        const w = totals(st, weekAgo);
        const id = path.basename(x, '.jsonl');
        if (w.out) top.push({ id, name: managed.get(id) || titles.get(id) || id.slice(0, 8), ...w });
      }
    }
    top.sort((a, b) => b.cost - a.cost);
    json(res, 200, { ...agg, perDay, top: top.slice(0, 15), note: 'Coût estimé aux tarifs API publics ; indicatif (inclus dans un abonnement Claude).' });
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
