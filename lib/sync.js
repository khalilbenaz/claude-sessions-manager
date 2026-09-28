'use strict';
// Synchronisation de la liste des sessions entre machines (#27) : nom, dossier, modèle et mode, groupe,
// épinglage, couleur, Remote Control. Les conversations restent sur chaque machine.
//
// Désactivée tant qu'aucun code de synchro n'est collé dans Réglages › Synchronisation. Le code contient
// l'adresse du serveur (Worker Cloudflare, voir sync-worker/) et une clé secrète : seules les machines qui
// partagent le même code se voient, chaque code est un espace isolé côté serveur.
//
// Fusion par session, la modification la plus récente gagne. Une session venue d'une autre machine est
// ajoutée arrêtée : « Reprendre » ouvre une nouvelle conversation dans le dossier correspondant ici.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SYNCED = ['name', 'args', 'group', 'pinned', 'color', 'remote', 'named'];
const INTERVAL = Number(process.env.CSM_SYNC_INTERVAL) || 30000;

// ---------------------------------------------------------------- code de synchro
const CODE_PREFIX = 'csm1.';
function encodeCode(url, key) {
  return CODE_PREFIX + Buffer.from(JSON.stringify({ u: url, k: key })).toString('base64url');
}
function decodeCode(code) {
  const c = String(code || '').trim();
  if (!c.startsWith(CODE_PREFIX)) return null;
  try {
    const { u, k } = JSON.parse(Buffer.from(c.slice(CODE_PREFIX.length), 'base64url').toString('utf8'));
    if (!/^https?:\/\/[^\s]+$/.test(u) || typeof k !== 'string' || k.length < 16) return null;
    return { url: u.replace(/\/+$/, ''), key: k };
  } catch { return null; }
}

// ---------------------------------------------------------------- dossiers portables
// « {home}/Projets/app » est le même dossier sur Mac (/Users/x/Projets/app) et Windows (C:\Users\x\Projets\app).
// Réglage syncRoots : une racine par ligne « alias=chemin » (ex. code=D:\dev sur le PC, code=~/dev sur le Mac).
function parseRoots(text, home, isWin) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w-]{1,30})\s*=\s*(.+?)\s*$/);
    if (!m || m[1] === 'home') continue;
    out.push({ alias: m[1], dir: m[2].replace(/^~(?=$|[\\/])/, home) });
  }
  out.push({ alias: 'home', dir: home });
  return out.map(r => ({ ...r, dir: r.dir.replace(/[\\/]+$/, '') || r.dir, isWin }));
}
const norm = (p, isWin) => {
  const s = p.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  return isWin ? s.toLowerCase() : s;
};
function toPortable(cwd, roots) {
  if (!cwd) return '';
  let best = null;
  for (const r of roots) {
    const base = norm(r.dir, r.isWin), full = norm(cwd, r.isWin);
    if ((full === base || full.startsWith(base + '/')) && (!best || base.length > best.base.length)) best = { r, base };
  }
  if (!best) return cwd.replace(/\\/g, '/');
  const rest = cwd.replace(/[\\/]+/g, '/').replace(/\/$/, '').slice(best.base.length).replace(/^\//, '');
  return `{${best.r.alias}}` + (rest ? '/' + rest : '');
}
// null = dossier inconnu sur cette machine (alias non déclaré, chemin absolu d'un autre système).
function fromPortable(p, roots, isWin) {
  const m = String(p || '').match(/^\{([\w-]+)\}(?:\/(.*))?$/);
  const join = isWin ? path.win32.join : path.posix.join;
  if (m) {
    const r = roots.find(x => x.alias === m[1]);
    if (!r) return null;
    return m[2] ? join(r.dir, ...m[2].split('/')) : r.dir;
  }
  const absHere = isWin ? /^[a-z]:\//i.test(p) || p.startsWith('//') : p.startsWith('/');
  return absHere ? (isWin ? p.replace(/\//g, '\\') : p) : null;
}

module.exports = function (ctx) {
  const { route, json, sessions, publicView, persist, persistHooks, broadcast, DATA, IS_WIN } = ctx;
  const STATE = path.join(DATA, 'sync-state.json');
  const home = os.homedir();

  let state = { cursor: 0, known: {}, outbox: {} };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE, 'utf8')) }; } catch { }
  const saveState = () => { const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, STATE); };
  const status = { enabled: false, lastOk: 0, lastError: '', pulled: 0, pushed: 0, busy: false };

  const settings = () => ctx.getSettings?.() || {};
  const config = () => decodeCode(settings().syncCode);
  const machine = () => String(settings().syncMachine || '').trim() || os.hostname();
  const roots = () => parseRoots(settings().syncRoots, home, IS_WIN);
  const payload = s => {
    const d = { cwd: s.syncCwd || toPortable(s.cwd, roots()) };
    for (const k of SYNCED) if (s[k] !== undefined && s[k] !== null && s[k] !== '') d[k] = s[k];
    return d;
  };
  const fp = d => crypto.createHash('sha1').update(JSON.stringify(d)).digest('hex');
  const bySyncId = uid => [...sessions.values()].find(s => s.syncId === uid);
  const stamp = uid => Math.max(Date.now(), (state.known[uid]?.updatedAt || 0) + 1);

  // ---------------------------------------------------------------- changements locaux
  let applying = false, scanTimer = null;
  function scan() {
    scanTimer = null;
    if (!config()) return;
    let changed = false, assigned = false;
    const present = new Set();
    for (const s of sessions.values()) {
      if (!s.syncId) { s.syncId = crypto.randomBytes(9).toString('hex'); s.origin = machine(); assigned = true; }
      if (!s.syncCwd) { s.syncCwd = toPortable(s.cwd, roots()); assigned = true; }
      present.add(s.syncId);
      const d = payload(s), f = fp(d), k = state.known[s.syncId];
      if (k && !k.deleted && k.fp === f) continue;
      const updatedAt = stamp(s.syncId);
      state.known[s.syncId] = { fp: f, updatedAt };
      state.outbox[s.syncId] = { uid: s.syncId, data: d, updatedAt, deleted: false, origin: s.origin || machine() };
      changed = true;
    }
    for (const [uid, k] of Object.entries(state.known)) {
      if (present.has(uid) || k.deleted) continue;
      const updatedAt = stamp(uid);
      state.known[uid] = { deleted: true, updatedAt };
      state.outbox[uid] = { uid, data: {}, updatedAt, deleted: true, origin: machine() };
      changed = true;
    }
    if (assigned) { applying = true; try { persist(); } finally { applying = false; } }
    if (changed) { saveState(); schedulePush(); }
  }
  persistHooks.push(() => { if (!applying && !scanTimer) scanTimer = setTimeout(scan, 300); });

  // ---------------------------------------------------------------- réseau
  async function call(method, p, body) {
    const cfg = config();
    if (!cfg) throw new Error('synchronisation non configurée');
    const r = await fetch(cfg.url + p, {
      method, headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
    if (r.status === 401) throw new Error('code de synchro refusé par le serveur');
    if (!r.ok) throw new Error(`serveur de synchro : HTTP ${r.status}`);
    return r.json();
  }

  let pushTimer = null;
  function schedulePush() { if (!pushTimer) pushTimer = setTimeout(() => { pushTimer = null; sync().catch(() => { }); }, 1500); }

  async function push() {
    const items = Object.values(state.outbox);
    if (!items.length) return;
    await call('POST', '/sessions', { items });
    for (const it of items) if (state.outbox[it.uid]?.updatedAt === it.updatedAt) delete state.outbox[it.uid];
    status.pushed += items.length;
    saveState();
  }

  // ---------------------------------------------------------------- changements distants
  function insertRemote(it) {
    const d = it.data || {};
    const found = fromPortable(d.cwd, roots(), IS_WIN);
    const cwd = found && fs.existsSync(found) ? found : home;
    const from = it.origin || 'une autre machine';
    const note = cwd === found ? '' : ` Dossier « ${d.cwd} » introuvable ici : ouverte dans le dossier personnel (Réglages › Synchronisation › racines).`;
    const order = Math.max(0, ...[...sessions.values()].map(x => x.order || 0)) + 1;
    const s = {
      id: crypto.randomBytes(6).toString('hex'), name: d.name || path.basename(cwd) || 'session', cwd, args: d.args || '',
      claudeSessionId: null, createdAt: Date.now(), lastActivity: Date.now(), status: 'exited', message: `créée sur ${from}`,
      statusSince: Date.now(), pty: null, order, wantRun: false, named: !!d.named,
      syncId: it.uid, origin: from, syncCwd: d.cwd || '',
      buf: `\x1b[90m[csm] Session synchronisée depuis « ${from} ». « Reprendre » ouvre une nouvelle conversation dans ${cwd}.${note}\x1b[0m\r\n`,
    };
    for (const k of ['group', 'pinned', 'color', 'remote']) if (d[k] !== undefined) s[k] = d[k];
    sessions.set(s.id, s);
    return s;
  }

  function apply(it) {
    const k = state.known[it.uid];
    if (k && k.updatedAt >= it.updatedAt) return false; // déjà vu, ou modification locale plus récente en attente
    const local = bySyncId(it.uid);
    if (it.deleted) {
      if (local && local.pty) { // encore ouverte ici : on la garde et on la renvoie
        state.known[it.uid] = { fp: null, updatedAt: it.updatedAt };
        return false;
      }
      state.known[it.uid] = { deleted: true, updatedAt: it.updatedAt };
      delete state.outbox[it.uid];
      if (local) { sessions.delete(local.id); broadcast({ t: 'removed', id: local.id }); return true; }
      return false;
    }
    let s = local;
    if (!s) s = insertRemote(it);
    else {
      const d = it.data || {};
      for (const f of SYNCED) {
        if (f === 'name' && !d.name) continue;
        s[f] = d[f] ?? (f === 'args' ? '' : f === 'named' ? false : undefined);
      }
      if (d.cwd) s.syncCwd = d.cwd;
    }
    state.known[it.uid] = { fp: fp(payload(s)), updatedAt: it.updatedAt };
    delete state.outbox[it.uid];
    broadcast({ t: 'session', s: publicView(s) });
    return true;
  }

  async function pull() {
    let changed = false;
    for (let page = 0; page < 20; page++) {
      const r = await call('GET', `/sessions?since=${state.cursor}`);
      for (const it of r.items || []) { if (apply(it)) changed = true; state.cursor = Math.max(state.cursor, it.rev || 0); }
      status.pulled += (r.items || []).length;
      if (!r.items?.length || state.cursor >= r.rev) break;
    }
    if (changed) { applying = true; try { persist(); } finally { applying = false; } }
    saveState();
  }

  let running = null;
  function sync() {
    if (running) return running;
    running = (async () => {
      status.enabled = !!config();
      if (!status.enabled) return;
      status.busy = true;
      try {
        if (scanTimer) { clearTimeout(scanTimer); scan(); }
        await pull();
        await push();
        status.lastOk = Date.now(); status.lastError = '';
      } catch (e) {
        status.lastError = e.message;
        throw e;
      } finally { status.busy = false; broadcast({ t: 'sync', status: view() }); }
    })().finally(() => { running = null; });
    return running;
  }

  // Code changé : autre espace, on repart de zéro (les sessions locales seront envoyées au nouvel espace).
  let lastCode = settings().syncCode || '';
  function checkCode() {
    const code = settings().syncCode || '';
    if (code === lastCode) return;
    lastCode = code;
    state = { cursor: 0, known: {}, outbox: {} };
    for (const s of sessions.values()) { delete s.syncId; delete s.syncCwd; }
    saveState();
    scan();
  }

  const view = () => ({
    enabled: !!config(), invalid: !!settings().syncCode && !config(), server: config()?.url || '', machine: machine(), lastOk: status.lastOk, lastError: status.lastError,
    pending: Object.keys(state.outbox).length, busy: status.busy,
  });

  route('GET', /^\/api\/sync$/, async ({ res }) => json(res, 200, view()));
  route('POST', /^\/api\/sync\/now$/, async ({ res }) => {
    checkCode();
    try { await sync(); } catch { }
    json(res, 200, view());
  });
  // Nouveau code pour un serveur donné : la clé doit ensuite être ajoutée au secret SYNC_KEYS du Worker.
  route('POST', /^\/api\/sync\/code$/, async ({ req, res }) => {
    const { url } = await ctx.readBody(req);
    if (!/^https?:\/\/\S+$/.test(url || '')) return json(res, 400, { error: 'adresse du serveur invalide' });
    const key = crypto.randomBytes(24).toString('hex');
    json(res, 200, { code: encodeCode(String(url).replace(/\/+$/, ''), key), key });
  });

  const tick = () => { checkCode(); sync().catch(() => { }); };
  setTimeout(tick, Number(process.env.CSM_SYNC_DELAY) || 2000);
  setInterval(tick, INTERVAL).unref?.();
};

module.exports.decodeCode = decodeCode;
module.exports.encodeCode = encodeCode;
module.exports.parseRoots = parseRoots;
module.exports.toPortable = toPortable;
module.exports.fromPortable = fromPortable;
