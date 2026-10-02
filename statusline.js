'use strict';
// Barre d'état fournie par Claude Sessions Manager aux sessions qu'il lance (si l'utilisateur n'a pas la sienne) :
// quotas 5 h / 7 j avec l'heure du reset, contexte utilisé, modèle.  Ex. :
//   5h 20% ↻ 13:21 (2h09) · 7j 90% ↻ jeu 18:44 (2j7h) · ctx 42% · Opus 5.5
// Claude Code envoie l'état en JSON sur stdin ; ne doit jamais échouer.
const ESC = '\x1b[', RST = ESC + '0m', GRAY = ESC + '90m', CYAN = ESC + '1;36m', WHITE = ESC + '1;37m';
const color = p => ESC + (p >= 90 ? '1;31m' : p >= 70 ? '1;33m' : '1;32m');
const LABELS = { five_hour: '5h', seven_day: '7j', seven_day_opus: '7j-opus', seven_day_sonnet: '7j-sonnet' };
const EN = /^en/i.test(process.env.CSM_LANG || '');
const DAYS = EN ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

const num = (o, ...ks) => { for (const k of ks) if (typeof o?.[k] === 'number') return o[k]; };

function resetAt(w) {
  const v = w?.resets_at ?? w?.resetsAt ?? w?.reset_at;
  if (typeof v === 'number' && v > 0) return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v === 'string' && v) { const d = /^\d+(\.\d+)?$/.test(v) ? new Date(+v > 1e12 ? +v : +v * 1000) : new Date(v); return isNaN(d) ? null : d; }
  return null;
}

function fmtReset(d, now = new Date()) {
  if (!d) return '';
  const s = Math.max(0, Math.floor((d - now) / 1000));
  const days = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  const rel = days ? `${days}${EN ? 'd' : 'j'}${h}h` : h ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.toDateString() === now.toDateString() ? hm : `${DAYS[d.getDay()]} ${hm}`} (${rel})`;
}

function render(p, now) {
  const parts = [];
  const wins = [];
  for (const [k, w] of Object.entries(p.rate_limits || {})) {
    const pct = num(w, 'used_percentage', 'usedPercentage', 'utilization');
    if (pct === undefined) continue;
    wins.push({ label: LABELS[k] || k.replace(/_/g, '-'), pct, reset: fmtReset(resetAt(w), now) });
  }
  const rank = l => (l === '5h' ? 0 : l === '7j' ? 1 : 2);
  wins.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
  for (const w of wins) parts.push(`${w.label} ${color(w.pct)}${Math.round(w.pct)}%${RST}${w.reset ? ` ${GRAY}↻ ${w.reset}${RST}` : ''}`);
  const ctx = num(p.context_window, 'used_percentage', 'usedPercentage');
  if (ctx !== undefined) parts.push(`ctx ${color(ctx)}${Math.round(ctx)}%${RST}`);
  else { const t = num(p.context || p.context_window, 'used_tokens', 'usedTokens', 'total_input_tokens'); if (t) parts.push(`${WHITE}ctx ${Math.round(t / 1000)}k${RST}`); }
  const model = p.model?.display_name || p.model?.id;
  if (model) parts.push(`${CYAN}${model}${RST}`);
  return parts.join(` ${GRAY}·${RST} `);
}

// Quotas transmis au serveur de l'app (file d'attente en pause près de la limite, lib/queue.js) : au plus
// toutes les 30 s par session, sans jamais retarder l'affichage.
function quotaOf(p) {
  const w = p.rate_limits?.five_hour;
  const pct = num(w, 'used_percentage', 'usedPercentage', 'utilization');
  if (pct === undefined) return null;
  const r = resetAt(w);
  return { pct, resetAt: r ? r.getTime() : 0 };
}
function report(p, cb) {
  const { CSM_ID, CSM_PORT, CSM_TOKEN } = process.env;
  const q = CSM_ID && CSM_PORT && quotaOf(p);
  if (!q) return cb();
  const mark = require('path').join(require('os').tmpdir(), `csm-quota-${CSM_PORT}-${CSM_ID}`);
  try { if (Date.now() - require('fs').statSync(mark).mtimeMs < 30e3) return cb(); } catch { }
  try { require('fs').writeFileSync(mark, ''); } catch { }
  const body = JSON.stringify({ csm: CSM_ID, event: 'quota', data: q });
  const req = require('http').request({
    host: '127.0.0.1', port: Number(CSM_PORT), path: '/api/hook', method: 'POST', timeout: 1500,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-CSM-Token': CSM_TOKEN, Host: `127.0.0.1:${CSM_PORT}` },
  }, res => { res.resume(); res.on('end', cb); });
  req.on('error', cb); req.on('timeout', () => { req.destroy(); cb(); });
  req.end(body);
}

if (require.main === module) {
  let input = '', finished = false;
  const done = () => {
    if (finished) return; finished = true;
    let p = {}; try { p = JSON.parse(input || '{}'); } catch { }
    try { process.stdout.write(render(p) + '\n'); } catch { }
    let out = false; const exit = () => { if (!out) { out = true; process.exit(0); } };
    try { report(p, exit); } catch { exit(); }
    setTimeout(exit, 1800);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { input += c; });
  process.stdin.on('end', done);
  setTimeout(done, 3000);
}

module.exports = { render, fmtReset, resetAt, quotaOf };
