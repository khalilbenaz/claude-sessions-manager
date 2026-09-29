// Synchro des sessions de Claude Sessions Manager (#27) et de leurs conversations, chiffrées par l'app avant
// l'envoi (AES-256-GCM, clé dérivée du code) : ici, les conversations ne sont que des octets illisibles.
// GET  /sessions?since=<rev>  -> { rev, items: [{ uid, data, updatedAt, deleted, origin, rev }] }
// POST /sessions { items }    -> { rev, applied }   (une ligne n'écrase que si updatedAt est plus récent)
// POST /spaces                -> { code }           (crée un espace : le code n'est montré qu'une fois)
// GET  /transcripts           -> { items: [{ uid, cid, ver, chunks, size, updatedAt, origin }] }
// PUT  /transcripts/<uid>/<ver>/<n>   octets        (morceau n de la version ver, 1 Mo au plus)
// GET  /transcripts/<uid>/<ver>/<n>   -> octets
// PUT  /transcripts/<uid> { cid, ver, chunks, size, updatedAt, origin } -> { applied }
//      (valide une version dont tous les morceaux sont envoyés ; les autres versions sont effacées)
// Une session supprimée (POST /sessions, deleted) efface aussi sa conversation.
//
// Authorization: Bearer <clé>. La clé vient du code de synchro saisi dans l'app ; chaque clé est un espace
// isolé (space = SHA-256 de la clé). Une clé est acceptée si son empreinte est dans csm_spaces (code créé par
// POST /spaces) ou si elle figure dans le secret SYNC_KEYS. Le serveur ne garde que l'empreinte, jamais le code :
// un inconnu qui trouve l'URL ne peut rien lire sans deviner 100 bits aléatoires.
// Le rev est attribué dans SQL : D1 sérialise les écritures, deux push simultanés n'ont jamais le même rev.

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

// Base32 de Crockford (sans I, L, O, U) : lisible, sans ambiguïté à la dictée. 20 caractères = 100 bits.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const newCode = () => [...crypto.getRandomValues(new Uint8Array(20))].map(b => ALPHABET[b & 31]).join('');
const DAY = 86400000;
const PER_IP_PER_DAY = 5;
const PER_DAY = 500;
const CHUNK_MAX = 1024 * 1024 + 64, MAX_CHUNKS = 40;
const SPACE_MAX = 400 * 1024 * 1024; // octets de conversations par espace

// Morceaux stockés en base64 (TEXT) : évite les particularités des BLOB de D1.
function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));

async function transcripts(req, env, space, parts) {
  const [uid, ver, n] = parts;
  if (uid !== undefined && !/^[\w-]{6,64}$/.test(uid)) return json({ error: 'bad uid' }, 400);
  if (ver !== undefined && !/^[0-9a-f]{32}$/.test(ver)) return json({ error: 'bad version' }, 400);
  const idx = Number(n);
  if (n !== undefined && !(Number.isInteger(idx) && idx >= 0 && idx < MAX_CHUNKS)) return json({ error: 'bad chunk' }, 400);

  if (!uid && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT uid, cid, ver, chunks, size, updatedAt, origin FROM csm_transcripts WHERE space = ?',
    ).bind(space).all();
    return json({ items: results });
  }
  if (n !== undefined && req.method === 'GET') {
    const row = await env.DB.prepare('SELECT data FROM csm_chunks WHERE space = ? AND uid = ? AND ver = ? AND n = ?')
      .bind(space, uid, ver, idx).first();
    return row ? new Response(fromB64(row.data), { headers: { 'content-type': 'application/octet-stream' } }) : json({ error: 'not found' }, 404);
  }
  if (n !== undefined && req.method === 'PUT') {
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > CHUNK_MAX) return json({ error: 'chunk too large' }, 413);
    const used = await env.DB.prepare('SELECT COALESCE(SUM(LENGTH(data)), 0) AS used FROM csm_chunks WHERE space = ?').bind(space).first();
    if (used.used * 0.75 + body.length > SPACE_MAX) return json({ error: 'space full' }, 413);
    await env.DB.prepare(
      'INSERT INTO csm_chunks (space, uid, ver, n, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(space, uid, ver, n) DO UPDATE SET data = excluded.data',
    ).bind(space, uid, ver, idx, toB64(body)).run();
    return json({ ok: true });
  }
  if (uid && ver === undefined && req.method === 'PUT') {
    let b;
    try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const chunks = Number(b.chunks);
    if (!/^[0-9a-f]{32}$/.test(b.ver || '') || !/^[\w-]{1,64}$/.test(b.cid || '') || !(chunks >= 1 && chunks <= MAX_CHUNKS)) return json({ error: 'bad meta' }, 400);
    const have = await env.DB.prepare('SELECT COUNT(*) AS c FROM csm_chunks WHERE space = ? AND uid = ? AND ver = ? AND n < ?')
      .bind(space, uid, b.ver, chunks).first();
    if (have.c !== chunks) return json({ error: 'missing chunks' }, 409);
    const out = await env.DB.prepare(
      `INSERT INTO csm_transcripts (space, uid, cid, ver, chunks, size, updatedAt, origin) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(space, uid) DO UPDATE SET cid = excluded.cid, ver = excluded.ver, chunks = excluded.chunks, size = excluded.size,
         updatedAt = excluded.updatedAt, origin = excluded.origin
       WHERE excluded.updatedAt >= csm_transcripts.updatedAt`,
    ).bind(space, uid, b.cid, b.ver, chunks, Number(b.size) || 0, Number(b.updatedAt) || 0, String(b.origin || '').slice(0, 80)).run();
    const applied = !!out.meta?.changes;
    // garder seulement la version en vigueur
    const cur = await env.DB.prepare('SELECT ver FROM csm_transcripts WHERE space = ? AND uid = ?').bind(space, uid).first();
    await env.DB.prepare('DELETE FROM csm_chunks WHERE space = ? AND uid = ? AND ver <> ?').bind(space, uid, cur?.ver || '').run();
    return json({ applied });
  }
  return json({ error: 'method not allowed' }, 405);
}

async function spaceOf(req, env) {
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (key.length < 16) return null;
  const space = await sha256(key);
  const allowed = String(env.SYNC_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.some(k => sameString(k, key))) return space;
  const row = await env.DB.prepare('SELECT 1 FROM csm_spaces WHERE space = ?').bind(space).first();
  return row ? space : null;
}

async function createSpace(req, env) {
  const since = Date.now() - DAY;
  const ipHash = await sha256('csm-ip:' + (req.headers.get('cf-connecting-ip') || ''));
  const counts = await env.DB.prepare(
    'SELECT COUNT(*) AS total, SUM(ipHash = ?) AS mine FROM csm_spaces WHERE createdAt > ?',
  ).bind(ipHash, since).first();
  if ((counts.mine || 0) >= PER_IP_PER_DAY || (counts.total || 0) >= PER_DAY) {
    return json({ error: 'trop de codes créés aujourd’hui, réessaie demain' }, 429);
  }
  const code = newCode();
  await env.DB.prepare('INSERT INTO csm_spaces (space, createdAt, ipHash) VALUES (?, ?, ?)')
    .bind(await sha256(code), Date.now(), ipHash).run();
  return json({ code });
}

async function currentRev(env, space) {
  const row = await env.DB.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM csm_sessions WHERE space = ?').bind(space).first();
  return row.rev;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname === '/spaces') return req.method === 'POST' ? createSpace(req, env) : json({ error: 'method not allowed' }, 405);
    const tx = url.pathname.match(/^\/transcripts(?:\/([^/]+)(?:\/([^/]+)\/([^/]+))?)?$/);
    if (url.pathname !== '/sessions' && !tx) return json({ error: 'not found' }, 404);
    const space = await spaceOf(req, env);
    if (!space) return json({ error: 'unauthorized' }, 401);
    if (tx) return transcripts(req, env, space, tx.slice(1).filter(x => x !== undefined));

    if (req.method === 'GET') {
      const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
      const { results } = await env.DB.prepare(
        'SELECT uid, data, updatedAt, deleted, origin, rev FROM csm_sessions WHERE space = ? AND rev > ? ORDER BY rev LIMIT 1000',
      ).bind(space, since).all();
      return json({ rev: await currentRev(env, space), items: results.map(r => ({ ...r, data: JSON.parse(r.data), deleted: !!r.deleted })) });
    }

    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const items = Array.isArray(body?.items) ? body.items.slice(0, 500) : [];
      const next = '(SELECT COALESCE(MAX(rev), 0) + 1 FROM csm_sessions WHERE space = ?1)';
      const stmts = [], dels = [];
      for (const it of items) {
        if (typeof it?.uid !== 'string' || !/^[\w-]{6,64}$/.test(it.uid)) continue;
        const data = JSON.stringify(it.data || {});
        if (data.length > 20000) continue;
        stmts.push(env.DB.prepare(
          `INSERT INTO csm_sessions (space, uid, data, updatedAt, deleted, origin, rev) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ${next})
           ON CONFLICT(space, uid) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt, deleted = excluded.deleted,
             origin = excluded.origin, rev = ${next}
           WHERE excluded.updatedAt > csm_sessions.updatedAt`,
        ).bind(space, it.uid, data, Number(it.updatedAt) || 0, it.deleted ? 1 : 0, String(it.origin || '').slice(0, 80)));
        if (it.deleted) {
          dels.push(env.DB.prepare('DELETE FROM csm_transcripts WHERE space = ? AND uid = ?').bind(space, it.uid));
          dels.push(env.DB.prepare('DELETE FROM csm_chunks WHERE space = ? AND uid = ?').bind(space, it.uid));
        }
      }
      const out = stmts.length ? (await env.DB.batch([...stmts, ...dels])).slice(0, stmts.length) : [];
      return json({ rev: await currentRev(env, space), applied: out.filter(r => r.meta?.changes).length });
    }
    return json({ error: 'method not allowed' }, 405);
  },
};
