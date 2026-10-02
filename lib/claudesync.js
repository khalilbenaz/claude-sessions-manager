'use strict';
// Configuration de Claude partagée entre les machines synchronisées : règles (CLAUDE.md et les .md qu'il importe),
// skills, agents, commandes et notes de Claude Code (~/.claude/projects/<dossier>/memory).
// Un fichier = une entrée chiffrée « cf-<empreinte du chemin> », la plus récente gagne.
//
// Sûreté (le code de synchro donne la main sur ce que Claude lit et exécute) :
// - règles, skills, agents et commandes reçus attendent une validation dans Réglages (claudeSyncReview, par
//   défaut) ; seules les notes de Claude Code s'appliquent seules ;
// - jamais d'écriture à travers un lien symbolique, ni hors de ~/.claude (chemin réel vérifié), ni dans un
//   dossier caché ; le bit exécutable n'est pas synchronisé ;
// - tout fichier remplacé ou supprimé est d'abord copié dans DATA/claude-sync-backup/<date>/ (rien n'est
//   remplacé si la copie échoue), copies effacées après 30 jours ; chaque changement reçu est noté dans
//   DATA/claude-sync-log.jsonl (Réglages : liste, restaurer) ;
// - une suppression n'est envoyée que si le fichier n'existe vraiment plus, et pas en masse.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PREFIX = 'cf-';
const MAX_FILE = 2 * 1024 * 1024, MAX_FILES = 3000, MAX_DEPTH = 8;
const KEEP_DAYS = 30, LOG_MAX = 1000;
const SKIP = /^(\.|node_modules$|__pycache__$)|\.csm-tmp$/;
// catégorie → réglage, et racines (chemins portables relatifs à ~/.claude) ; review : validation avant application
const KINDS = {
  rules: { setting: 'syncClaudeRules', review: true, test: p => /^[^/]+\.md$/.test(p) || p.startsWith('rules/') },
  skills: { setting: 'syncClaudeSkills', review: true, test: p => p.startsWith('skills/') },
  agents: { setting: 'syncClaudeAgents', review: true, test: p => p.startsWith('agents/') || p.startsWith('commands/') },
  memory: { setting: 'syncClaudeMemory', review: false, test: p => /^projects\/~[^/]*\/memory\//.test(p) },
};
const kindOf = p => Object.keys(KINDS).find(k => KINDS[k].test(p));
const claudeDir = () => path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const encode = p => p.replace(/[^a-zA-Z0-9]/g, '-'); // nom des dossiers de projets de Claude Code
const realOr = p => { try { return fs.realpathSync(p); } catch { return null; } };

// Chemin portable reçu → chemin local (refusé s'il sort de ~/.claude, passe par un dossier caché ou ne
// correspond à aucune catégorie).
function toLocal(p, dir = claudeDir(), home = os.homedir()) {
  if (typeof p !== 'string' || p.length > 400 || !kindOf(p)) return null;
  dir = path.resolve(dir);
  const seg = p.split('/');
  if (seg.some(s => !s || s.startsWith('.') || /[\\:\0]/.test(s) || s.endsWith('.csm-tmp'))) return null;
  if (seg[0] === 'projects') seg[1] = encode(home) + seg[1].slice(1);
  const abs = path.join(dir, ...seg);
  return abs.startsWith(dir + path.sep) ? abs : null;
}

// Écriture possible sans suivre de lien : aucun élément existant entre ~/.claude et le fichier n'est un lien,
// et le chemin réel du dernier dossier existant reste dans le chemin réel de ~/.claude.
function writable(abs, dir = claudeDir()) {
  const root = realOr(dir);
  if (!root) return false;
  const rel = path.relative(dir, abs).split(path.sep);
  let cur = dir;
  for (let i = 0; i < rel.length; i++) {
    cur = path.join(cur, rel[i]);
    let st;
    try { st = fs.lstatSync(cur); } catch { break; } // n'existe pas encore : la suite sera créée ici
    if (st.isSymbolicLink()) return false;
    if (i < rel.length - 1 && !st.isDirectory()) return false;
  }
  let parent = path.dirname(abs);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const real = realOr(parent);
  return !!real && (real === root || real.startsWith(root + path.sep));
}

// Fichiers locaux des catégories actives : { files: Map chemin portable → { abs, data, mtime, linked } ,
// skipped: Set (trop gros, illisibles, au-delà du plafond : jamais pris pour des suppressions), roots: Set
// (racines de catégorie lisibles) }.
function scan(on, dir = claudeDir(), home = os.homedir()) {
  dir = path.resolve(dir);
  const files = new Map(), skipped = new Set(), roots = new Set(), seen = new Set();
  const root = realOr(dir) || dir;
  const add = (p, abs, st, linked) => {
    if (!on(kindOf(p))) return;
    if (files.size >= MAX_FILES || st.size > MAX_FILE) { skipped.add(p); return; }
    try { files.set(p, { abs, data: fs.readFileSync(abs), x: !!(st.mode & 0o100), mtime: Math.round(st.mtimeMs), linked }); } catch { skipped.add(p); }
  };
  const walk = (abs, p, depth, linked, top) => {
    const real = realOr(abs);
    if (!real) return;
    if (seen.has(real) || depth > MAX_DEPTH) { skipped.add(p + '*'); return; }
    seen.add(real);
    let names; try { names = fs.readdirSync(abs); } catch { skipped.add(p + '*'); return; }
    if (top) roots.add(top);
    for (const n of names.sort()) {
      if (SKIP.test(n)) continue;
      const a = path.join(abs, n);
      let st, ln = linked;
      try { ln = linked || fs.lstatSync(a).isSymbolicLink(); st = fs.statSync(a); } catch { skipped.add(p + n); continue; }
      // un lien est suivi (skill pointant vers un projet) seulement s'il reste dans le dossier personnel
      if (ln && !linked) { const r = realOr(a); if (!r || !(r.startsWith(home + path.sep) || r.startsWith(root + path.sep))) continue; }
      if (st.isDirectory()) walk(a, p + n + '/', depth + 1, ln);
      else if (st.isFile()) add(p + n, a, st, ln);
    }
  };
  let top = []; try { top = fs.readdirSync(dir); roots.add('rules'); } catch { }
  for (const n of top) {
    const a = path.join(dir, n);
    if (SKIP.test(n) || !/\.md$/.test(n)) continue;
    let st, ln; try { ln = fs.lstatSync(a).isSymbolicLink(); st = fs.statSync(a); } catch { skipped.add(n); continue; }
    if (st.isFile()) add(n, a, st, ln);
  }
  for (const d of ['rules', 'skills', 'agents', 'commands']) if (on(kindOf(d + '/x'))) walk(path.join(dir, d), d + '/', 0, false, d);
  if (on('memory')) {
    const h = encode(home);
    let projects = []; try { projects = fs.readdirSync(path.join(dir, 'projects')); roots.add('projects'); } catch { }
    // dossiers de ce compte uniquement : « <home encodé> » ou « <home encodé>-… »
    for (const n of projects) if (n === h || n.startsWith(h + '-')) walk(path.join(dir, 'projects', n, 'memory'), `projects/~${n.slice(h.length)}/memory/`, 0, false);
  }
  return { files, skipped, roots };
}
// racine dont dépend un chemin (une suppression n'est envoyée que si cette racine a pu être lue)
const rootOf = p => (/^[^/]+\.md$/.test(p) ? 'rules' : p.split('/')[0]);
const isSkipped = (skipped, p) => skipped.has(p) || [...skipped].some(s => s.endsWith('*') && p.startsWith(s.slice(0, -1)));

// Contenu chiffré d'une entrée : { p, d (base64), x } ou { p, del: 1 } pour une suppression (même format que les
// applis ≤ 3.17). x est envoyé tel quel mais jamais appliqué à la réception, et une différence de x seule ne
// compte pas comme un changement (versions comparées avec x = 0 et x = 1) : pas de va-et-vient Mac ↔ Windows.
const rawOf = (p, f, x = f?.x) => Buffer.from(JSON.stringify(f ? { p, d: f.data.toString('base64'), x: x ? 1 : 0 } : { p, del: 1 }));

module.exports = function ({ DATA, settings, call, seal, unseal, txVersion, remote, machine, getState, saveState, status }) {
  const on = k => !!k && settings()[KINDS[k].setting] !== false;
  const anyOn = () => Object.keys(KINDS).some(on);
  const needsReview = p => settings().claudeSyncReview !== false && KINDS[kindOf(p)]?.review;
  const aad = (uid, ver, updatedAt) => `c|${uid}|${ver}|${updatedAt}`;
  const BACKUP = path.join(DATA, 'claude-sync-backup'), LOG = path.join(DATA, 'claude-sync-log.jsonl');
  const PENDING = path.join(DATA, 'claude-sync-pending.json');

  // ---------------------------------------------------------------- journal, copies, fichiers à valider
  function log(entry) {
    const e = { id: crypto.randomBytes(6).toString('hex'), at: Date.now(), ...entry };
    try {
      fs.appendFileSync(LOG, JSON.stringify(e) + '\n', { mode: 0o600 });
      const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
      if (lines.length > LOG_MAX * 1.2) fs.writeFileSync(LOG, lines.slice(-LOG_MAX).join('\n') + '\n', { mode: 0o600 });
    } catch { }
    return e;
  }
  const readLog = () => { try { return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-');
  // copie avant remplacement ; renvoie le chemin relatif de la copie, ou null si elle a échoué
  function backup(p, abs, stamp) {
    try {
      let rel = path.join(stamp, ...p.split('/')), to = path.join(BACKUP, rel);
      for (let i = 2; fs.existsSync(to); i++) { rel = path.join(`${stamp}-${i}`, ...p.split('/')); to = path.join(BACKUP, rel); }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(abs, to);
      return rel;
    } catch { return null; }
  }
  let purgedAt = 0;
  function purge(force) {
    if (!force && Date.now() - purgedAt < 3600e3) return;
    purgedAt = Date.now();
    let names = []; try { names = fs.readdirSync(BACKUP); } catch { return; }
    for (const n of names) {
      try { if (Date.now() - fs.statSync(path.join(BACKUP, n)).mtimeMs > KEEP_DAYS * 86400e3) fs.rmSync(path.join(BACKUP, n), { recursive: true, force: true }); } catch { }
    }
  }
  const loadPending = () => { try { return JSON.parse(fs.readFileSync(PENDING, 'utf8')); } catch { return {}; } };
  const savePending = v => { try { fs.writeFileSync(PENDING, JSON.stringify(v), { mode: 0o600 }); } catch { } };

  // Applique une entrée reçue (contenu ou suppression) ; renvoie l'entrée du journal ou null si refusée.
  function applyEntry(e, from, stamp) {
    const abs = toLocal(e.p);
    if (!abs || !writable(abs)) return log({ p: e.p, action: 'refused', from });
    const exists = fs.existsSync(abs);
    let saved = null;
    if (exists) { saved = backup(e.p, abs, stamp); if (!saved) return null; } // sans copie, on ne touche à rien
    if (e.del) {
      if (exists) fs.rmSync(abs, { force: true });
      return log({ p: e.p, action: 'deleted', from, backup: saved });
    }
    const data = Buffer.from(String(e.d || ''), 'base64');
    if (data.length > MAX_FILE) return log({ p: e.p, action: 'refused', from });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!writable(abs)) return log({ p: e.p, action: 'refused', from });
    const tmp = abs + '.csm-tmp';
    let mode = 0o644; try { mode = fs.statSync(abs).mode & 0o777; } catch { } // garde le mode du fichier existant
    fs.writeFileSync(tmp, data, { mode });
    fs.renameSync(tmp, abs);
    return log({ p: e.p, action: exists ? 'replaced' : 'created', from, backup: saved });
  }

  let cycle = false; // une décision (Appliquer / Refuser) n'est pas prise pendant un cycle : listes relues après
  async function syncClaude(cfg) {
    purge();
    if (!cfg || !anyOn()) return;
    cycle = true;
    try { await runCycle(cfg); } finally { cycle = false; }
  }
  async function runCycle(cfg) {
    const state = getState(), st = state.cf || (state.cf = { files: {}, got: {}, paths: {}, at: {} });
    st.at ||= {};
    const uidOf = p => PREFIX + txVersion(cfg.key, Buffer.from('cf-path|' + p));
    const { files: local, skipped, roots } = scan(on);
    const verOf = p => txVersion(cfg.key, rawOf(p, local.get(p)));
    // même contenu, quel que soit le bit exécutable
    const sameAs = (p, ver) => { const f = local.get(p); return !!ver && (txVersion(cfg.key, rawOf(p, f, 0)) === ver || (!!f && txVersion(cfg.key, rawOf(p, f, 1)) === ver)); };
    const R = await remote();
    const stamp = stampNow();
    const pending = loadPending();
    let pendingChanged = false;

    // 1. ce qui a changé ailleurs
    for (const [uid, r] of R) {
      if (!uid.startsWith(PREFIX) || st.got[uid] === r.ver) continue;
      if (st.paths[uid] && !on(kindOf(st.paths[uid]))) continue;
      if (!/^[0-9a-f]{32}$/.test(String(r.ver)) || !(Number.isInteger(r.chunks) && r.chunks >= 1 && r.chunks <= 4)) continue;
      const parts = [];
      for (let n = 0; n < r.chunks; n++) parts.push(await call('GET', `/transcripts/${uid}/${r.ver}/${n}`, undefined, true));
      let e;
      try {
        const raw = zlib.gunzipSync(unseal(cfg.key, Buffer.concat(parts), aad(uid, r.ver, r.updatedAt)), { maxOutputLength: 3 * MAX_FILE });
        if (txVersion(cfg.key, raw) !== r.ver) continue;
        e = JSON.parse(raw.toString('utf8'));
      } catch { continue; }
      const p = e && e.p, abs = toLocal(p);
      if (!abs || uidOf(p) !== uid) { st.got[uid] = r.ver; continue; }
      st.paths[uid] = p;
      if (!on(kindOf(p))) continue;
      const f = local.get(p), mine = verOf(p);
      st.got[uid] = r.ver;
      if (mine === r.ver || sameAs(p, r.ver)) { st.files[p] = r.ver; st.at[p] = r.updatedAt; if (pending[uid]) { delete pending[uid]; pendingChanged = true; } continue; }
      // modifié ici depuis la dernière synchro, et plus récemment : c'est notre version qui partira
      const unchanged = st.files[p] === mine || sameAs(p, st.files[p]);
      if (!unchanged && (f ? f.mtime : 0) > r.updatedAt) continue;
      if (unchanged && r.updatedAt < (st.at[p] || 0)) continue; // version plus ancienne que la nôtre
      if (f?.linked) { log({ p, action: 'linked', from: r.origin || '' }); continue; } // fichier atteint par un lien : jamais réécrit
      if (needsReview(p)) {
        pending[uid] = { p, d: e.d, del: e.del ? 1 : 0, ver: r.ver, updatedAt: r.updatedAt, from: String(r.origin || '').slice(0, 80), at: Date.now() };
        pendingChanged = true;
        log({ p, action: 'pending', from: r.origin || '' });
        continue;
      }
      let done;
      try { done = applyEntry(e, r.origin || '', stamp); } catch { continue; }
      if (!done || done.action === 'refused') continue;
      st.files[p] = r.ver; st.at[p] = r.updatedAt;
      if (e.del) local.delete(p); else local.set(p, { abs, data: Buffer.from(String(e.d || ''), 'base64'), mtime: Date.now() });
      status.cfDown++;
      saveState();
    }
    if (pendingChanged) savePending(pending);

    // 2. ce qui a changé ici (nouveaux fichiers, modifications, suppressions de fichiers déjà synchronisés)
    const gone = Object.keys(st.files).filter(p => on(kindOf(p)) && !local.has(p));
    // suppression seulement si le fichier n'existe vraiment plus, que sa racine a été lue, et pas en masse
    const deletable = gone.filter(p => roots.has(rootOf(p)) && !isSkipped(skipped, p) && !(() => { const a = toLocal(p); return !a || fs.existsSync(a); })());
    const tracked = Object.keys(st.files).length;
    const massive = deletable.length > Math.max(5, tracked * 0.2);
    status.cfWarning = massive ? deletable.length : 0; // Réglages : « N fichiers ont disparu d'un coup »
    const todo = new Set([...local.keys(), ...(massive ? [] : deletable)]);
    for (const p of todo) {
      const f = local.get(p), raw = rawOf(p, f), ver = txVersion(cfg.key, raw);
      if (st.files[p] === ver || (f && sameAs(p, st.files[p])) || (!f && st.files[p] === undefined)) continue;
      const uid = uidOf(p), r = R.get(uid);
      const updatedAt = Math.max(f ? f.mtime : Date.now(), r ? r.updatedAt + 1 : 0);
      const blob = seal(cfg.key, zlib.gzipSync(raw), aad(uid, ver, updatedAt));
      const chunks = Math.ceil(blob.length / (1024 * 1024)) || 1;
      if (chunks > 4) continue;
      for (let n = 0; n < chunks; n++) await call('PUT', `/transcripts/${uid}/${ver}/${n}`, blob.subarray(n * 1024 * 1024, (n + 1) * 1024 * 1024));
      const res = await call('PUT', `/transcripts/${uid}`, { cid: 'claude', ver, chunks, size: blob.length, updatedAt, origin: machine() });
      if (res && res.applied === false) { delete st.got[uid]; continue; } // une autre machine a été plus rapide : relue au prochain cycle
      st.files[p] = ver; st.at[p] = updatedAt; st.got[uid] = ver; st.paths[uid] = p;
      if (pending[uid]) { delete pending[uid]; savePending(pending); } // notre version, plus récente, remplace celle en attente
      status.cfUp++;
      saveState();
    }
    status.cfFiles = local.size;
    status.cfPending = Object.keys(pending).length;
  }

  // ---------------------------------------------------------------- Réglages : à valider, journal, restaurer
  syncClaude.pending = () => Object.entries(loadPending()).map(([uid, x]) => ({ uid, p: x.p, del: !!x.del, from: x.from, at: x.at, size: x.d ? Math.floor(String(x.d).length * 3 / 4) : 0 }));
  // apply : true = appliquer, false = refuser (la version locale reste) ; uids absents → tous
  syncClaude.decide = (uids, apply) => {
    if (cycle) throw new Error('synchronisation en cours, réessaie dans un instant');
    const pending = loadPending(), state = getState(), st = state.cf || (state.cf = { files: {}, got: {}, paths: {}, at: {} });
    const stamp = stampNow(), out = [];
    for (const uid of uids?.length ? uids : Object.keys(pending)) {
      const x = pending[uid];
      if (!x) continue;
      delete pending[uid];
      if (!apply) { log({ p: x.p, action: 'rejected', from: x.from }); out.push(x.p); continue; }
      let done = null;
      try { done = applyEntry(x, x.from, stamp); } catch { }
      if (!done) { pending[uid] = x; continue; } // copie impossible : on réessaiera
      if (done.action === 'refused') { out.push(x.p); continue; } // chemin interdit : abandonné (noté au journal)
      st.files[x.p] = x.ver; st.at[x.p] = x.updatedAt;
      status.cfDown++;
      out.push(x.p);
    }
    savePending(pending);
    saveState();
    status.cfPending = Object.keys(pending).length;
    return out;
  };
  syncClaude.purge = purge;
  syncClaude.log = (limit = 200) => readLog().slice(-limit).reverse();
  // Remet la copie d'une entrée du journal ; la version actuelle est copiée avant. La version remise, la plus
  // récente, repartira vers les autres machines.
  syncClaude.restore = id => {
    const e = readLog().find(x => x.id === id);
    if (!e || !e.backup) throw new Error('aucune copie pour cette entrée');
    const src = path.resolve(BACKUP, e.backup);
    if (!src.startsWith(path.resolve(BACKUP) + path.sep) || !fs.existsSync(src)) throw new Error('copie introuvable');
    const abs = toLocal(e.p);
    if (!abs || !writable(abs)) throw new Error('chemin refusé');
    let saved = null;
    if (fs.existsSync(abs)) { saved = backup(e.p, abs, stampNow()); if (!saved) throw new Error('copie de la version actuelle impossible'); }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(src, abs + '.csm-tmp');
    fs.renameSync(abs + '.csm-tmp', abs);
    const now = new Date(); fs.utimesSync(abs, now, now);
    return log({ p: e.p, action: 'restored', backup: saved });
  };
  return syncClaude;
};

module.exports.scan = scan;
module.exports.toLocal = toLocal;
module.exports.writable = writable;
module.exports.KINDS = KINDS;
