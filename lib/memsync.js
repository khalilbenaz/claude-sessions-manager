'use strict';
// Mémoire claude-mem synchronisée (memoryEngine = claude-mem, réglage syncSessionMemory) : les observations, résumés de session et prompts de
// la base claude-mem des sessions Claude Sessions partent chiffrés dans l'espace de synchro, et celles des
// autres machines sont chargées dans la base d'ici. Une machine qui rejoint l'espace (même code) récupère
// donc toute la mémoire dès sa première synchronisation.
//
// Par lots : chaque lot est un blob chiffré (AES-256-GCM, clé du code) rangé comme une conversation, uid
// « mem-<machine>-<n> » : le serveur ne voit que des octets opaques. Seules les lignes nées ici
// (origin_device_id vide) sont envoyées ; celles reçues sont marquées origin_device_id = « csm-<machine> » et
// origin_local_id = id d'origine — les index uniques de claude-mem empêchent tout doublon, et une ligne
// reçue n'est jamais renvoyée.
//
// Ajout seulement (une mémoire effacée ici ne l'est pas ailleurs). La recherche plein texte de claude-mem
// voit tout de suite les lignes reçues ; la recherche sémantique (Chroma) seulement après sa réindexation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TABLES = ['observations', 'session_summaries', 'user_prompts'];
const BUDGET = 4 * 1024 * 1024;       // octets JSON par lot (≈ 1 Mo une fois compressé)
const MAX_BATCHES = 8;                // lots envoyés par synchronisation (le reste suit à la suivante)
const PREFIX = 'mem-';
const ident = c => /^[a-z_][a-z0-9_]{0,63}$/i.test(c);

// Espace claude-mem propre à Claude Sessions (<données>/claude-mem) : seules les sessions lancées par
// l'application l'utilisent (variable CLAUDE_MEM_DATA_DIR + worker sur son propre port) ; claude lancé dans le
// terminal du système garde sa mémoire locale (~/.claude-mem), jamais lue ni modifiée ici.
const memDir = DATA => process.env.CSM_MEM_DB ? path.dirname(process.env.CSM_MEM_DB) : path.join(DATA, 'claude-mem');
const dbPath = DATA => process.env.CSM_MEM_DB || path.join(memDir(DATA), 'claude-mem.db');

// Réglages de l'espace : ceux de claude-mem de l'utilisateur (modèle, fournisseur…), avec notre dossier et un
// port de worker distinct (sinon les sessions parleraient au worker du terminal, donc à sa base).
function prepare(DATA) {
  const dir = memDir(DATA);
  fs.mkdirSync(dir, { recursive: true });
  let base = {};
  try { base = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude-mem', 'settings.json'), 'utf8')); } catch { }
  const port = String((Number(base.CLAUDE_MEM_WORKER_PORT) || 37777) + 13);
  // sans le message d'accueil « This project has no memory yet… » en tête de chaque session
  const want = { ...base, CLAUDE_MEM_WELCOME_HINT_ENABLED: 'false', CLAUDE_MEM_DATA_DIR: dir, CLAUDE_MEM_WORKER_PORT: port };
  const file = path.join(dir, 'settings.json');
  let cur = null;
  try { cur = fs.readFileSync(file, 'utf8'); } catch { }
  const txt = JSON.stringify(want, null, 2);
  if (cur !== txt) fs.writeFileSync(file, txt);
  return { CLAUDE_MEM_DATA_DIR: dir, CLAUDE_MEM_WORKER_PORT: port };
}

// Base absente (aucune session encore lancée ici) : le worker claude-mem la crée, pour charger la mémoire
// des autres machines avant la première session.
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const rootOf = r => { const q = fs.existsSync(path.join(r, 'plugin', 'scripts')) ? path.join(r, 'plugin') : r; return fs.existsSync(path.join(q, 'scripts', 'worker-service.cjs')) ? q : null; };
function pluginRoot() {
  try {
    const inst = JSON.parse(fs.readFileSync(path.join(claudeDir(), 'plugins', 'installed_plugins.json'), 'utf8'));
    const e = (inst.plugins || inst)['claude-mem@thedotmack'];
    const p = Array.isArray(e) ? e[0]?.installPath : e?.installPath;
    const q = p && rootOf(p);
    if (q) return q;
  } catch { }
  const base = path.join(claudeDir(), 'plugins', 'cache', 'thedotmack', 'claude-mem');
  let vs = [];
  try { vs = fs.readdirSync(base).filter(v => /^\d+\.\d+\.\d+$/.test(v) && !fs.existsSync(path.join(base, v, '.orphaned_at'))); } catch { return null; }
  vs.sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  for (const v of vs.reverse()) {
    const r = path.join(base, v), q = fs.existsSync(path.join(r, 'plugin', 'scripts')) ? path.join(r, 'plugin') : r;
    if (fs.existsSync(path.join(q, 'scripts', 'worker-service.cjs'))) return q;
  }
  return null;
}
function ensureDb(DATA, env) {
  if (fs.existsSync(dbPath(DATA)) || process.env.CSM_MEM_DB) return Promise.resolve();
  const root = pluginRoot();
  if (!root) return Promise.resolve();
  return new Promise(res => {
    require('child_process').execFile(process.platform === 'win32' ? 'node.exe' : 'node',
      [path.join(root, 'scripts', 'bun-runner.js'), path.join(root, 'scripts', 'worker-service.cjs'), 'start'],
      { env: { ...process.env, ...env }, timeout: 90e3, windowsHide: true }, () => res());
  });
}

function open(DATA) {
  const file = dbPath(DATA);
  if (!fs.existsSync(file)) return null;
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { throw new Error('SQLite indisponible dans ce Node'); }
  // comme claude-mem : clés étrangères non imposées (sa base contient des lignes orphelines)
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec('PRAGMA busy_timeout = 10000');
  const cols = {};
  for (const t of ['sdk_sessions', ...TABLES]) cols[t] = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  if (!cols.sdk_sessions.includes('memory_session_id') || TABLES.some(t => !cols[t].includes('origin_device_id') || !cols[t].includes('origin_local_id'))) {
    db.close();
    throw Object.assign(new Error('version de claude-mem trop ancienne (mettre claude-mem à jour)'), { code: 'CLAUDE_MEM_OLD' });
  }
  return { db, cols };
}

// Colonnes propres à une machine : jamais envoyées.
const LOCAL = new Set(['id', 'worker_port', 'synced_at', 'sync_rev', 'origin_device_id', 'origin_local_id', 'session_db_id']);
const strip = r => Object.fromEntries(Object.entries(r).filter(([k]) => !LOCAL.has(k)).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));

// Prochain lot à envoyer (lignes nées ici, après le filigrane de chaque table) et filigranes après ce lot.
function exportBatch(M, wm) {
  const out = { sessions: [] }, next = { ...wm };
  let size = 0;
  const memIds = new Set(), dbIds = new Set();
  for (const t of TABLES) {
    out[t] = [];
    const q = M.db.prepare(`SELECT * FROM ${t} WHERE id > ? AND origin_device_id IS NULL ORDER BY id LIMIT 200`);
    while (size < BUDGET) {
      const rows = q.all(next[t] || 0);
      if (!rows.length) break;
      for (const r of rows) {
        if (size >= BUDGET) break;
        const row = { ...strip(r), rid: Number(r.id) };
        size += JSON.stringify(row).length;
        out[t].push(row);
        next[t] = Number(r.id);
        if (r.memory_session_id) memIds.add(r.memory_session_id);
        if (r.session_db_id != null) dbIds.add(Number(r.session_db_id));
      }
    }
  }
  const seen = new Set();
  const addSessions = (sql, ids) => {
    const list = [...ids];
    for (let i = 0; i < list.length; i += 400) {
      const part = list.slice(i, i + 400);
      for (const s of M.db.prepare(sql.replace('?', part.map(() => '?').join(','))).all(...part)) {
        if (seen.has(Number(s.id))) continue;
        seen.add(Number(s.id));
        out.sessions.push(strip(s));
      }
    }
  };
  addSessions('SELECT * FROM sdk_sessions WHERE memory_session_id IN (?)', memIds);
  addSessions('SELECT * FROM sdk_sessions WHERE id IN (?)', dbIds);
  const count = TABLES.reduce((n, t) => n + out[t].length, 0);
  return { batch: out, next, count };
}

// Lot reçu : chargé dans la base d'ici en une transaction. Colonnes limitées à celles qui existent ici.
function importBatch(M, dev, b) {
  const origin = 'csm-' + dev;
  const insert = (table, row, extra = {}) => {
    const r = { ...row, ...extra };
    const keys = Object.keys(r).filter(k => ident(k) && M.cols[table].includes(k) && !(LOCAL.has(k) && !(k in extra)));
    const vals = keys.map(k => { const v = r[k]; return v === null || typeof v === 'number' || typeof v === 'string' ? v : v === undefined ? null : JSON.stringify(v); });
    return M.db.prepare(`INSERT OR IGNORE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...vals).changes;
  };
  let added = 0;
  M.db.exec('BEGIN IMMEDIATE');
  try {
    for (const s of Array.isArray(b.sessions) ? b.sessions : []) {
      if (!s || typeof s !== 'object' || !s.content_session_id) continue;
      // session terminée ailleurs : le worker claude-mem d'ici ne doit pas la reprendre
      insert('sdk_sessions', { ...s, status: s.status === 'failed' ? 'failed' : 'completed' });
    }
    for (const t of TABLES) {
      for (const r of Array.isArray(b[t]) ? b[t] : []) {
        if (!r || typeof r !== 'object' || !Number.isInteger(r.rid)) continue;
        const extra = { origin_device_id: origin, origin_local_id: String(r.rid) };
        if (t === 'user_prompts') {
          const s = M.db.prepare('SELECT id FROM sdk_sessions WHERE content_session_id = ? ORDER BY id LIMIT 1').get(r.content_session_id ?? '');
          extra.session_db_id = s ? s.id : null;
        }
        const { rid, ...row } = r;
        try { added += insert(t, row, extra); } catch { /* ligne invalide ici (contrainte) : ignorée */ }
      }
    }
    M.db.exec('COMMIT');
  } catch (e) { try { M.db.exec('ROLLBACK'); } catch { } throw e; }
  return added;
}

// Réparation automatique (base créée par un claude-mem trop ancien) : met claude-mem à jour avec la commande
// claude, puis relance le worker de l'espace de l'application avec la nouvelle version, qui migre la base.
// log(message) : étapes affichées dans Réglages › Synchronisation.
function run(file, args, opts) {
  return new Promise(res => {
    const win = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
    require('child_process').execFile(win ? 'cmd.exe' : file, win ? ['/d', '/s', '/c', file, ...args] : args,
      { timeout: 300e3, windowsHide: true, ...opts }, (err, out, errOut) => res({ ok: !err, out: String(out || '') + String(errOut || '') }));
  });
}
async function health(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
// Installation de claude-mem (moteur de mémoire choisi dans Réglages) : marketplace puis plugin.
async function install(claude, log = () => { }) {
  if (pluginRoot()) return true;
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|ELECTRON_RUN_AS_NODE$)/.test(k)) delete env[k];
  log('installation de claude-mem…');
  await run(claude, ['plugin', 'marketplace', 'add', 'thedotmack/claude-mem'], { env }); // déjà ajouté : sans effet
  const r = await run(claude, ['plugin', 'install', 'claude-mem@thedotmack'], { env });
  if (!pluginRoot()) throw new Error('installation de claude-mem impossible' + (r.ok ? '' : ' : ' + r.out.trim().slice(-200)));
  return true;
}
async function repair(DATA, claude, log = () => { }) {
  log('mise à jour de claude-mem…');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|ELECTRON_RUN_AS_NODE$)/.test(k)) delete env[k];
  await run(claude, ['plugin', 'marketplace', 'update', 'thedotmack'], { env });
  const up = await run(claude, ['plugin', 'update', 'claude-mem@thedotmack'], { env });
  const root = pluginRoot();
  if (!root) throw new Error('claude-mem introuvable après la mise à jour' + (up.ok ? '' : ' : ' + up.out.trim().slice(-200)));
  // worker de l'espace de l'application : arrêté, puis relancé avec la nouvelle version (migration de la base)
  log('relance de la mémoire avec la nouvelle version…');
  const menv = prepare(DATA), port = Number(menv.CLAUDE_MEM_WORKER_PORT);
  try { const { pid } = JSON.parse(fs.readFileSync(path.join(memDir(DATA), 'worker.pid'), 'utf8')); if (pid) process.kill(Number(pid)); } catch { }
  for (let i = 0; i < 20 && await health(port); i++) await new Promise(r => setTimeout(r, 500));
  const child = require('child_process').spawn(process.platform === 'win32' ? 'node.exe' : 'node',
    [path.join(root, 'scripts', 'bun-runner.js'), path.join(root, 'scripts', 'worker-service.cjs'), 'start'],
    { env: { ...env, ...menv }, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 2000)); if ((await health(port))?.initialized) return; }
  throw new Error('la mémoire ne redémarre pas après la mise à jour de claude-mem');
}

module.exports = { dbPath, memDir, prepare, ensureDb, open, repair, install, pluginRoot, exportBatch, importBatch, PREFIX, MAX_BATCHES, randomDev: () => crypto.randomBytes(6).toString('hex') };
