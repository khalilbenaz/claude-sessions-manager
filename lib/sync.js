'use strict';
// Synchronisation des sessions entre machines (#27) : nom, dossier, modèle et mode, groupe, épinglage, couleur,
// Remote Control, et leurs conversations (chiffrées de bout en bout, réglage syncTranscripts) ; aussi la liste
// des groupes (vides compris, dans l'ordre) et les modèles de session, chiffrés eux aussi.
//
// Désactivée tant qu'aucun code de synchro n'est saisi dans Réglages › Synchronisation. Le code est tiré sur
// cette machine et ne quitte jamais les machines : le serveur (Worker Cloudflare, voir sync-worker/) ne reçoit
// qu'une clé d'accès dérivée du code et n'en garde que l'empreinte. Tout le contenu (sessions, groupes, modèles,
// conversations) est chiffré avec une autre clé dérivée du code : le serveur ne peut ni le lire ni le modifier.
// Seules les machines qui partagent le même code se voient, chaque code est un espace isolé.
//
// Fusion par session, la modification la plus récente gagne. Une session venue d'une autre machine est
// ajoutée arrêtée : « Reprendre » continue sa conversation dans le dossier correspondant ici.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const memsync = require('./memsync');
const claudesync = require('./claudesync');

const SYNCED = ['name', 'args', 'group', 'pinned', 'color', 'remote', 'named'];
// Intervalle entre deux synchronisations (réglage syncMinutes : 5, 10, 30 ou 60 min) ; les
// changements faits sur cette machine partent tout de suite (schedulePush), sans attendre.
const interval = minutes => Number(process.env.CSM_SYNC_INTERVAL) || (Number(minutes) || 5) * 60e3;
const CHUNK = 1024 * 1024, MAX_CHUNKS = 40; // conversation chiffrée : morceaux de 1 Mo, 40 Mo au plus

// ---------------------------------------------------------------- code de synchro
// Code court « XXXX-XXXX-XXXX-XXXX-XXXX » (base32 de Crockford, 100 bits), tiré localement.
// L'ancien format « csm1.… » (adresse + clé encodées) reste accepté.
const DEFAULT_SERVER = 'https://csm-sync.khalilbenaz.workers.dev';
// HTTPS obligatoire, sauf serveur local (tests, serveur auto-hébergé sur la machine).
const okUrl = u => /^https:\/\/[^\s/]+\S*$/.test(u) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/\S*)?$/.test(u);
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const newCode = () => [...crypto.randomBytes(20)].map(b => ALPHABET[b & 31]).join('');
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
  if (short) return okUrl(server) ? { url: server.replace(/\/+$/, ''), key: short, code: formatCode(short) } : null;
  if (!c.startsWith(CODE_PREFIX)) return null;
  try {
    const { u, k } = JSON.parse(Buffer.from(c.slice(CODE_PREFIX.length), 'base64url').toString('utf8'));
    if (!okUrl(u) || typeof k !== 'string' || k.length < 16) return null;
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

// ---------------------------------------------------------------- clés et chiffrement
// Deux clés indépendantes dérivées du code : la clé d'accès (envoyée au serveur, qui n'en garde que l'empreinte)
// et les clés de chiffrement (jamais envoyées). Connaître la première ne permet pas de retrouver les autres.
const authKey = code => Buffer.from(crypto.hkdfSync('sha256', code, 'csm-auth', 'v2', 32)).toString('hex');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
function txKeys(key) {
  const k = Buffer.from(crypto.hkdfSync('sha256', key, 'csm-transcripts', 'aes-256-gcm-v2', 64));
  return { enc: k.subarray(0, 32), mac: k.subarray(32) };
}
const txVersion = (key, raw) => crypto.createHmac('sha256', txKeys(key).mac).update(raw).digest('hex').slice(0, 32);
// aad : identité de l'élément (session, version, date) liée au chiffré — le serveur ne peut ni échanger deux
// éléments, ni remettre une ancienne version sous une date récente.
function seal(key, raw, aad = '') {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', txKeys(key).enc, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(zlib.gzipSync(raw)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function unseal(key, blob, aad = '') {
  const d = crypto.createDecipheriv('aes-256-gcm', txKeys(key).enc, blob.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(12, 28));
  return zlib.gunzipSync(Buffer.concat([d.update(blob.subarray(28)), d.final()]));
}
const sealJson = (key, obj, aad) => ({ e: seal(key, Buffer.from(JSON.stringify(obj)), aad).toString('base64') });
const openJson = (key, data, aad) => JSON.parse(unseal(key, Buffer.from(String(data?.e || ''), 'base64'), aad).toString('utf8'));
const metaAad = (uid, updatedAt) => `s|${uid}|${updatedAt}`;
const txAad = (uid, cid, ver, updatedAt) => `t|${uid}|${cid}|${ver}|${updatedAt}`;

// ---------------------------------------------------------------- données reçues : validées
// Arguments de claude repris d'une autre machine : seulement le modèle, le mode (hors bypassPermissions)
// et l'effort. Tout le reste (--settings, --dangerously-skip-permissions, --mcp-config…) pourrait exécuter
// des commandes ici ; il n'est ni envoyé ni appliqué.
const MODES = ['default', 'acceptEdits', 'plan'];
function safeArgs(args) {
  const t = String(args || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const out = [];
  for (let i = 0; i < t.length; i++) {
    const inline = /^--[\w-]+=/.test(t[i]);
    const [k, v] = inline ? [t[i].slice(0, t[i].indexOf('=')), t[i].slice(t[i].indexOf('=') + 1)] : [t[i], t[i + 1]];
    if (k === '--model' || k === '--fallback-model') { if (/^[\w.:[\]-]{1,60}$/.test(v || '')) out.push(k, v); }
    else if (k === '--permission-mode') { if (MODES.includes(v)) out.push(k, v); }
    else if (k === '--effort') { if (/^(low|medium|high|xhigh|max)$/.test(v || '')) out.push(k, v); }
    else continue;
    if (!inline) i++;
  }
  return out.join(' ');
}
function cleanMeta(d) {
  d = d && typeof d === 'object' ? d : {};
  const o = { cwd: typeof d.cwd === 'string' ? d.cwd.slice(0, 1000) : '' };
  if (typeof d.name === 'string' && d.name.trim()) o.name = d.name.slice(0, 80);
  const a = safeArgs(d.args); if (a) o.args = a;
  if (typeof d.group === 'string' && d.group.trim()) o.group = d.group.slice(0, 60);
  if (typeof d.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.color)) o.color = d.color;
  for (const k of ['pinned', 'remote', 'named']) if (d[k] === true) o[k] = true;
  return o;
}

module.exports = function (ctx) {
  const { route, json, sessions, publicView, persist, persistHooks, broadcast, DATA, IS_WIN } = ctx;
  const STATE = path.join(DATA, 'sync-state.json');
  const home = os.homedir();

  let state = { cursor: 0, known: {}, outbox: {}, tx: {}, docsPulled: false };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE, 'utf8')) }; } catch { }
  // 3.8 : nouveau format (clés v2, sessions chiffrées) — tout est renvoyé une fois
  if (state.format !== 2) state = { cursor: 0, known: {}, outbox: {}, tx: {}, docsPulled: false, format: 2 };
  const saveState = () => { const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 }); fs.renameSync(tmp, STATE); };
  const status = { enabled: false, lastOk: 0, lastError: '', pulled: 0, pushed: 0, busy: false, txUp: 0, txDown: 0, memUp: 0, memDown: 0, memAvailable: null, nmUp: 0, nmDown: 0, cfUp: 0, cfDown: 0, cfFiles: 0 };

  const settings = () => ctx.getSettings?.() || {};
  const server = () => String(settings().syncServer || '').trim() || DEFAULT_SERVER;
  const config = () => decodeCode(settings().syncCode, server());
  const machine = () => String(settings().syncMachine || '').trim() || os.hostname();
  const roots = () => parseRoots(settings().syncRoots, home, IS_WIN);
  const payload = s => {
    const d = { cwd: s.syncCwd || toPortable(s.cwd, roots()) };
    for (const k of SYNCED) if (s[k] !== undefined && s[k] !== null && s[k] !== '') d[k] = s[k];
    return cleanMeta(d);
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
      state.outbox[s.syncId] = { uid: s.syncId, data: sealJson(config().key, d, metaAad(s.syncId, updatedAt)), updatedAt, deleted: false, origin: s.origin || machine() };
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
        state.outbox[uid] = { uid, data: sealJson(cfg.key, d, metaAad(uid, updatedAt)), updatedAt, deleted: false, origin: machine() };
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
      try { d = openJson(config().key, it.data, metaAad(it.uid, it.updatedAt)); } catch { return false; }
    }
    let f = null;
    if (it.uid === GROUPS_UID) {
      const remote = Array.isArray(d?.list) ? d.list.map(x => String(x).trim().slice(0, 60)).filter(Boolean) : [];
      // première rencontre : on réunit les deux listes (la réunion repart ensuite vers les autres machines)
      const next = k ? remote : [...new Set([...remote, ...groupList()])];
      ctx.patchSettings?.({ groupList: next.join('\n').slice(0, 4000) });
      f = fp({ list: remote });
    } else {
      const id = it.uid.slice(TPL.length);
      const list = [...(ctx.getTemplates?.() || [])];
      const i = list.findIndex(t => t.id === id);
      if (d) {
        const found = typeof d.cwd === 'string' && d.cwd ? fromPortable(d.cwd, roots(), IS_WIN) : '';
        // mêmes limites que pour une session : pas d'arguments hors modèle / mode / effort, pas de bypass
        const t = { ...d, id, cwd: found || '', extra: safeArgs(d.extra), mode: MODES.includes(d.mode) ? d.mode : '' };
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
  // Espace créé avant la 3.8 (le serveur connaissait le code) : on lui rattache une fois la clé d'accès, en
  // prouvant l'ancien accès. Ensuite le code n'est plus jamais envoyé.
  let linkTried = '';
  async function link(cfg) {
    if (linkTried === cfg.key) return false;
    linkTried = cfg.key;
    const r = await fetch(cfg.url + '/spaces/link', {
      method: 'POST', headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ auth: sha256(authKey(cfg.key)) }), signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    return !!r?.ok;
  }
  async function call(method, p, body, raw) {
    const cfg = config();
    if (!cfg) throw new Error('synchronisation non configurée');
    const bin = Buffer.isBuffer(body);
    const go = () => fetch(cfg.url + p, {
      method, headers: { authorization: `Bearer ${authKey(cfg.key)}`, 'content-type': bin ? 'application/octet-stream' : 'application/json' },
      body: bin ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(bin || raw ? 60000 : 15000),
    });
    let r = await go();
    if (r.status === 401 && await link(cfg)) r = await go();
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
  function insertRemote(it, d) {
    const found = fromPortable(d.cwd, roots(), IS_WIN);
    const cwd = found && fs.existsSync(found) ? found : home;
    const from = String(it.origin || '').slice(0, 80) || 'une autre machine';
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
    // chiffré par une autre machine (3.8+), ou en clair (versions précédentes) : validé dans les deux cas
    let d;
    if (it.data?.e) { try { d = openJson(config().key, it.data, metaAad(it.uid, it.updatedAt)); } catch { return false; } }
    else d = it.data;
    d = cleanMeta(d);
    let s = local;
    if (!s) s = insertRemote(it, d);
    else {
      for (const f of SYNCED) {
        if (f === 'name' && !d.name) continue;
        // arguments : on garde ceux d'ici qui ne se synchronisent pas (ex. bypassPermissions) si le reste est identique
        if (f === 'args' && safeArgs(s.args) === (d.args || '')) continue;
        s[f] = d[f] ?? (f === 'args' ? '' : f === 'named' || f === 'pinned' || f === 'remote' ? false : undefined);
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
    const updatedAt = Math.round(st.mtimeMs);
    const blob = seal(cfg.key, raw, txAad(s.syncId, s.claudeSessionId, ver, updatedAt));
    if (blob.length > MAX_CHUNKS * CHUNK) { state.tx[s.syncId] = { ...rec, ver: null, tooBig: true }; return; }
    const chunks = Math.ceil(blob.length / CHUNK) || 1;
    for (let n = 0; n < chunks; n++) await call('PUT', `/transcripts/${s.syncId}/${ver}/${n}`, blob.subarray(n * CHUNK, (n + 1) * CHUNK));
    await call('PUT', `/transcripts/${s.syncId}`, { cid: s.claudeSessionId, ver, chunks, size: blob.length, updatedAt, origin: machine() });
    state.tx[s.syncId] = rec;
    status.txUp++;
  }

  async function download(cfg, s, R) {
    // identifiants venus du serveur : vérifiés avant tout usage (le cid devient un nom de fichier)
    if (!/^[\w-]{1,64}$/.test(String(R.cid)) || !/^[0-9a-f]{32}$/.test(String(R.ver)) || !(Number.isInteger(R.chunks) && R.chunks >= 1 && R.chunks <= MAX_CHUNKS)) {
      throw new Error('conversation reçue incomplète');
    }
    const parts = [];
    for (let n = 0; n < R.chunks; n++) parts.push(await call('GET', `/transcripts/${s.syncId}/${R.ver}/${n}`, undefined, true));
    let raw;
    try { raw = unseal(cfg.key, Buffer.concat(parts), txAad(s.syncId, R.cid, R.ver, R.updatedAt)); } catch { throw new Error('conversation reçue incomplète'); }
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
  // ---------------------------------------------------------------- mémoire claude-mem (lib/memsync.js)
  const usesMem = () => settings().memoryEngine === 'claude-mem';
  const memOn = () => usesMem() && settings().syncSessionMemory !== false;
  // claude-mem choisi comme moteur de mémoire mais absent : installation automatique, en arrière-plan
  status.memInstall = '';
  let installing = null;
  function ensureClaudeMem() {
    if (!usesMem() || installing || memsync.pluginRoot() || process.env.CSM_NO_PLUGIN_INSTALL) return installing;
    status.memInstall = 'installing'; broadcast({ t: 'sync', status: view() });
    installing = memsync.install(ctx.CLAUDE)
      .then(() => { status.memInstall = 'installed'; })
      .catch(e => { status.memInstall = 'error: ' + e.message; console.error('claude-mem : ' + e.message); })
      .finally(() => { installing = null; broadcast({ t: 'sync', status: view() }); });
    return installing;
  }
  ctx.memoryEngineChanged = ensureClaudeMem;
  setTimeout(ensureClaudeMem, 3000).unref?.();
  const memState = () => {
    const m = state.mem || (state.mem = {});
    if (!/^[0-9a-f]{12}$/.test(m.dev || '')) m.dev = memsync.randomDev();
    m.wm = m.wm || {}; m.applied = m.applied || {}; m.seq = m.seq || 0;
    return m;
  };
  const memAad = (uid, ver, updatedAt) => `m|${uid}|${ver}|${updatedAt}`;
  // variables des sessions lancées par l'application : leur mémoire claude-mem = l'espace synchronisé
  ctx.memEnv = () => {
    if (!config() || !memOn()) return {};
    try { return memsync.prepare(DATA); } catch { return {}; }
  };
  async function syncMemory() {
    const cfg = config();
    if (!cfg || !memOn()) { status.memAvailable = null; return; }
    await memsync.ensureDb(DATA, memsync.prepare(DATA));
    let M;
    try { M = memsync.open(DATA); } catch (e) {
      // base créée par un claude-mem trop ancien : mise à jour et migration automatiques (au plus toutes les 6 h)
      const m = memState();
      if (e.code !== 'CLAUDE_MEM_OLD' || Date.now() - (m.repairAt || 0) < 6 * 3600e3) throw e;
      m.repairAt = Date.now(); saveState();
      const say = msg => { status.lastError = 'mémoire : ' + msg; broadcast({ t: 'sync', status: view() }); };
      await memsync.repair(DATA, ctx.CLAUDE, say);
      M = memsync.open(DATA);
      status.lastError = '';
    }
    status.memAvailable = !!M;
    if (!M) return;
    try {
      const m = memState(), remote = await remoteTranscripts(), mine = memsync.PREFIX + m.dev + '-';
      // d'abord recevoir : une machine qui rejoint l'espace charge la mémoire des autres tout de suite
      for (const [uid, R] of remote) {
        if (!uid.startsWith(memsync.PREFIX) || uid.startsWith(mine) || m.applied[uid] === R.ver) continue;
        const dev = uid.slice(memsync.PREFIX.length).split('-')[0];
        if (!/^[0-9a-f]{12}$/.test(dev) || !/^[0-9a-f]{32}$/.test(String(R.ver)) || !(Number.isInteger(R.chunks) && R.chunks >= 1 && R.chunks <= MAX_CHUNKS)) continue;
        const parts = [];
        for (let n = 0; n < R.chunks; n++) parts.push(await call('GET', `/transcripts/${uid}/${R.ver}/${n}`, undefined, true));
        let raw;
        try { raw = unseal(cfg.key, Buffer.concat(parts), memAad(uid, R.ver, R.updatedAt)); } catch { continue; }
        if (txVersion(cfg.key, raw) !== R.ver) continue;
        let b; try { b = JSON.parse(raw.toString('utf8')); } catch { continue; }
        if (!b || b.v !== 1 || b.dev !== dev) continue;
        status.memDown += memsync.importBatch(M, dev, b);
        m.applied[uid] = R.ver;
        saveState();
      }
      // puis envoyer ce qui est né ici depuis le dernier lot
      for (let i = 0; i < memsync.MAX_BATCHES; i++) {
        const { batch, next, count } = memsync.exportBatch(M, m.wm);
        if (!count) break;
        const uid = `${memsync.PREFIX}${m.dev}-${m.seq + 1}`;
        const raw = Buffer.from(JSON.stringify({ v: 1, dev: m.dev, ...batch })), ver = txVersion(cfg.key, raw), updatedAt = Date.now();
        const blob = seal(cfg.key, raw, memAad(uid, ver, updatedAt));
        const chunks = Math.ceil(blob.length / CHUNK) || 1;
        if (chunks > MAX_CHUNKS) throw new Error('lot trop gros');
        for (let n = 0; n < chunks; n++) await call('PUT', `/transcripts/${uid}/${ver}/${n}`, blob.subarray(n * CHUNK, (n + 1) * CHUNK));
        await call('PUT', `/transcripts/${uid}`, { cid: 'claude-mem', ver, chunks, size: blob.length, updatedAt, origin: machine() });
        m.seq++; m.wm = next; m.applied[uid] = ver;
        status.memUp += count;
        saveState();
      }
    } finally { M.db.close(); }
  }

  // ---------------------------------------------------------------- mémoire native (lib/memory.js)
  // Une fiche par session, uid « nm-<id de la conversation> » : la plus récente (champ updated) gagne.
  // got[uid] = dernière version reçue, put[uid] = version de la fiche locale déjà envoyée (ou reçue).
  const NM = 'nm-';
  const nmOn = () => !!ctx.memory && ctx.memory.on() && settings().syncSessionMemory !== false;
  const nmAad = (uid, ver, updatedAt) => `n|${uid}|${ver}|${updatedAt}`;
  async function syncNativeMemory() {
    const cfg = config();
    if (!cfg || !nmOn()) return;
    const st = state.nm || (state.nm = { got: {}, put: {} });
    const mem = ctx.memory, remote = await remoteTranscripts();
    const local = e => Buffer.from(JSON.stringify(mem.shared(e)));
    for (const [uid, R] of remote) {
      if (!uid.startsWith(NM) || st.got[uid] === R.ver || st.put[uid] === R.ver) continue;
      if (!/^[0-9a-f]{32}$/.test(String(R.ver)) || !(Number.isInteger(R.chunks) && R.chunks >= 1 && R.chunks <= 4)) continue;
      const cur = mem.get(uid.slice(NM.length));
      if (cur && cur.updated >= R.updatedAt) { st.got[uid] = R.ver; continue; } // la nôtre est plus récente : elle partira
      const parts = [];
      for (let n = 0; n < R.chunks; n++) parts.push(await call('GET', `/transcripts/${uid}/${R.ver}/${n}`, undefined, true));
      let e;
      try {
        const raw = zlib.gunzipSync(unseal(cfg.key, Buffer.concat(parts), nmAad(uid, R.ver, R.updatedAt)));
        if (txVersion(cfg.key, raw) !== R.ver) continue;
        e = JSON.parse(raw.toString('utf8'));
      } catch { continue; }
      st.got[uid] = R.ver;
      if (!e || NM + e.id !== uid || !mem.put(e)) continue;
      st.put[uid] = txVersion(cfg.key, local(mem.get(e.id)));
      status.nmDown++;
      saveState();
    }
    for (const e of mem.list()) {
      const uid = NM + e.id, raw = local(e), ver = txVersion(cfg.key, raw);
      if (st.put[uid] === ver) continue;
      const updatedAt = e.updated || Date.now();
      const blob = seal(cfg.key, zlib.gzipSync(raw), nmAad(uid, ver, updatedAt));
      const chunks = Math.ceil(blob.length / CHUNK) || 1;
      if (chunks > 4) continue;
      for (let n = 0; n < chunks; n++) await call('PUT', `/transcripts/${uid}/${ver}/${n}`, blob.subarray(n * CHUNK, (n + 1) * CHUNK));
      await call('PUT', `/transcripts/${uid}`, { cid: 'memory', ver, chunks, size: blob.length, updatedAt, origin: machine() });
      st.put[uid] = ver; st.got[uid] = ver;
      status.nmUp++;
      saveState();
    }
  }

  // ---------------------------------------------------------------- règles, skills, agents, mémoire de Claude (lib/claudesync.js)
  const syncClaude = claudesync({ DATA, settings, call, seal, unseal, txVersion, remote: () => remoteTranscripts(), machine, getState: () => state, saveState, status });
  const cfOn = () => Object.values(claudesync.KINDS).some(k => settings()[k.setting] !== false);

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
        try { await syncMemory(); } catch (e) { status.lastError = 'mémoire : ' + e.message; }
        try { await syncNativeMemory(); } catch (e) { status.lastError = 'mémoire partagée : ' + e.message; }
        try { await syncClaude(config()); } catch (e) { status.lastError = 'règles, skills et agents : ' + e.message; }
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
    state = { cursor: 0, known: {}, outbox: {}, tx: {}, docsPulled: false, format: 2, mem: { dev: state.mem?.dev }, nm: { got: {}, put: {} }, cf: { files: {}, got: {}, paths: {}, at: {} } };
    linkTried = '';
    for (const s of sessions.values()) { delete s.syncId; delete s.syncCwd; }
    saveState();
    scan();
  }

  const view = () => ({
    enabled: !!config(), invalid: !!settings().syncCode && !config(), code: config()?.code || '', server: config()?.url || server(), machine: machine(), lastOk: status.lastOk, lastError: status.lastError,
    pending: Object.keys(state.outbox).length, busy: status.busy, transcripts: txOn(), groups: docOn(GROUPS_UID), templates: docOn(TPL), sent: status.txUp, received: status.txDown,
    memory: memOn(), memEngine: settings().memoryEngine || 'native', memInstall: status.memInstall || '', memInstalled: !!memsync.pluginRoot(), memAvailable: status.memAvailable ?? null, memSent: status.memUp, memReceived: status.memDown,
    nativeMemory: nmOn(), nmSent: status.nmUp, nmReceived: status.nmDown,
    claude: cfOn(), cfSent: status.cfUp, cfReceived: status.cfDown, cfFiles: status.cfFiles,
  });

  route('GET', /^\/api\/sync$/, async ({ res }) => json(res, 200, view()));
  route('POST', /^\/api\/sync\/now$/, async ({ res }) => {
    checkCode();
    try { await sync(); } catch { }
    json(res, 200, view());
  });
  // Nouveau code : tiré sur cette machine ; le serveur n'enregistre que l'empreinte de la clé d'accès.
  // L'interface l'enregistre ensuite dans syncCode.
  route('POST', /^\/api\/sync\/code$/, async ({ res }) => {
    const url = server().replace(/\/+$/, '');
    if (!okUrl(url)) return json(res, 400, { error: 'adresse du serveur invalide (https exigé)' });
    const code = newCode();
    try {
      const r = await fetch(url + '/spaces', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auth: sha256(authKey(code)) }), signal: AbortSignal.timeout(15000),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b.ok !== true) return json(res, 502, { error: b.error || (r.ok ? 'serveur de synchro à mettre à jour' : `serveur de synchro : HTTP ${r.status}`) });
      json(res, 200, { code: formatCode(code) });
    } catch (e) { json(res, 502, { error: 'serveur de synchro injoignable : ' + e.message }); }
  });

  const optsOf = () => ['syncGroups', 'syncTemplates', 'syncTranscripts', 'syncSessionMemory', ...Object.values(claudesync.KINDS).map(k => k.setting)].map(k => settings()[k] !== false);
  let lastOpts = optsOf();
  ctx.syncChanged = () => {
    const now = optsOf();
    if (now.some((on, i) => on && !lastOpts[i])) { state.cursor = 0; saveState(); }
    lastOpts = now;
    if (!scanTimer) scanTimer = setTimeout(scan, 300);
    if (settings().syncMinutes !== lastMinutes) planTick();
  };
  let tickTimer = null, lastMinutes;
  const planTick = () => {
    clearTimeout(tickTimer);
    lastMinutes = settings().syncMinutes;
    tickTimer = setTimeout(tick, interval(lastMinutes));
    tickTimer.unref?.();
  };
  const tick = () => { planTick(); checkCode(); sync().catch(() => { }); };
  setTimeout(tick, Number(process.env.CSM_SYNC_DELAY) || 2000);
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
module.exports.authKey = authKey;
module.exports.sealJson = sealJson;
module.exports.openJson = openJson;
module.exports.safeArgs = safeArgs;
module.exports.cleanMeta = cleanMeta;
