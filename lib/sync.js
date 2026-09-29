'use strict';
// Synchronisation des sessions entre machines (#27) : nom, dossier, modèle et mode, groupe, épinglage, couleur,
// Remote Control, et leurs conversations (chiffrées de bout en bout, réglage syncTranscripts) ; aussi la liste
// des groupes (vides compris, dans l'ordre) et les modèles de session, chiffrés eux aussi.
//
// Désactivée tant qu'aucun code de synchro n'est saisi dans Réglages › Synchronisation. Le code est créé par
// le serveur (Worker Cloudflare, voir sync-worker/, adresse dans le réglage syncServer) : seules les machines
// qui partagent le même code se voient, chaque code est un espace isolé côté serveur.
//
// Fusion par session, la modification la plus récente gagne. Une session venue d'une autre machine est
// ajoutée arrêtée : « Reprendre » continue sa conversation dans le dossier correspondant ici.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const SYNCED = ['name', 'args', 'group', 'pinned', 'color', 'remote', 'named'];
const INTERVAL = Number(process.env.CSM_SYNC_INTERVAL) || 30000;
const CHUNK = 1024 * 1024, MAX_CHUNKS = 40; // conversation chiffrée : morceaux de 1 Mo, 40 Mo au plus

// ---------------------------------------------------------------- code de synchro
// Code court « XXXX-XXXX-XXXX-XXXX-XXXX » (base32 de Crockford, 100 bits) créé par le serveur de syncServer.
// L'ancien format « csm1.… » (adresse + clé encodées) reste accepté.
const DEFAULT_SERVER = 'https://csm-sync.khalilbenaz.workers.dev';
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{20}$/;
function shortKey(code) {
  const k = String(code || '').toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return CROCKFORD.test(k) ? k : null;
}
const formatCode = k => k.match(/.{4}/g).join('-');
const CODE_PREFIX = 'csm1.';
function encodeCode(url, key) {
  return CODE_PREFIX + Buffer.from(JSON.stringify({ u: url, k: key })).toString('base64url');
}
function decodeCode(code, server = DEFAULT_SERVER) {
  const c = String(code || '').trim();
  const short = shortKey(c);
  if (short) return /^https?:\/\/\S+$/.test(server) ? { url: server.replace(/\/+$/, ''), key: short, code: formatCode(short) } : null;
  if (!c.startsWith(CODE_PREFIX)) return null;
  try {
    const { u, k } = JSON.parse(Buffer.from(c.slice(CODE_PREFIX.length), 'base64url').toString('utf8'));
    if (!/^https?:\/\/[^\s]+$/.test(u) || typeof k !== 'string' || k.length < 16) return null;
    return { url: u.replace(/\/+$/, ''), key: k, code: c };
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

// ---------------------------------------------------------------- chiffrement des conversations
// Clés dérivées du code de synchro (jamais envoyé : le serveur n'en garde que l'empreinte SHA-256).
function txKeys(key) {
  const k = Buffer.from(crypto.hkdfSync('sha256', key, 'csm-transcripts', 'aes-256-gcm-v1', 64));
  return { enc: k.subarray(0, 32), mac: k.subarray(32) };
}
const txVersion = (key, raw) => crypto.createHmac('sha256', txKeys(key).mac).update(raw).digest('hex').slice(0, 32);
function seal(key, raw) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', txKeys(key).enc, iv);
  const ct = Buffer.concat([c.update(zlib.gzipSync(raw)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function unseal(key, blob) {
  const d = crypto.createDecipheriv('aes-256-gcm', txKeys(key).enc, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return zlib.gunzipSync(Buffer.concat([d.update(blob.subarray(28)), d.final()]));
}

module.exports = function (ctx) {
  const { route, json, sessions, publicView, persist, persistHooks, broadcast, DATA, IS_WIN } = ctx;
  const STATE = path.join(DATA, 'sync-state.json');
  const home = os.homedir();

  let state = { cursor: 0, known: {}, outbox: {}, tx: {}, docsPulled: false };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE, 'utf8')) }; } catch { }
  state.tx = state.tx || {};
  const saveState = () => { const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, STATE); };
  const status = { enabled: false, lastOk: 0, lastError: '', pulled: 0, pushed: 0, busy: false, txUp: 0, txDown: 0 };

  const settings = () => ctx.getSettings?.() || {};
  const server = () => String(settings().syncServer || '').trim() || DEFAULT_SERVER;
  const config = () => decodeCode(settings().syncCode, server());
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
    // groupes et modèles : seulement après un premier pull dans cet espace (sinon une machine sans groupes
    // effacerait ceux des autres) ; une liste de groupes vide n'est envoyée que si elle a déjà été partagée.
    if (state.docsPulled) {
      const cfg = config();
      for (const [uid, d] of localDocs()) {
        if (uid === GROUPS_UID && !d.list.length && !state.known[uid]) continue;
        present.add(uid);
        const f = fp(d), k = state.known[uid];
        if (k && !k.deleted && k.fp === f) continue;
        const updatedAt = stamp(uid);
        state.known[uid] = { fp: f, updatedAt };
        state.outbox[uid] = { uid, data: { e: seal(cfg.key, Buffer.from(JSON.stringify(d))).toString('base64') }, updatedAt, deleted: false, origin: machine() };
        changed = true;
      }
    }
    for (const [uid, k] of Object.entries(state.known)) {
      if (present.has(uid) || k.deleted || (isDoc(uid) && (!state.docsPulled || !docOn(uid)))) continue;
      const updatedAt = stamp(uid);
      state.known[uid] = { deleted: true, updatedAt };
      state.outbox[uid] = { uid, data: {}, updatedAt, deleted: true, origin: machine() };
      delete state.tx[uid];
      changed = true;
    }
    if (assigned) { applying = true; try { persist(); } finally { applying = false; } }
    if (changed) { saveState(); schedulePush(); }
  }
  persistHooks.push(() => { if (!applying && !scanTimer) scanTimer = setTimeout(scan, 300); });

  // ---------------------------------------------------------------- groupes et modèles
  // Lignes spéciales de la même table que les sessions (uid préfixé), contenu chiffré avec la clé du code.
  const GROUPS_UID = 'csmcfg-groups', TPL = 'csmtpl-';
  const isDoc = uid => uid === GROUPS_UID || uid.startsWith(TPL);
  // Réglages › Synchronisation : ce qui est synchronisé en plus de la liste des sessions.
  const docOn = uid => (uid === GROUPS_UID ? settings().syncGroups !== false : settings().syncTemplates !== false);
  const groupList = () => String(settings().groupList || '').split('\n').map(x => x.trim()).filter(Boolean);
  function localDocs() {
    const out = new Map();
    if (docOn(GROUPS_UID)) out.set(GROUPS_UID, { list: groupList() });
    if (docOn(TPL)) for (const t of ctx.getTemplates?.() || []) out.set(TPL + t.id, { ...t, cwd: t.cwd ? toPortable(t.cwd, roots()) : '' });
    return out;
  }
  function applyDoc(it) {
    if (!docOn(it.uid)) return false; // ignoré ici ; relu depuis le début si l'option est réactivée
    const k = state.known[it.uid];
    if (k && k.updatedAt >= it.updatedAt) return false;
    let d = null;
    if (!it.deleted) {
      try { d = JSON.parse(unseal(config().key, Buffer.from(it.data?.e || '', 'base64')).toString('utf8')); } catch { return false; }
    }
    let f = null;
    if (it.uid === GROUPS_UID) {
      const remote = Array.isArray(d?.list) ? d.list.map(String).filter(Boolean) : [];
      // première rencontre : on réunit les deux listes (la réunion repart ensuite vers les autres machines)
      const next = k ? remote : [...new Set([...remote, ...groupList()])];
      ctx.patchSettings?.({ groupList: next.join('\n').slice(0, 4000) });
      f = fp({ list: remote });
    } else {
      const id = it.uid.slice(TPL.length);
      const list = [...(ctx.getTemplates?.() || [])];
      const i = list.findIndex(t => t.id === id);
      if (d) {
        const found = d.cwd ? fromPortable(d.cwd, roots(), IS_WIN) : '';
        const t = { ...d, id, cwd: found || d.cwd || '' };
        if (i >= 0) list[i] = t; else list.push(t);
      } else if (i >= 0) list.splice(i, 1);
      ctx.setTemplates?.(list);
      f = d ? fp(localDocs().get(it.uid) || {}) : null;
    }
    state.known[it.uid] = d ? { fp: f, updatedAt: it.updatedAt } : { deleted: true, updatedAt: it.updatedAt };
    delete state.outbox[it.uid];
    return true;
  }

  // ---------------------------------------------------------------- réseau
  // body Buffer = octets (morceau de conversation) ; raw = réponse en octets.
  async function call(method, p, body, raw) {
    const cfg = config();
    if (!cfg) throw new Error('synchronisation non configurée');
    const bin = Buffer.isBuffer(body);
    const r = await fetch(cfg.url + p, {
      method, headers: { authorization: `Bearer ${cfg.key}`, 'content-type': bin ? 'application/octet-stream' : 'application/json' },
      body: bin ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(bin || raw ? 60000 : 15000),
    });
    if (r.status === 401) throw new Error('code de synchro refusé par le serveur');
    if (r.status === 404 && p === '/transcripts') throw new Error('le serveur de synchro ne gère pas encore les conversations (à mettre à jour)');
    if (r.status === 413) throw new Error('espace de synchro plein');
    if (!r.ok) throw new Error(`serveur de synchro : HTTP ${r.status}`);
    return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
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
      buf: `\x1b[90m[csm] Session synchronisée depuis « ${from} ». « Reprendre » ${txOn() ? 'continue sa conversation' : 'ouvre une nouvelle conversation'} dans ${cwd}.${note}\x1b[0m\r\n`,
    };
    for (const k of ['group', 'pinned', 'color', 'remote']) if (d[k] !== undefined) s[k] = d[k];
    sessions.set(s.id, s);
    return s;
  }

  function apply(it) {
    if (isDoc(it.uid)) return applyDoc(it);
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
    state.docsPulled = true;
    saveState();
  }

  // ---------------------------------------------------------------- conversations (#27, chiffrées)
  // Le transcript (~/.claude/projects/…/<id>.jsonl) est compressé puis chiffré (AES-256-GCM, clé dérivée du
  // code de synchro) avant l'envoi : le serveur ne voit que des octets opaques. Découpé en morceaux de 1 Mo.
  // Version = HMAC du contenu : même conversation sur deux machines = même version, rien à transférer.
  // La plus récente gagne ; une session ouverte ici n'est jamais écrasée.
  const txOn = () => settings().syncTranscripts !== false;
  // Dossier où Claude Code cherche les conversations d'un dossier de travail.
  // (Claude Code part du chemin réel : /var → /private/var sur macOS.)
  const projectFile = (cwd, cid) => {
    let real = cwd; try { real = fs.realpathSync(cwd); } catch { }
    return path.join(home, '.claude', 'projects', real.replace(/[^a-zA-Z0-9]/g, '-'), `${cid}.jsonl`);
  };

  async function upload(cfg, s, file, st, R) {
    const raw = fs.readFileSync(file), ver = txVersion(cfg.key, raw);
    const rec = { cid: s.claudeSessionId, ver, size: st.size, mtime: st.mtimeMs, at: Date.now() };
    if (R && R.ver === ver) { state.tx[s.syncId] = rec; return; } // identique des deux côtés
    const blob = seal(cfg.key, raw);
    if (blob.length > MAX_CHUNKS * CHUNK) { state.tx[s.syncId] = { ...rec, ver: null, tooBig: true }; return; }
    const chunks = Math.ceil(blob.length / CHUNK) || 1;
    for (let n = 0; n < chunks; n++) await call('PUT', `/transcripts/${s.syncId}/${ver}/${n}`, blob.subarray(n * CHUNK, (n + 1) * CHUNK));
    await call('PUT', `/transcripts/${s.syncId}`, { cid: s.claudeSessionId, ver, chunks, size: blob.length, updatedAt: Math.round(st.mtimeMs), origin: machine() });
    state.tx[s.syncId] = rec;
    status.txUp++;
  }

  async function download(cfg, s, R) {
    const parts = [];
    for (let n = 0; n < R.chunks; n++) parts.push(await call('GET', `/transcripts/${s.syncId}/${R.ver}/${n}`, undefined, true));
    const raw = unseal(cfg.key, Buffer.concat(parts));
    if (txVersion(cfg.key, raw) !== R.ver) throw new Error('conversation reçue incomplète');
    const targets = new Set([projectFile(s.cwd, R.cid)]);
    const existing = ctx.transcriptPath(R.cid);
    if (existing) targets.add(existing);
    let st;
    for (const f of targets) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + '.csm-tmp', raw); fs.renameSync(f + '.csm-tmp', f);
      st = fs.statSync(f);
    }
    state.tx[s.syncId] = { cid: R.cid, ver: R.ver, size: st.size, mtime: st.mtimeMs, at: Date.now() };
    if (s.claudeSessionId !== R.cid) {
      s.claudeSessionId = R.cid;
      applying = true; try { persist(); } finally { applying = false; }
      broadcast({ t: 'session', s: publicView(s) });
    }
    status.txDown++;
  }

  // Une session : envoie si modifiée ici, télécharge si modifiée ailleurs (et arrêtée ici).
  async function reconcile(cfg, s, R, force) {
    const T = state.tx[s.syncId];
    const file = s.claudeSessionId && ctx.transcriptPath(s.claudeSessionId);
    let st = null; try { st = file && fs.statSync(file); } catch { }
    const localChanged = !!st && !(T && T.cid === s.claudeSessionId && T.size === st.size && T.mtime === st.mtimeMs);
    const remoteChanged = !!R && !(T && T.ver === R.ver);
    if (localChanged && (!remoteChanged || st.mtimeMs >= R.updatedAt)) {
      // pendant que Claude écrit : au plus un envoi toutes les 2 minutes
      if (!force && s.status === 'working' && T && Date.now() - T.at < 120000) return;
      await upload(cfg, s, file, st, R);
    } else if (remoteChanged && !s.pty && !(T?.tooBig && st && st.mtimeMs >= R.updatedAt)) await download(cfg, s, R);
  }

  const remoteTranscripts = async () => new Map(((await call('GET', '/transcripts')).items || []).map(x => [x.uid, x]));
  async function syncTranscripts() {
    const cfg = config();
    if (!cfg || !txOn()) return;
    const remote = await remoteTranscripts();
    for (const s of [...sessions.values()]) {
      if (!s.syncId) continue;
      try { await reconcile(cfg, s, remote.get(s.syncId)); } catch (e) { if (!/conversation reçue/.test(e.message)) throw e; }
    }
    saveState();
  }
  // « Reprendre » : récupérer la dernière version de la conversation avant de relancer claude.
  ctx.prepareResume = async s => {
    const cfg = config();
    if (!cfg || !txOn() || !s.syncId || s.pty) return;
    try {
      const R = (await remoteTranscripts()).get(s.syncId);
      await reconcile(cfg, s, R, true);
      saveState();
    } catch (e) { status.lastError = 'conversations : ' + e.message; }
  };

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
        scan(); // groupes et modèles locaux, maintenant que ceux des autres machines sont connus
        await push();
        status.lastOk = Date.now(); status.lastError = '';
        try { await syncTranscripts(); } catch (e) { status.lastError = 'conversations : ' + e.message; }
      } catch (e) {
        status.lastError = e.message;
        throw e;
      } finally { status.busy = false; broadcast({ t: 'sync', status: view() }); }
    })().finally(() => { running = null; });
    return running;
  }

  // Code changé : autre espace, on repart de zéro (les sessions locales seront envoyées au nouvel espace).
  const codeId = () => { const c = config(); return c ? c.url + ' ' + c.key : settings().syncCode || ''; };
  let lastCode = codeId();
  function checkCode() {
    const code = codeId();
    if (code === lastCode) return;
    lastCode = code;
    state = { cursor: 0, known: {}, outbox: {}, tx: {}, docsPulled: false };
    for (const s of sessions.values()) { delete s.syncId; delete s.syncCwd; }
    saveState();
    scan();
  }

  const view = () => ({
    enabled: !!config(), invalid: !!settings().syncCode && !config(), code: config()?.code || '', server: config()?.url || server(), machine: machine(), lastOk: status.lastOk, lastError: status.lastError,
    pending: Object.keys(state.outbox).length, busy: status.busy, transcripts: txOn(), groups: docOn(GROUPS_UID), templates: docOn(TPL), sent: status.txUp, received: status.txDown,
  });

  route('GET', /^\/api\/sync$/, async ({ res }) => json(res, 200, view()));
  route('POST', /^\/api\/sync\/now$/, async ({ res }) => {
    checkCode();
    try { await sync(); } catch { }
    json(res, 200, view());
  });
  // Nouveau code : créé et enregistré par le serveur de synchro. L'interface l'enregistre ensuite dans syncCode.
  route('POST', /^\/api\/sync\/code$/, async ({ res }) => {
    const url = server().replace(/\/+$/, '');
    if (!/^https?:\/\/\S+$/.test(url)) return json(res, 400, { error: 'adresse du serveur invalide' });
    try {
      const r = await fetch(url + '/spaces', { method: 'POST', signal: AbortSignal.timeout(15000) });
      const b = await r.json().catch(() => ({}));
      const key = shortKey(b.code);
      if (!r.ok || !key) return json(res, 502, { error: b.error || `serveur de synchro : HTTP ${r.status}` });
      json(res, 200, { code: formatCode(key) });
    } catch (e) { json(res, 502, { error: 'serveur de synchro injoignable : ' + e.message }); }
  });

  const optsOf = () => ['syncGroups', 'syncTemplates', 'syncTranscripts'].map(k => settings()[k] !== false);
  let lastOpts = optsOf();
  ctx.syncChanged = () => {
    const now = optsOf();
    if (now.some((on, i) => on && !lastOpts[i])) { state.cursor = 0; saveState(); }
    lastOpts = now;
    if (!scanTimer) scanTimer = setTimeout(scan, 300);
  };
  const tick = () => { checkCode(); sync().catch(() => { }); };
  setTimeout(tick, Number(process.env.CSM_SYNC_DELAY) || 2000);
  setInterval(tick, INTERVAL).unref?.();
};

module.exports.decodeCode = decodeCode;
module.exports.encodeCode = encodeCode;
module.exports.DEFAULT_SERVER = DEFAULT_SERVER;
module.exports.parseRoots = parseRoots;
module.exports.toPortable = toPortable;
module.exports.fromPortable = fromPortable;
module.exports.seal = seal;
module.exports.unseal = unseal;
module.exports.txVersion = txVersion;
