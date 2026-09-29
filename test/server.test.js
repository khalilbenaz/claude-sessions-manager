'use strict';
// Tests de bout en bout du serveur avec un faux claude (aucun appel à l'API, profil utilisateur temporaire).
// Lancer : npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = 17000 + Math.floor(Math.random() * 2000);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-test-'));
const HOME = path.join(TMP, 'home'), DATA = path.join(TMP, 'data'), WORK = path.join(TMP, 'work');
for (const d of [HOME, DATA, WORK]) fs.mkdirSync(d, { recursive: true });
const ENV = {
  ...process.env, CSM_PORT: String(PORT), CSM_DATA: DATA, HOME, USERPROFILE: HOME,
  CSM_SYNC_INTERVAL: '700', CSM_SYNC_DELAY: '300',
  CSM_CLAUDE: process.execPath, CSM_CLAUDE_ARGS: `"${path.join(__dirname, 'fake-claude.js')}"`,
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
};
for (const k of Object.keys(ENV)) if (/^(CLAUDECODE|CLAUDE_CODE_)/.test(k)) delete ENV[k];

let server = null, token = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(method, p, body, { raw, headers = {}, host } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : raw ? body : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { Host: host || `127.0.0.1:${PORT}`, 'X-CSM-Token': token, 'Content-Type': 'application/json', ...headers } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { } resolve({ status: res.statusCode, body: j, text: b }); });
    });
    r.on('error', e => reject(new Error(`${method} ${p} : ${e.message}`)));
    if (data) r.write(data); r.end();
  });
}
const api = async (m, p, b, o) => { const r = await req(m, p, b, o); if (r.status >= 400) throw new Error(`${m} ${p} → ${r.status} ${r.text}`); return r.body; };

async function waitFor(fn, ms = 15000, what = 'condition') {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(150); }
  throw new Error(`délai dépassé : ${what} (${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: ENV, stdio: 'ignore' });
  return waitFor(async () => (await req('GET', '/')).status === 200, 15000, 'démarrage du serveur')
    .then(() => { token = fs.readFileSync(path.join(DATA, 'token'), 'utf8').trim(); });
}
async function stopServer() {
  if (!server) return;
  const p = server; server = null;
  // SIGTERM (ou kill sous Windows) ; le serveur persiste l'état à chaque changement
  p.kill('SIGTERM');
  await waitFor(async () => { try { await req('GET', '/'); return false; } catch { return true; } }, 10000, 'arrêt du serveur');
}

function wsClient() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`, { headers: { Host: `127.0.0.1:${PORT}` } });
  const out = {};
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'out' || m.t === 'replay') out[m.id] = (out[m.id] || '') + m.d; });
  return new Promise(r => ws.on('open', () => r({ ws, out, input: (id, d) => ws.send(JSON.stringify({ t: 'input', id, d })) })));
}
const session = async id => (await api('GET', '/api/sessions')).find(s => s.id === id);
const idle = id => waitFor(async () => { const s = await session(id); return s && s.status === 'idle' && s.claudeSessionId ? s : null; }, 15000, 'session prête');

before(startServer);
after(async () => {
  await stopServer();
  // Windows : un faux claude qui finit de s'arrêter garde son dossier ouvert (EBUSY) — nettoyage tolérant,
  // un échec ici ne doit pas faire échouer la suite (le dossier est dans le répertoire temporaire).
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch (e) { console.warn('nettoyage incomplet :', e.code); }
});

test('sécurité : jeton et en-tête Host exigés', async () => {
  assert.equal((await req('GET', '/api/sessions', undefined, { headers: { 'X-CSM-Token': 'mauvais' } })).status, 401);
  assert.equal((await req('GET', '/', undefined, { host: 'evil.example:80' })).status, 403);
  const page = await req('GET', '/');
  assert.match(page.text, /name="csm-token"/);
  assert.equal((await api('GET', '/api/version')).version, require('../package.json').version);
});

let S; // session principale
test('session : démarrage, hooks, échange, état', async () => {
  S = await api('POST', '/api/sessions', { cwd: WORK, name: 'test' });
  const s = await idle(S.id);
  assert.ok(s.claudeSessionId, 'session_id capté par le hook SessionStart');
  const c = await wsClient();
  c.input(S.id, 'bonjour\r');
  await waitFor(() => (c.out[S.id] || '').includes('echo: bonjour'), 10000, 'réponse');
  await waitFor(async () => (await session(S.id)).message === 'terminé', 10000, 'état « terminé »');
  c.ws.close();
});

test('interruption (Ctrl+C) : la session repasse à « prêt » sans hook Stop', async () => {
  const c = await wsClient();
  c.input(S.id, 'réponse longue\r');
  await waitFor(async () => (await session(S.id)).status === 'working', 10000, 'état « travaille »');
  await waitFor(() => (c.out[S.id] || '').includes('réfléchit'), 10000, 'réponse en cours');
  c.input(S.id, '\x03');
  const s = await waitFor(async () => { const x = await session(S.id); return x.status === 'idle' ? x : null; }, 10000, 'état « prêt » après Ctrl+C');
  assert.equal(s.message, 'interrompu');
  c.ws.close();
});

test('attente de permission : consulter la session ne la marque pas « prête »', async () => {
  const c = await wsClient();
  c.input(S.id, 'demande une permission\r');
  await waitFor(async () => (await session(S.id)).status === 'attention', 10000, 'état « attention »');
  await api('POST', `/api/sessions/${S.id}/seen`);
  assert.equal((await session(S.id)).status, 'attention');
  c.input(S.id, '\r');
  await waitFor(async () => (await session(S.id)).message === 'terminé', 10000, 'état « terminé » après réponse');
  c.ws.close();
});

test('renommage : nom écrit dans le transcript et visible dans l’historique', async () => {
  await api('POST', `/api/sessions/${S.id}/rename`, { name: 'Été ✓' });
  const h = await api('GET', '/api/history');
  const s = await session(S.id);
  assert.equal(h.find(x => x.id === s.claudeSessionId)?.title, 'Été ✓');
});

test('fichiers : dépôt d’image', async () => {
  const r = await req('POST', '/api/upload', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { raw: true, headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent('capture écran.png') } });
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(r.body.path));
  assert.doesNotMatch(r.body.path, /\s/, 'chemin sans espace (détection par Claude)');
});

test('file d’attente : prompts envoyés un par un quand la session a fini', async () => {
  const c = await wsClient();
  await api('PUT', `/api/sessions/${S.id}/queue`, [{ text: 'premier' }, { text: 'second' }]);
  await waitFor(() => (c.out[S.id] || '').includes('echo: second'), 15000, 'deux prompts traités');
  assert.ok(c.out[S.id].indexOf('echo: premier') < c.out[S.id].indexOf('echo: second'));
  assert.equal((await session(S.id)).queue, undefined);
  c.ws.close();
});

test('consommation, chronologie, export', async () => {
  const u = await api('GET', `/api/sessions/${S.id}/usage`);
  assert.ok(u.total.out > 0 && u.total.cost > 0);
  const tl = await api('GET', `/api/sessions/${S.id}/timeline`);
  assert.ok(tl.some(t => t.name === 'Read'));
  const s = await session(S.id);
  const ex = await api('GET', `/api/history/${s.claudeSessionId}/export`);
  assert.match(ex.markdown, /echo: bonjour/);
  const g = await api('GET', '/api/usage');
  assert.ok(g.d7.out > 0);
});

test('réglages : validation des valeurs', async () => {
  const r = await api('PUT', '/api/settings', { theme: 'light', fontSize: 16, sound: 'n’importe', inconnu: 1 });
  assert.equal(r.theme, 'light'); assert.equal(r.fontSize, 16); assert.equal(r.sound, 'off', 'valeur invalide → défaut (son coupé)'); assert.equal(r.inconnu, undefined);
  await api('PUT', '/api/templates', [{ name: 'Mon modèle', cwd: WORK, model: 'opus', prompt: 'salut' }]);
  assert.equal((await api('GET', '/api/templates'))[0].name, 'Mon modèle');
});

test('réglages : son coupé une fois pour les installations existantes (3.4.0)', async () => {
  await stopServer();
  const f = path.join(DATA, 'settings.json');
  const cur = JSON.parse(fs.readFileSync(f, 'utf8')); delete cur.soundOffMigrated; cur.sound = 'soft';
  fs.writeFileSync(f, JSON.stringify(cur));
  await startServer();
  assert.equal((await api('GET', '/api/settings')).sound, 'off', 'ancienne installation : son coupé');
  await api('PUT', '/api/settings', { sound: 'soft' });
  await stopServer(); await startServer();
  assert.equal((await api('GET', '/api/settings')).sound, 'soft', 'rallumé ensuite : choix respecté');
  await api('PUT', '/api/settings', { sound: 'off' });
});

test('prompts de départ au premier lancement', async () => {
  const p = await api('GET', '/api/prompts');
  assert.ok(p.length >= 5 && p.some(x => x.title === 'Relire les modifications'));
  await api('PUT', '/api/prompts', []); // vidée volontairement : reste vide
  assert.equal((await api('GET', '/api/prompts')).length, 0);
});

test('accès depuis l’app Claude (Remote Control)', async () => {
  const c = await wsClient();
  const R = await api('POST', '/api/sessions', { cwd: WORK, name: 'mobile', remote: true });
  await waitFor(() => (c.out[R.id] || '').includes('REMOTE:mobile'), 10000, '--remote-control transmis');
  await idle(R.id);
  const v = await api('POST', `/api/sessions/${R.id}/remote`, { on: false });
  assert.equal(v.remote, false);
  await waitFor(() => (c.out[R.id] || '').includes('echo: /remote-control'), 10000, '/remote-control envoyé');
  await api('DELETE', `/api/sessions/${R.id}`);
  c.ws.close();
});

test('ramener une session de terminal : le modèle de la conversation est conservé', async () => {
  // conversation « sonnet » ouverte dans un terminal (registre ~/.claude/sessions/<pid>.json)
  const id = '11111111-2222-4333-8444-555555555555';
  const proj = path.join(HOME, '.claude', 'projects', 'terminal');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${id}.jsonl`), [
    { type: 'user', cwd: WORK, sessionId: id, message: { role: 'user', content: 'bonjour depuis le terminal' } },
    { type: 'assistant', cwd: WORK, sessionId: id, message: { id: 'm1', model: 'claude-sonnet-4-5', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  ].map(o => JSON.stringify(o)).join('\n') + '\n');
  const reg = path.join(HOME, '.claude', 'sessions');
  fs.mkdirSync(reg, { recursive: true });
  fs.writeFileSync(path.join(reg, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: id, cwd: WORK, kind: 'interactive', entrypoint: 'cli', status: 'idle', startedAt: Date.now() }));
  const ext = (await api('GET', '/api/external')).find(x => x.sessionId === id);
  assert.ok(ext, 'session de terminal détectée');
  const r = await api('POST', '/api/import', { mode: 'copy', items: [ext] }); // « Copier » : le processus du terminal n'est pas arrêté
  assert.equal(r.errors.length, 0);
  assert.match(r.done[0].args, /--model claude-sonnet-4-5/);
  fs.rmSync(path.join(reg, `${process.pid}.json`));
  await api('DELETE', `/api/sessions/${r.done[0].id}`);
});

test('groupes et épinglage', async () => {
  const v = await api('POST', `/api/sessions/${S.id}/meta`, { group: 'Projet A', pinned: true, color: '#ff8800' });
  assert.equal(v.group, 'Projet A'); assert.equal(v.pinned, true);
});

test('restauration après redémarrage du serveur', async () => {
  const before = await session(S.id);
  await stopServer();
  await startServer();
  const s = await waitFor(async () => { const x = await session(S.id); return x && x.alive && x.status === 'idle' ? x : null; }, 20000, 'session restaurée');
  assert.equal(s.claudeSessionId, before.claudeSessionId);
  assert.equal(s.group, 'Projet A', 'métadonnées conservées');
});

test('worktree : création, modifications, commit, fusion, suppression', async () => {
  const repo = path.join(TMP, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo, env: ENV, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'README.md'), 'départ\n'); g('add', '.'); g('commit', '-qm', 'init');

  const sug = await api('GET', `/api/git/suggest-branch?cwd=${encodeURIComponent(repo)}&name=${encodeURIComponent('Ma tâche')}`);
  assert.equal(sug.branch, 'csm/ma-tache');
  const W = await api('POST', '/api/worktree/session', { cwd: repo, branch: sug.branch, name: 'wt' });
  assert.ok(W.worktree && fs.existsSync(W.worktree.path));
  await idle(W.id);

  const c = await wsClient();
  c.input(W.id, 'touch nouveau.txt\r');
  const st = await waitFor(async () => { const r = await api('GET', `/api/sessions/${W.id}/git`); return r.files.length ? r : null; }, 10000, 'fichier modifié détecté');
  assert.equal(st.branch, sug.branch);
  assert.equal(st.files[0].path, 'nouveau.txt');
  const d = await api('GET', `/api/sessions/${W.id}/git/diff?path=nouveau.txt`);
  assert.match(d.diff, /créé par le faux claude/);
  // hors dépôt : refusé
  assert.equal((await req('GET', `/api/sessions/${W.id}/git/diff?path=${encodeURIComponent('../../x')}`)).status, 500);

  const refused = await req('POST', `/api/sessions/${W.id}/worktree/merge`, {});
  assert.equal(refused.status, 400, 'fusion refusée tant que non commité');
  await api('POST', `/api/sessions/${W.id}/git/commit`, { message: 'Ajoute nouveau.txt', all: true });
  await api('POST', `/api/sessions/${W.id}/worktree/merge`, {});
  assert.ok(fs.existsSync(path.join(repo, 'nouveau.txt')), 'fusionné dans main');
  await api('POST', `/api/sessions/${W.id}/worktree/remove`, { deleteBranch: true });
  assert.ok(!fs.existsSync(W.worktree.path));
  c.ws.close();
});

test('verrouillage par mot de passe : appliqué côté serveur', async () => {
  const L = await api('POST', '/api/sessions', { cwd: WORK, name: 'secrète' });
  const ready = await idle(L.id);
  const c0 = await wsClient(); // un premier échange : la conversation a un transcript (historique)
  c0.input(L.id, 'avant le verrou\r');
  await waitFor(() => (c0.out[L.id] || '').includes('echo: avant le verrou'), 8000, 'premier échange');
  c0.ws.close();
  const v = await api('POST', `/api/sessions/${L.id}/lock`, { password: 'correct-horse', hint: 'cheval' });
  assert.equal(v.locked, true); assert.equal(v.lockHint, 'cheval'); assert.equal(v.lock, undefined, 'le hash ne sort jamais');
  assert.equal((await req('POST', `/api/sessions/${L.id}/lock`, { password: 'x' })).status, 400, 'trop court');

  // fenêtre non déverrouillée : pas de relecture, pas de sortie, saisie ignorée, routes refusées
  const c = await wsClient();
  await sleep(400);
  assert.equal(c.out[L.id], undefined, 'aucune relecture');
  c.input(L.id, 'ne doit pas passer\r');
  await sleep(1200);
  assert.equal(c.out[L.id], undefined, 'saisie ignorée, aucune sortie');
  for (const [m, p] of [['GET', `/api/sessions/${L.id}/git`], ['GET', `/api/sessions/${L.id}/timeline`], ['POST', `/api/sessions/${L.id}/prompt`], ['DELETE', `/api/sessions/${L.id}`], ['GET', `/api/history/${ready.claudeSessionId}/export`]])
    assert.equal((await req(m, p, m === 'POST' ? { text: 'x' } : undefined)).status, 423, `${m} ${p} refusé`);
  assert.equal((await req('POST', '/api/sessions', { cwd: WORK, resume: ready.claudeSessionId })).status, 423, 'reprise depuis l’historique refusée');
  const h = (await api('GET', '/api/history')).find(x => x.id === ready.claudeSessionId);
  assert.equal(h.locked, true); assert.equal(h.lastPrompt, '');

  // mauvais mot de passe puis bon
  const results = [];
  c.ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'unlock-result') results.push(m); });
  c.ws.send(JSON.stringify({ t: 'unlock', id: L.id, password: 'faux' }));
  await waitFor(() => results.length === 1, 5000, 'refus');
  assert.equal(results[0].ok, false);
  c.ws.send(JSON.stringify({ t: 'unlock', id: L.id, password: 'correct-horse' }));
  await waitFor(() => results.length === 2, 5000, 'déverrouillage');
  assert.equal(results[1].ok, true);
  await waitFor(() => (c.out[L.id] || '').includes('FAUX CLAUDE'), 5000, 'relecture après déverrouillage');
  c.input(L.id, 'maintenant oui\r');
  await waitFor(() => (c.out[L.id] || '').includes('echo: maintenant oui'), 8000, 'saisie acceptée');
  const tk = { headers: { 'X-CSM-Unlock': `${L.id}:${results[1].ticket}` } };
  assert.equal((await req('GET', `/api/sessions/${L.id}/timeline`, undefined, tk)).status, 200, 'ticket accepté');
  assert.equal((await req('GET', `/api/sessions/${L.id}/timeline`, undefined, { headers: { 'X-CSM-Unlock': `${L.id}:inventé` } })).status, 423, 'faux ticket refusé');

  // une autre fenêtre ne profite pas du déverrouillage
  const c2 = await wsClient(); await sleep(400);
  assert.equal(c2.out[L.id], undefined, 'autre fenêtre : toujours verrouillée');
  c2.ws.close();

  // reverrouiller : ticket révoqué
  c.ws.send(JSON.stringify({ t: 'lock', id: L.id })); await sleep(300);
  assert.equal((await req('GET', `/api/sessions/${L.id}/timeline`, undefined, tk)).status, 423, 'ticket révoqué');
  c.ws.close();

  // le verrou survit au redémarrage du serveur
  await stopServer(); await startServer();
  assert.equal((await session(L.id)).locked, true);
  assert.equal((await req('POST', `/api/sessions/${L.id}/unlock-remove`, { password: 'faux' })).status, 403);
  assert.equal((await api('POST', `/api/sessions/${L.id}/unlock-remove`, { password: 'correct-horse' })).locked, undefined);
});

test('diagnostic et journaux', async () => {
  const d = await api('GET', '/api/diag');
  assert.equal(d.claude.ok, true); assert.match(d.claude.version, /faux claude/);
  assert.ok((await api('GET', '/api/logs')).text.includes('Claude Sessions Manager'));
});

// ---------------------------------------------------------------- synchronisation (#27)
// Faux serveur de synchro : même API que sync-worker (un espace par clé d'accès, la modification la plus récente gagne).
// keys : codes dont l'espace accepte la clé d'accès dérivée (espaces 3.8+) ; legacy : codes d'avant la 3.8, acceptés
// seulement en clair, jusqu'au rattachement (POST /spaces/link). bearers : tout ce que l'app a envoyé comme clé.
function fakeSyncServer(keys, legacy = []) {
  const { authKey } = require('../lib/sync');
  const sha = x => require('crypto').createHash('sha256').update(x).digest('hex');
  const spaces = new Map(), txs = new Map(), linked = new Map(), bearers = new Set(); let rev = 0;
  const txOf = k => { if (!txs.has(k)) txs.set(k, { meta: new Map(), chunks: new Map() }); return txs.get(k); };
  const idOf = k => (keys.includes(k) || legacy.includes(k) ? k : 'reg:' + sha(authKey(k))); // code -> espace
  const spaceOf = b => linked.get(sha(b)) || keys.find(k => authKey(k) === b) || (legacy.includes(b) ? b : null);
  const srv = http.createServer((q, r) => {
    const key = (q.headers.authorization || '').replace(/^Bearer /, '');
    if (key) bearers.add(key);
    const send = (code, v) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(v)); };
    const parts = []; q.on('data', c => parts.push(c)); q.on('end', () => {
      const raw = Buffer.concat(parts), b = raw.toString('utf8');
      if (q.method === 'POST' && q.url === '/spaces') {
        const { auth } = JSON.parse(b || '{}');
        if (!/^[0-9a-f]{64}$/.test(auth || '')) return send(400, {});
        linked.set(auth, 'reg:' + auth);
        return send(200, { ok: true });
      }
      if (q.method === 'POST' && q.url === '/spaces/link') {
        if (!legacy.includes(key)) return send(401, {});
        linked.set(JSON.parse(b).auth, key);
        return send(200, { ok: true });
      }
      const sp = spaceOf(key);
      if (!sp) return send(401, { error: 'unauthorized' });
      if (!spaces.has(sp)) spaces.set(sp, new Map());
      const rows = spaces.get(sp);
      const u = new URL(q.url, 'http://x');
      const t = u.pathname.match(/^\/transcripts(?:\/([^/]+)(?:\/([^/]+)\/([^/]+))?)?$/);
      if (t) {
        const T = txOf(sp), [, uid, ver, n] = t;
        if (!uid) return send(200, { items: [...T.meta.entries()].map(([uid, m]) => ({ uid, ...m })) });
        if (n !== undefined && q.method === 'PUT') { T.chunks.set(`${uid}/${ver}/${n}`, raw); return send(200, { ok: true }); }
        if (n !== undefined) {
          const c = T.chunks.get(`${uid}/${ver}/${n}`);
          if (!c) return send(404, {});
          r.writeHead(200, { 'content-type': 'application/octet-stream' }); return r.end(c);
        }
        const m = JSON.parse(b), cur = T.meta.get(uid);
        for (let i = 0; i < m.chunks; i++) if (!T.chunks.has(`${uid}/${m.ver}/${i}`)) return send(409, {});
        if (cur && cur.updatedAt > m.updatedAt) return send(200, { applied: false });
        T.meta.set(uid, m);
        for (const k of [...T.chunks.keys()]) if (k.startsWith(uid + '/') && !k.startsWith(`${uid}/${m.ver}/`)) T.chunks.delete(k);
        return send(200, { applied: true });
      }
      if (q.method === 'GET') {
        const since = Number(u.searchParams.get('since')) || 0;
        return send(200, { rev, items: [...rows.values()].filter(x => x.rev > since).sort((a, b) => a.rev - b.rev) });
      }
      let applied = 0;
      for (const it of JSON.parse(b).items) {
        const cur = rows.get(it.uid);
        if (cur && cur.updatedAt >= it.updatedAt) continue;
        rows.set(it.uid, { ...it, deleted: it.deleted ? 1 : 0, rev: ++rev }); applied++;
        if (it.deleted) { const T = txOf(sp); T.meta.delete(it.uid); for (const k of [...T.chunks.keys()]) if (k.startsWith(it.uid + '/')) T.chunks.delete(k); }
      }
      send(200, { rev, applied });
    });
  });
  const { openJson } = require('../lib/sync');
  const rowsOf = k => spaces.get(idOf(k)) || new Map();
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({
    srv, url: `http://127.0.0.1:${srv.address().port}`, rows: rowsOf, tx: k => txOf(idOf(k)), bearers,
    // contenu en clair d'une ligne (déchiffré avec le code, comme sur une autre machine)
    plain: (k, uid) => { const x = rowsOf(k).get(uid); return x && (x.data?.e ? openJson(k, x.data, `s|${x.uid}|${x.updatedAt}`) : x.data); },
    find: (k, fn) => [...rowsOf(k).values()].find(x => !x.deleted && fn(x.data?.e ? openJson(k, x.data, `s|${x.uid}|${x.updatedAt}`) : x.data)),
    put: (k, it) => { const id = idOf(k); if (!spaces.has(id)) spaces.set(id, new Map()); spaces.get(id).set(it.uid, { deleted: 0, origin: 'pc', ...it, rev: ++rev }); },
  })));
}
// Ligne chiffrée comme par une autre machine
const sealed = (k, uid, updatedAt, obj) => require('../lib/sync').sealJson(k, obj, `s|${uid}|${updatedAt}`);

test('synchro : désactivée par défaut, isolée par code', async () => {
  const st = await api('GET', '/api/sync');
  assert.equal(st.enabled, false, 'aucune synchro sans code');
  await api('PUT', '/api/settings', { syncCode: 'n-importe-quoi' });
  assert.equal((await api('GET', '/api/sync')).invalid, true);
  await api('PUT', '/api/settings', { syncCode: '' });
});

test('synchro : code créé par le serveur, puis saisi sur une autre machine', async () => {
  const fake = await fakeSyncServer([]);
  try {
    await api('PUT', '/api/settings', { syncServer: fake.url });
    const { code } = await api('POST', '/api/sync/code');
    assert.match(code, /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/);
    await api('PUT', '/api/settings', { syncCode: code });
    const st = await api('POST', '/api/sync/now');
    assert.equal(st.enabled, true); assert.equal(st.code, code); assert.equal(st.lastError, '');
    const key = code.replace(/-/g, '');
    await api('POST', '/api/sessions', { cwd: WORK, name: 'via-code-court' });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.find(key, d => d.name === 'via-code-court'); }, 10000, 'session envoyée');
    assert.ok(!fake.bearers.has(key), 'le code ne quitte jamais la machine');
    assert.ok(!JSON.stringify([...fake.rows(key).values()]).includes('via-code-court'), 'sessions chiffrées sur le serveur');

    // « J'ai déjà un code » : minuscules et espaces acceptés, même espace
    await api('PUT', '/api/settings', { syncCode: ' ' + code.toLowerCase().replace(/-/g, ' ') });
    const again = await api('POST', '/api/sync/now');
    assert.equal(again.code, code); assert.equal(again.lastError, '');
    // code inventé : refusé par le serveur
    await api('PUT', '/api/settings', { syncCode: 'ABCD-EFGH-JKMN-PQRS-TVWX' });
    assert.match((await api('POST', '/api/sync/now')).lastError, /refusé/);
  } finally {
    for (const s of await api('GET', '/api/sessions')) if (s.name === 'via-code-court') await api('DELETE', `/api/sessions/${s.id}`);
    await api('PUT', '/api/settings', { syncCode: '', syncServer: '' });
    fake.srv.close();
  }
});

test('synchro : envoi, session distante arrêtée, renommage, suppressions', async () => {
  const { encodeCode } = require('../lib/sync');
  const KEY = 'k'.repeat(32), OTHER = 'o'.repeat(32);
  const fake = await fakeSyncServer([KEY, OTHER]);
  try {
    // clé inconnue du serveur : erreur visible, rien d'envoyé
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, 'x'.repeat(32)), syncMachine: 'mac-test' });
    assert.match((await api('POST', '/api/sync/now')).lastError, /refusé/);

    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY) });
    const local = await api('POST', '/api/sessions', { cwd: WORK, name: 'locale-synchro' });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.find(KEY, d => d.name === 'locale-synchro'); }, 10000, 'session locale envoyée');
    assert.equal(fake.rows(OTHER).size, 0, 'un autre code ne voit rien');
    const mine = fake.find(KEY, d => d.name === 'locale-synchro');
    assert.equal(mine.origin, 'mac-test');
    assert.ok(!('claudeSessionId' in fake.plain(KEY, mine.uid)), 'l’identifiant de conversation ne part pas avec la session');

    // session créée sur une autre machine : ajoutée arrêtée, dossier traduit
    fs.mkdirSync(path.join(HOME, 'proj'), { recursive: true });
    fake.put(KEY, { uid: 'pc-session-1', updatedAt: Date.now(), origin: 'pc-bureau', data: { name: 'depuis-pc', cwd: '{home}/proj', args: '--model sonnet --dangerously-skip-permissions --settings {"hooks":{}} --permission-mode bypassPermissions', group: 'Clients', color: 'red;}' } });
    const remote = await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/sessions')).find(s => s.syncId === 'pc-session-1'); }, 10000, 'session distante reçue');
    assert.equal(remote.status, 'exited'); assert.equal(remote.alive, false);
    assert.equal(fs.realpathSync(remote.cwd), fs.realpathSync(path.join(HOME, 'proj')));
    assert.equal(remote.args, '--model sonnet', 'arguments dangereux écartés'); assert.equal(remote.group, 'Clients'); assert.equal(remote.origin, 'pc-bureau');
    assert.equal(remote.color, undefined, 'couleur invalide écartée');
    assert.equal(remote.claudeSessionId, null);

    // renommée ici : renvoyée au serveur, sans écho
    await api('POST', `/api/sessions/${remote.id}/rename`, { name: 'renommée-sur-mac' });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.plain(KEY, 'pc-session-1').name === 'renommée-sur-mac'; }, 10000, 'renommage envoyé');
    assert.equal(fake.plain(KEY, 'pc-session-1').cwd, '{home}/proj', 'dossier portable conservé');

    // supprimée ailleurs : retirée ici (arrêtée)
    fake.put(KEY, { uid: 'pc-session-1', updatedAt: Date.now() + 5000, deleted: 1, data: {} });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return !(await session(remote.id)); }, 10000, 'suppression distante appliquée');

    // supprimée ici : pierre tombale envoyée
    await api('DELETE', `/api/sessions/${local.id}`);
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.rows(KEY).get(mine.uid).deleted === 1; }, 10000, 'suppression locale envoyée');
  } finally {
    await api('PUT', '/api/settings', { syncCode: '' });
    fake.srv.close();
  }
});

test('synchro : la conversation suit la session d’une machine à l’autre, chiffrée', async () => {
  const { encodeCode, seal, unseal, txVersion } = require('../lib/sync');
  const KEY = 'c'.repeat(32);
  const aad = (uid, m) => `t|${uid}|${m.cid}|${m.ver}|${m.updatedAt}`;
  const fake = await fakeSyncServer([KEY]);
  const c = await wsClient();
  const projFile = (cwd, cid) => path.join(HOME, '.claude', 'projects', fs.realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, '-'), cid + '.jsonl');
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'win-test' });
    // conversation créée ici : envoyée chiffrée
    const local = await api('POST', '/api/sessions', { cwd: WORK, name: 'conv-locale' });
    await waitFor(async () => (await session(local.id)).status === 'idle', 15000, 'session prête');
    c.ws.send(JSON.stringify({ t: 'input', id: local.id, d: 'secret-du-mac\r' }));
    await waitFor(() => (c.out[local.id] || '').includes('echo: secret-du-mac'), 15000, 'réponse');
    const cidLocal = (await session(local.id)).claudeSessionId;
    assert.ok(fs.existsSync(projFile(WORK, cidLocal)), 'transcript écrit');
    const uid = await waitFor(async () => { await api('POST', '/api/sync/now'); return (await session(local.id)).syncId; }, 10000, 'identifiant de synchro');
    const meta = await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.tx(KEY).meta.get(uid); }, 15000, 'conversation envoyée');
    assert.equal(meta.origin, 'win-test'); assert.equal(meta.cid, cidLocal);
    const blob = Buffer.concat([...Array(meta.chunks).keys()].map(i => fake.tx(KEY).chunks.get(`${uid}/${meta.ver}/${i}`)));
    assert.ok(!blob.includes('secret-du-mac'), 'le serveur ne voit pas la conversation en clair');
    assert.match(unseal(KEY, blob, aad(uid, meta)).toString('utf8'), /secret-du-mac/);

    // conversation venue d'une autre machine : téléchargée, puis « Reprendre » la continue
    fs.mkdirSync(path.join(HOME, 'proj2'), { recursive: true });
    const cid = '11111111-2222-3333-4444-555555555555';
    const raw = Buffer.from(JSON.stringify({ type: 'user', message: { role: 'user', content: 'question posée sur le PC' }, sessionId: cid, cwd: 'C:/autre' }) + '\n');
    const ver = txVersion(KEY, raw), m1 = { cid, ver, chunks: 1, updatedAt: Date.now(), origin: 'pc-bureau' };
    const blob1 = seal(KEY, raw, aad('pc-conv-1', m1));
    fake.tx(KEY).chunks.set(`pc-conv-1/${ver}/0`, blob1);
    fake.tx(KEY).meta.set('pc-conv-1', { ...m1, size: blob1.length });
    fake.put(KEY, { uid: 'pc-conv-1', updatedAt: Date.now(), origin: 'pc-bureau', data: { name: 'conv-pc', cwd: '{home}/proj2' } });
    const remote = await waitFor(async () => { await api('POST', '/api/sync/now'); const x = (await api('GET', '/api/sessions')).find(s => s.syncId === 'pc-conv-1'); return x?.claudeSessionId && x; }, 15000, 'conversation distante reçue');
    assert.equal(remote.claudeSessionId, cid);
    const file = projFile(remote.cwd, cid);
    assert.equal(fs.readFileSync(file, 'utf8'), raw.toString('utf8'));
    // modifiée à nouveau sur le PC pendant que la session est arrêtée ici : « Reprendre » prend la dernière version
    const raw2 = Buffer.concat([raw, Buffer.from(JSON.stringify({ type: 'user', message: { role: 'user', content: 'suite sur le PC' }, sessionId: cid }) + '\n')]);
    const ver2 = txVersion(KEY, raw2), m2 = { cid, ver: ver2, chunks: 1, updatedAt: Date.now() + 1000, origin: 'pc-bureau' };
    const blob2 = seal(KEY, raw2, aad('pc-conv-1', m2));
    fake.tx(KEY).chunks.set(`pc-conv-1/${ver2}/0`, blob2);
    fake.tx(KEY).meta.set('pc-conv-1', { ...m2, size: blob2.length });
    await api('POST', `/api/sessions/${remote.id}/restart`);
    assert.match(fs.readFileSync(file, 'utf8'), /suite sur le PC/);
    await waitFor(() => (c.out[remote.id] || '').includes('reprise ' + cid.slice(0, 8)), 15000, 'claude relancé avec --resume');
    // la suite écrite ici repart vers le serveur
    await waitFor(async () => (await session(remote.id)).status === 'idle', 15000, 'reprise prête');
    await sleep(1200); // mtime local > updatedAt distant (horodaté dans le futur ci-dessus)
    c.ws.send(JSON.stringify({ t: 'input', id: remote.id, d: 'reponse-du-windows\r' }));
    await waitFor(async () => { await api('POST', '/api/sync/now'); const m = fake.tx(KEY).meta.get('pc-conv-1'); return m.origin === 'win-test' && m.ver !== ver2; }, 15000, 'suite envoyée');
    const m = fake.tx(KEY).meta.get('pc-conv-1');
    assert.match(unseal(KEY, fake.tx(KEY).chunks.get(`pc-conv-1/${m.ver}/0`), aad('pc-conv-1', m)).toString('utf8'), /suite sur le PC[\s\S]*reponse-du-windows/);

    // session supprimée : sa conversation disparaît du serveur
    await api('DELETE', `/api/sessions/${local.id}`);
    await waitFor(async () => { await api('POST', '/api/sync/now'); return !fake.tx(KEY).meta.has(uid); }, 10000, 'conversation effacée du serveur');
    await api('DELETE', `/api/sessions/${remote.id}`);
  } finally {
    c.ws.close();
    await api('PUT', '/api/settings', { syncCode: '' });
    fake.srv.close();
  }
});

test('synchro : liste des groupes, modèles de session, déplacement entre groupes, options', async () => {
  const { encodeCode, seal, unseal } = require('../lib/sync');
  const KEY = 'g'.repeat(32);
  const fake = await fakeSyncServer([KEY]);
  const dec = row => fake.plain(KEY, row.uid);
  try {
    // l'autre machine a déjà des groupes et un modèle ; ici un groupe local : réunion à la première synchro
    await api('PUT', '/api/settings', { groupList: 'Local', syncGroups: true, syncTemplates: true });
    fs.mkdirSync(path.join(HOME, 'tplproj'), { recursive: true });
    const t0 = Date.now();
    fake.put(KEY, { uid: 'csmcfg-groups', updatedAt: t0, origin: 'mac', data: sealed(KEY, 'csmcfg-groups', t0, { list: ['Clients', 'Perso'] }) });
    fake.put(KEY, { uid: 'csmtpl-mactpl1', updatedAt: t0, origin: 'mac', data: sealed(KEY, 'csmtpl-mactpl1', t0, { id: 'mactpl1', name: 'Revue', cwd: '{home}/tplproj', model: 'sonnet', mode: '', extra: '', worktree: false, prompt: 'relis', group: 'Clients' }) });
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'pc-test' });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/settings')).groupList === 'Clients\nPerso\nLocal'; }, 10000, 'groupes réunis');
    const tpl = await waitFor(async () => (await api('GET', '/api/templates')).find(t => t.id === 'mactpl1'), 10000, 'modèle reçu');
    assert.equal(fs.realpathSync(tpl.cwd), fs.realpathSync(path.join(HOME, 'tplproj')), 'dossier du modèle traduit');
    await waitFor(async () => { await api('POST', '/api/sync/now'); const g = fake.rows(KEY).get('csmcfg-groups'); return g && dec(g).list.join() === 'Clients,Perso,Local'; }, 10000, 'réunion renvoyée');

    // modèle créé ici : envoyé chiffré ; supprimé ici : pierre tombale
    await api('PUT', '/api/templates', [...await api('GET', '/api/templates'), { id: 'pctpl22', name: 'Secret', cwd: WORK, prompt: 'prompt-confidentiel' }]);
    const row = await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.rows(KEY).get('csmtpl-pctpl22'); }, 10000, 'modèle envoyé');
    assert.ok(!JSON.stringify(row.data).includes('prompt-confidentiel'), 'modèle chiffré');
    assert.equal(dec(row).prompt, 'prompt-confidentiel');

    // session déplacée de groupe sur l'autre machine : suivie ici
    const s = await api('POST', '/api/sessions', { cwd: WORK, name: 'a-deplacer', group: 'Clients' });
    const uid = await waitFor(async () => { await api('POST', '/api/sync/now'); return (await session(s.id)).syncId; }, 10000, 'session envoyée');
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.plain(KEY, uid)?.group === 'Clients'; }, 10000, 'groupe envoyé');
    const t1 = Date.now() + 1000;
    fake.put(KEY, { uid, updatedAt: t1, origin: 'mac', data: sealed(KEY, uid, t1, { ...fake.plain(KEY, uid), group: 'Perso' }) });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return (await session(s.id)).group === 'Perso'; }, 10000, 'déplacement reçu');

    // option désactivée : les modèles distants sont ignorés, puis appliqués quand elle est réactivée
    await api('PUT', '/api/settings', { syncTemplates: false });
    const t2 = Date.now();
    fake.put(KEY, { uid: 'csmtpl-mactpl2', updatedAt: t2, origin: 'mac', data: sealed(KEY, 'csmtpl-mactpl2', t2, { id: 'mactpl2', name: 'Plus tard', cwd: '', prompt: '' }) });
    await api('POST', '/api/sync/now'); await api('POST', '/api/sync/now');
    assert.ok(!(await api('GET', '/api/templates')).some(t => t.id === 'mactpl2'), 'ignoré quand désactivé');
    await api('PUT', '/api/templates', (await api('GET', '/api/templates')).filter(t => t.id !== 'pctpl22'));
    await api('POST', '/api/sync/now');
    assert.equal(fake.rows(KEY).get('csmtpl-pctpl22').deleted, 0, 'rien envoyé quand désactivé');
    await api('PUT', '/api/settings', { syncTemplates: true });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/templates')).some(t => t.id === 'mactpl2'); }, 10000, 'appliqué après réactivation');
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.rows(KEY).get('csmtpl-pctpl22').deleted === 1; }, 10000, 'suppression envoyée après réactivation');
    await api('DELETE', `/api/sessions/${s.id}`);
  } finally {
    await api('PUT', '/api/settings', { syncCode: '', groupList: '' });
    await api('PUT', '/api/templates', []);
    fake.srv.close();
  }
});

test('sécurité : jeton des hooks limité, conversation verrouillée non reprenable, essais limités', async () => {
  // le jeton donné aux sessions (hérité par tout ce que Claude exécute) n'ouvre que /api/hook
  const S = await api('POST', '/api/sessions', { cwd: WORK, name: 'jeton' });
  await idle(S.id);
  const c = await wsClient();
  c.input(S.id, 'montre-jeton\r');
  const hookTk = (await waitFor(() => (c.out[S.id] || '').match(/JETON:(\w+)/), 8000, 'jeton de la session'))[1];
  assert.notEqual(hookTk, token, 'pas le jeton complet');
  assert.equal((await req('GET', '/api/sessions', undefined, { headers: { 'X-CSM-Token': hookTk } })).status, 401, 'jeton des hooks refusé hors /api/hook');
  assert.equal((await req('POST', '/api/sessions', { cwd: WORK, args: '--dangerously-skip-permissions' }, { headers: { 'X-CSM-Token': hookTk } })).status, 401);
  await waitFor(async () => (await session(S.id)).status === 'idle', 8000, 'hooks toujours reçus'); // le hook Stop passe avec ce jeton
  assert.equal((await req('GET', '/api/sessions', undefined, { headers: { 'X-CSM-Token': 'mauvais' } })).status, 401);

  // conversation d'une session verrouillée : ni son identifiant exposé, ni reprise via --resume / --continue dans les arguments
  await waitFor(async () => (await session(S.id)).claudeSessionId, 8000, 'identifiant de conversation');
  const cid = (await session(S.id)).claudeSessionId;
  await api('POST', `/api/sessions/${S.id}/lock`, { password: 'correct-horse' });
  assert.equal((await session(S.id)).claudeSessionId, null, 'identifiant masqué quand verrouillée');
  assert.equal((await req('POST', '/api/sessions', { cwd: WORK, args: `--resume ${cid}` })).status, 423);
  assert.equal((await req('POST', '/api/sessions', { cwd: WORK, args: `--resume=${cid}` })).status, 423);
  assert.equal((await req('POST', '/api/sessions', { cwd: WORK, args: '--continue' })).status, 423);
  assert.equal((await req('POST', '/api/sessions', { cwd: WORK, resume: cid })).status, 423);

  // mot de passe : 5 essais puis attente, aussi par HTTP
  for (let i = 0; i < 5; i++) assert.equal((await req('POST', `/api/sessions/${S.id}/unlock-remove`, { password: 'faux' + i })).status, 403);
  const r = await req('POST', `/api/sessions/${S.id}/unlock-remove`, { password: 'correct-horse' });
  assert.equal(r.status, 429, 'bloqué après 5 essais, même avec le bon mot de passe');
  c.ws.close();
  // nettoyage : la session reste verrouillée ; on la ferme via le déverrouillage WebSocket impossible ici → suppression directe du fichier non nécessaire
});

test('synchro : ancien espace (code connu du serveur) rattaché une fois à la clé d’accès', async () => {
  const { encodeCode } = require('../lib/sync');
  const OLD = 'l'.repeat(32);
  const fake = await fakeSyncServer([], [OLD]);
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, OLD) });
    const st = await api('POST', '/api/sync/now');
    assert.equal(st.lastError, '', 'rattachement réussi');
    fake.bearers.clear();
    await api('POST', '/api/sync/now');
    assert.ok(![...fake.bearers].includes(OLD), 'le code n’est plus envoyé ensuite');
  } finally {
    await api('PUT', '/api/settings', { syncCode: '' });
    fake.srv.close();
  }
});
