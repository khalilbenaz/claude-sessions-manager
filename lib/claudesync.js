'use strict';
// Configuration de Claude partagée entre les machines synchronisées : règles (CLAUDE.md et les .md qu'il importe),
// skills, agents, commandes et mémoire automatique de Claude (~/.claude/projects/<dossier>/memory).
// Un fichier = une entrée chiffrée « cf-<empreinte du chemin> », la plus récente gagne ; ce qui est remplacé
// ou supprimé sur cette machine est d'abord copié dans DATA/claude-sync-backup.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const PREFIX = 'cf-';
const MAX_FILE = 2 * 1024 * 1024, MAX_FILES = 3000, MAX_DEPTH = 8;
const SKIP = /^(\.|node_modules$|__pycache__$|\.git$)/;
// catégorie → réglage, et racines (chemins portables relatifs à ~/.claude)
const KINDS = {
  rules: { setting: 'syncClaudeRules', test: p => /^[^/]+\.md$/.test(p) || p.startsWith('rules/') },
  skills: { setting: 'syncClaudeSkills', test: p => p.startsWith('skills/') },
  agents: { setting: 'syncClaudeAgents', test: p => p.startsWith('agents/') || p.startsWith('commands/') },
  memory: { setting: 'syncClaudeMemory', test: p => /^projects\/~[^/]*\/memory\//.test(p) },
};
const kindOf = p => Object.keys(KINDS).find(k => KINDS[k].test(p));
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const encode = p => p.replace(/[^a-zA-Z0-9]/g, '-'); // nom des dossiers de projets de Claude Code

// Chemin portable reçu → chemin local (refusé s'il sort de ~/.claude ou ne correspond à aucune catégorie).
function toLocal(p, dir = claudeDir(), home = os.homedir()) {
  if (typeof p !== 'string' || p.length > 400 || !kindOf(p)) return null;
  const seg = p.split('/');
  if (seg.some(s => !s || s === '.' || s === '..' || /[\\:\0]/.test(s))) return null;
  if (seg[0] === 'projects') seg[1] = encode(home) + seg[1].slice(1);
  const abs = path.join(dir, ...seg);
  return abs.startsWith(dir + path.sep) ? abs : null;
}

// Fichiers locaux des catégories actives : Map chemin portable → { abs, data, x, mtime }.
function scan(on, dir = claudeDir(), home = os.homedir()) {
  const out = new Map(), seen = new Set();
  const add = (p, abs, st) => {
    if (out.size >= MAX_FILES || st.size > MAX_FILE || !on(kindOf(p))) return;
    try { out.set(p, { abs, data: fs.readFileSync(abs), x: !!(st.mode & 0o100), mtime: Math.round(st.mtimeMs) }); } catch { }
  };
  const walk = (abs, p, depth) => {
    let real; try { real = fs.realpathSync(abs); } catch { return; }
    if (seen.has(real) || depth > MAX_DEPTH) return;
    seen.add(real);
    let names; try { names = fs.readdirSync(abs); } catch { return; }
    for (const n of names.sort()) {
      if (SKIP.test(n)) continue;
      const a = path.join(abs, n);
      let st; try { st = fs.statSync(a); } catch { continue; } // suit les liens (skill pointant vers un projet)
      if (st.isDirectory()) walk(a, p + n + '/', depth + 1);
      else if (st.isFile()) add(p + n, a, st);
    }
  };
  let top = []; try { top = fs.readdirSync(dir); } catch { }
  for (const n of top) {
    const a = path.join(dir, n);
    let st; try { st = fs.statSync(a); } catch { continue; }
    if (st.isFile() && /\.md$/.test(n)) add(n, a, st);
  }
  for (const d of ['rules', 'skills', 'agents', 'commands']) if (on(kindOf(d + '/x'))) walk(path.join(dir, d), d + '/', 0);
  if (on('memory')) {
    const h = encode(home);
    let projects = []; try { projects = fs.readdirSync(path.join(dir, 'projects')); } catch { }
    for (const n of projects) if (n.startsWith(h)) walk(path.join(dir, 'projects', n, 'memory'), `projects/~${n.slice(h.length)}/memory/`, 0);
  }
  return out;
}

// Contenu chiffré d'une entrée : { p, d (base64), x } ou { p, del: 1 } pour une suppression.
const rawOf = (p, f) => Buffer.from(JSON.stringify(f ? { p, d: f.data.toString('base64'), x: f.x ? 1 : 0 } : { p, del: 1 }));

module.exports = function ({ DATA, settings, call, seal, unseal, txVersion, remote, machine, getState, saveState, status }) {
  const on = k => !!k && settings()[KINDS[k].setting] !== false;
  const anyOn = () => Object.keys(KINDS).some(on);
  const aad = (uid, ver, updatedAt) => `c|${uid}|${ver}|${updatedAt}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  function backup(p, abs) {
    try {
      const to = path.join(DATA, 'claude-sync-backup', stamp, ...p.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(abs, to);
    } catch { }
  }

  return async function syncClaude(cfg) {
    if (!cfg || !anyOn()) return;
    const state = getState(), st = state.cf || (state.cf = { files: {}, got: {}, paths: {}, at: {} });
    st.at ||= {};
    const uidOf = p => PREFIX + txVersion(cfg.key, Buffer.from('cf-path|' + p));
    const local = scan(on);
    const verOf = p => txVersion(cfg.key, rawOf(p, local.get(p)));
    const R = await remote();

    // 1. ce qui a changé ailleurs
    for (const [uid, r] of R) {
      if (!uid.startsWith(PREFIX) || st.got[uid] === r.ver) continue;
      if (st.paths[uid] && !on(kindOf(st.paths[uid]))) continue;
      if (!/^[0-9a-f]{32}$/.test(String(r.ver)) || !(Number.isInteger(r.chunks) && r.chunks >= 1 && r.chunks <= 4)) continue;
      const parts = [];
      for (let n = 0; n < r.chunks; n++) parts.push(await call('GET', `/transcripts/${uid}/${r.ver}/${n}`, undefined, true));
      let e;
      try {
        const raw = zlib.gunzipSync(unseal(cfg.key, Buffer.concat(parts), aad(uid, r.ver, r.updatedAt)));
        if (txVersion(cfg.key, raw) !== r.ver) continue;
        e = JSON.parse(raw.toString('utf8'));
      } catch { continue; }
      const p = e && e.p, abs = toLocal(p);
      if (!abs || uidOf(p) !== uid) { st.got[uid] = r.ver; continue; }
      st.paths[uid] = p;
      if (!on(kindOf(p))) continue;
      const f = local.get(p), mine = verOf(p);
      st.got[uid] = r.ver;
      if (mine === r.ver) { st.files[p] = r.ver; st.at[p] = r.updatedAt; continue; }
      // modifié ici depuis la dernière synchro, et plus récemment : c'est notre version qui partira
      if (st.files[p] !== mine && (f ? f.mtime : 0) > r.updatedAt) continue;
      if (st.files[p] === mine && r.updatedAt < (st.at[p] || 0)) continue; // version plus ancienne que la nôtre
      try { if (fs.lstatSync(abs).isSymbolicLink()) continue; } catch { }
      if (f) backup(p, abs);
      try {
        if (e.del) { if (f) fs.rmSync(abs, { force: true }); local.delete(p); }
        else {
          const data = Buffer.from(String(e.d || ''), 'base64');
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          const tmp = abs + '.csm-tmp';
          fs.writeFileSync(tmp, data, { mode: e.x ? 0o755 : 0o644 });
          fs.renameSync(tmp, abs);
          local.set(p, { abs, data, x: !!e.x, mtime: Date.now() });
        }
      } catch { continue; }
      st.files[p] = r.ver; st.at[p] = r.updatedAt;
      status.cfDown++;
      saveState();
    }

    // 2. ce qui a changé ici (nouveaux fichiers, modifications, suppressions de fichiers déjà synchronisés)
    const todo = new Set([...local.keys(), ...Object.keys(st.files).filter(p => on(kindOf(p)))]);
    for (const p of todo) {
      const f = local.get(p), raw = rawOf(p, f), ver = txVersion(cfg.key, raw);
      if (st.files[p] === ver || (!f && st.files[p] === undefined)) continue;
      const uid = uidOf(p), r = R.get(uid);
      const updatedAt = Math.max(f ? f.mtime : Date.now(), r ? r.updatedAt + 1 : 0);
      const blob = seal(cfg.key, zlib.gzipSync(raw), aad(uid, ver, updatedAt));
      const chunks = Math.ceil(blob.length / (1024 * 1024)) || 1;
      if (chunks > 4) continue;
      for (let n = 0; n < chunks; n++) await call('PUT', `/transcripts/${uid}/${ver}/${n}`, blob.subarray(n * 1024 * 1024, (n + 1) * 1024 * 1024));
      await call('PUT', `/transcripts/${uid}`, { cid: 'claude', ver, chunks, size: blob.length, updatedAt, origin: machine() });
      st.files[p] = ver; st.at[p] = updatedAt; st.got[uid] = ver; st.paths[uid] = p;
      status.cfUp++;
      saveState();
    }
    status.cfFiles = local.size;
  };
};

module.exports.scan = scan;
module.exports.toLocal = toLocal;
module.exports.KINDS = KINDS;
