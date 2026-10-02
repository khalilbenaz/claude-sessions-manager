// Synchro des sessions de Claude Sessions Manager (#27) et de leurs conversations, chiffrées par l'app avant
// l'envoi (AES-256-GCM, clé dérivée du code) : ici, les conversations ne sont que des octets illisibles.
// GET  /sessions?since=<rev>  -> { rev, items: [{ uid, data, updatedAt, deleted, origin, rev }] }
// POST /sessions { items }    -> { rev, applied }   (une ligne n'écrase que si updatedAt est plus récent)
// POST /spaces { auth }       -> { ok }             (crée un espace ; auth = SHA-256 de la clé d'accès, calculée
//                                                   par l'app à partir d'un code qu'elle a tiré : le code ne vient jamais ici)
// POST /spaces sans auth       -> 410               (ancien format d'avant la 3.8 : le serveur tirait le code)
// POST /spaces/link { auth }  (Bearer ancien code)  rattache une clé d'accès à un espace créé avant la 3.8
// GET  /transcripts           -> { items: [{ uid, cid, ver, chunks, size, updatedAt, origin }] }
// PUT  /transcripts/<uid>/<ver>/<n>   octets        (morceau n de la version ver, 1 Mo au plus)
// GET  /transcripts/<uid>/<ver>/<n>   -> octets
// PUT  /transcripts/<uid> { cid, ver, chunks, size, updatedAt, origin } -> { applied }
//      (valide une version dont tous les morceaux sont envoyés ; les autres versions sont effacées)
// Une session supprimée (POST /sessions, deleted) efface aussi sa conversation.
//
// Authorization: Bearer <clé d'accès>, dérivée du code par l'app (le code, qui sert aussi à chiffrer, ne vient
// jamais ici). Une clé est acceptée si son empreinte est dans csm_auth (rattachée à un espace), dans csm_spaces,
// ou si elle figure dans le secret SYNC_KEYS. Le serveur ne garde que des empreintes.
// Stockage : métadonnées dans D1, morceaux chiffrés dans R2 (BUCKET, clé <space>/<uid>/<ver>/<n>), place occupée
// tenue dans csm_usage (aucune requête ne relit toutes les lignes).
// Limites : 5 créations d'espace par jour et par adresse (/64 en IPv6), 2000 par jour au total ; par espace
// 5000 lignes et 200 Mo de conversations ; 8 Go de conversations au total (R2 gratuit : 10 Go).
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

const DAY = 86400000;
const PER_IP_PER_DAY = 5;
const PER_DAY = 2000;
const CHUNK_MAX = 1024 * 1024 + 64, MAX_CHUNKS = 40;
const SPACE_MAX = 200 * 1024 * 1024;       // octets de conversations par espace
const TOTAL_MAX = 8 * 1024 * 1024 * 1024;  // octets de conversations tous espaces confondus (R2 gratuit : 10 Go)
const ROWS_MAX = 5000;                     // sessions / groupes / modèles par espace
const HEX64 = /^[0-9a-f]{64}$/;
// IPv6 : on compte par /64 (un attaquant dispose en général de tout un /64)
function ipKey(req) {
  const ip = req.headers.get('cf-connecting-ip') || '';
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') + '::/64' : ip;
}

const partKey = (space, uid, ver, n) => `${space}/${uid}/${ver}/${n}`;
const PENDING_MAX = 200;                   // morceaux envoyés mais pas encore validés, par espace
// Place occupée = octets de tous les morceaux présents (validés ou en attente), comptés par le serveur à la
// réception (jamais la taille annoncée par l'app) ; recalculée chaque nuit (scheduled) contre toute dérive.
const usedBytes = async (env, space) => (await env.DB.prepare('SELECT bytes FROM csm_usage WHERE space = ?').bind(space).first())?.bytes || 0;
const totalBytes = async env => (await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS t FROM csm_usage').first()).t;
const addUsage = (env, space, delta) => env.DB.prepare(
  'INSERT INTO csm_usage (space, bytes) VALUES (?1, MAX(0, ?2)) ON CONFLICT(space) DO UPDATE SET bytes = MAX(0, bytes + ?2)',
).bind(space, delta);
// Efface des morceaux : objets R2 d'abord (par lots), puis lignes D1 et place occupée (requêtes groupées).
// Si R2 échoue, les lignes restent et le prochain ménage réessaie : aucun objet ne reste sans sa ligne.
// rows = [{ space, uid, ver, n, size }]
async function dropParts(env, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 1000) await env.BUCKET.delete(rows.slice(i, i + 1000).map(r => partKey(r.space, r.uid, r.ver, r.n)));
  const del = env.DB.prepare('DELETE FROM csm_parts WHERE space = ? AND uid = ? AND ver = ? AND n = ?');
  const freed = new Map();
  for (const r of rows) freed.set(r.space, (freed.get(r.space) || 0) + (r.size || 0));
  for (let i = 0; i < rows.length; i += 400) {
    await env.DB.batch(rows.slice(i, i + 400).map(r => del.bind(r.space, r.uid, r.ver, r.n)));
  }
  await env.DB.batch([...freed].map(([sp, b]) => addUsage(env, sp, -b)));
}

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
    const obj = await env.BUCKET.get(partKey(space, uid, ver, idx));
    return obj ? new Response(obj.body, { headers: { 'content-type': 'application/octet-stream' } }) : json({ error: 'not found' }, 404);
  }
  if (n !== undefined && req.method === 'PUT') {
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > CHUNK_MAX) return json({ error: 'chunk too large' }, 413);
    const prev = await env.DB.prepare('SELECT size FROM csm_parts WHERE space = ? AND uid = ? AND ver = ? AND n = ?').bind(space, uid, ver, idx).first();
    const delta = body.length - (prev?.size || 0);
    if (!prev) {
      // envois en attente récents seulement (ceux de plus d'une heure sont abandonnés, retirés la nuit)
      const pend = await env.DB.prepare('SELECT COUNT(*) AS c FROM csm_parts WHERE space = ? AND ok = 0 AND at > ?').bind(space, Date.now() - 3600e3).first();
      if (pend.c >= PENDING_MAX) return json({ error: 'too many pending chunks' }, 429);
    }
    if (await usedBytes(env, space) + delta > SPACE_MAX) return json({ error: 'space full' }, 413);
    if (await totalBytes(env) + delta > TOTAL_MAX) return json({ error: 'server full' }, 507);
    // la ligne d'abord (en attente) : si l'écriture R2 échoue, le ménage nocturne la retire
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO csm_parts (space, uid, ver, n, size, at, ok) VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT(space, uid, ver, n) DO UPDATE SET size = excluded.size, at = excluded.at',
      ).bind(space, uid, ver, idx, body.length, Date.now()),
      addUsage(env, space, delta),
    ]);
    await env.BUCKET.put(partKey(space, uid, ver, idx), body);
    return json({ ok: true });
  }
  if (uid && ver === undefined && req.method === 'PUT') {
    let b;
    try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const chunks = Number(b.chunks);
    if (!/^[0-9a-f]{32}$/.test(b.ver || '') || !/^[\w-]{1,64}$/.test(b.cid || '') || !(Number.isInteger(chunks) && chunks >= 1 && chunks <= MAX_CHUNKS)) return json({ error: 'bad meta' }, 400);
    // taille comptée ici, à partir des morceaux reçus (0..chunks-1 tous présents)
    const have = await env.DB.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size), 0) AS size FROM csm_parts WHERE space = ? AND uid = ? AND ver = ? AND n < ?')
      .bind(space, uid, b.ver, chunks).first();
    if (have.c !== chunks) return json({ error: 'missing chunks' }, 409);
    const out = await env.DB.prepare(
      `INSERT INTO csm_transcripts (space, uid, cid, ver, chunks, size, updatedAt, origin) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(space, uid) DO UPDATE SET cid = excluded.cid, ver = excluded.ver, chunks = excluded.chunks, size = excluded.size,
         updatedAt = excluded.updatedAt, origin = excluded.origin
       WHERE excluded.updatedAt >= csm_transcripts.updatedAt`,
    ).bind(space, uid, b.cid, b.ver, chunks, have.size, Number(b.updatedAt) || 0, String(b.origin || '').slice(0, 80)).run();
    const applied = !!out.meta?.changes;
    const cur = await env.DB.prepare('SELECT ver FROM csm_transcripts WHERE space = ? AND uid = ?').bind(space, uid).first();
    if (cur) await env.DB.prepare('UPDATE csm_parts SET ok = 1 WHERE space = ? AND uid = ? AND ver = ?').bind(space, uid, cur.ver).run();
    // anciennes versions validées, et celle-ci si elle a été refusée (plus ancienne) ; les envois en cours
    // d'une autre version restent (le ménage nocturne retire ceux qui ne sont jamais validés)
    const old = (await env.DB.prepare(
      'SELECT space, uid, ver, n, size FROM csm_parts WHERE space = ? AND uid = ? AND ver <> ? AND (ok = 1 OR ver = ?)',
    ).bind(space, uid, cur?.ver || '', b.ver).all()).results;
    try { await dropParts(env, old); } catch { } // version validée quoi qu'il arrive ; le ménage nocturne finira
    return json({ applied });
  }
  return json({ error: 'method not allowed' }, 405);
}

async function spaceOf(req, env) {
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (key.length < 16) return null;
  const h = await sha256(key);
  const linked = await env.DB.prepare('SELECT space FROM csm_auth WHERE auth = ?').bind(h).first();
  if (linked) return linked.space;
  const allowed = String(env.SYNC_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.some(k => sameString(k, key))) return h;
  const row = await env.DB.prepare('SELECT 1 FROM csm_spaces WHERE space = ?').bind(h).first();
  return row ? h : null;
}

async function createSpace(req, env) {
  let body = {};
  try { body = await req.json(); } catch { }
  const since = Date.now() - DAY;
  const ipHash = await sha256('csm-ip:' + ipKey(req));
  const counts = await env.DB.prepare(
    'SELECT COUNT(*) AS total, SUM(ipHash = ?) AS mine FROM csm_spaces WHERE createdAt > ?',
  ).bind(ipHash, since).first();
  if ((counts.mine || 0) >= PER_IP_PER_DAY || (counts.total || 0) >= PER_DAY) {
    return json({ error: 'trop de codes créés aujourd’hui, réessaie demain' }, 429);
  }
  if (typeof body?.auth === 'string') {
    if (!HEX64.test(body.auth)) return json({ error: 'bad auth' }, 400);
    const out = await env.DB.prepare('INSERT INTO csm_spaces (space, createdAt, ipHash) VALUES (?, ?, ?) ON CONFLICT(space) DO NOTHING')
      .bind(body.auth, Date.now(), ipHash).run();
    return out.meta?.changes ? json({ ok: true }) : json({ error: 'espace déjà existant' }, 409);
  }
  // création d'un code par le serveur (applis < 3.8) : retirée, le serveur ne doit jamais connaître le code
  return json({ error: 'mets à jour Claude Sessions (3.8 ou plus récent) pour créer un code' }, 410);
}

// Rattache une clé d'accès (empreinte) à l'espace d'un code créé avant la 3.8, sur preuve de l'ancien accès.
async function linkSpace(req, env) {
  const space = await spaceOf(req, env);
  if (!space) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!HEX64.test(body?.auth || '')) return json({ error: 'bad auth' }, 400);
  await env.DB.prepare('INSERT INTO csm_auth (auth, space) VALUES (?, ?) ON CONFLICT(auth) DO NOTHING').bind(body.auth, space).run();
  return json({ ok: true });
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
    if (url.pathname === '/spaces/link') return req.method === 'POST' ? linkSpace(req, env) : json({ error: 'method not allowed' }, 405);
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
      // page pleine : le curseur s'arrête à la dernière ligne lue, la suite viendra au prochain appel
      const rev = results.length === 1000 ? results[results.length - 1].rev : await currentRev(env, space);
      return json({ rev, items: results.map(r => ({ ...r, data: JSON.parse(r.data), deleted: !!r.deleted })) });
    }

    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const items = Array.isArray(body?.items) ? body.items.slice(0, 500) : [];
      const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM csm_sessions WHERE space = ?').bind(space).first();
      if (count.c + items.length > ROWS_MAX) {
        // au-delà : seules les mises à jour de lignes existantes passent
        const known = new Set((await env.DB.prepare('SELECT uid FROM csm_sessions WHERE space = ?').bind(space).all()).results.map(r => r.uid));
        const fresh = new Set(items.map(it => it?.uid).filter(u => typeof u === 'string' && !known.has(u)));
        if (count.c + fresh.size > ROWS_MAX) return json({ error: 'space full' }, 413);
      }
      const next = '(SELECT COALESCE(MAX(rev), 0) + 1 FROM csm_sessions WHERE space = ?1)';
      const stmts = [], gone = [];
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
        if (it.deleted) gone.push(it.uid);
      }
      const out = stmts.length ? (await env.DB.batch(stmts)).slice(0, stmts.length) : [];
      // conversation d'une session supprimée : liste, morceaux (R2) et place occupée libérés
      for (const u of gone) {
        const parts = (await env.DB.prepare('SELECT space, uid, ver, n, size FROM csm_parts WHERE space = ? AND uid = ?').bind(space, u).all()).results;
        await env.DB.prepare('DELETE FROM csm_transcripts WHERE space = ? AND uid = ?').bind(space, u).run();
        await dropParts(env, parts);
      }
      return json({ rev: await currentRev(env, space), applied: out.filter(r => r.meta?.changes).length });
    }
    return json({ error: 'method not allowed' }, 405);
  },

  // Ménage quotidien : morceaux jamais validés (envoi interrompu, plus d'une heure), puis recalcul de la place
  // occupée. Par lots (suppressions groupées) pour rester sous la limite d'appels d'une exécution.
  async scheduled(event, env) {
    for (let round = 0; round < 10; round++) {
      const stale = (await env.DB.prepare('SELECT space, uid, ver, n, size FROM csm_parts WHERE ok = 0 AND at < ? LIMIT 1000')
        .bind(Date.now() - 3600e3).all()).results;
      await dropParts(env, stale);
      if (stale.length < 1000) break;
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE csm_usage SET bytes = (SELECT COALESCE(SUM(size), 0) FROM csm_parts WHERE csm_parts.space = csm_usage.space)'),
      env.DB.prepare('INSERT INTO csm_usage (space, bytes) SELECT space, SUM(size) FROM csm_parts GROUP BY space ON CONFLICT(space) DO NOTHING'),
    ]);
  },
};
