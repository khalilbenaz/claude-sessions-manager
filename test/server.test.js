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
    r.on('error', reject);
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
after(async () => { await stopServer(); fs.rmSync(TMP, { recursive: true, force: true }); });

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
  assert.equal(r.theme, 'light'); assert.equal(r.fontSize, 16); assert.equal(r.sound, 'soft'); assert.equal(r.inconnu, undefined);
  await api('PUT', '/api/templates', [{ name: 'Mon modèle', cwd: WORK, model: 'opus', prompt: 'salut' }]);
  assert.equal((await api('GET', '/api/templates'))[0].name, 'Mon modèle');
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

test('diagnostic et journaux', async () => {
  const d = await api('GET', '/api/diag');
  assert.equal(d.claude.ok, true); assert.match(d.claude.version, /faux claude/);
  assert.ok((await api('GET', '/api/logs')).text.includes('Claude Sessions Manager'));
});
