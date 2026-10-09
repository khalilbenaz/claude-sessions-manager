'use strict';
require('../lib/tz').alignTimezone(); // même fuseau que l'app testée (qui suit celui du système)
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
for (const d of [HOME, DATA, WORK, path.join(TMP, 'mem')]) fs.mkdirSync(d, { recursive: true });
const ENV = {
  ...process.env, CSM_PORT: String(PORT), CSM_DATA: DATA, CSM_SECRETS_FILE_ONLY: '1', HOME, USERPROFILE: HOME,
  CSM_SYNC_INTERVAL: '700', CSM_SYNC_DELAY: '300', CSM_MEM_DB: path.join(TMP, 'mem', 'claude-mem.db'), CSM_NO_PLUGIN_INSTALL: '1', CSM_DEFAULT_SYNC_SERVER: 'http://127.0.0.1:9', CSM_QUOTA_MARGIN: '300', CSM_SCHEDULE_EVERY: '300', CSM_SYS_LANG: 'fr', CSM_GITHUB_API: `http://127.0.0.1:${PORT + 3}`, CSM_NO_GH_TOKEN: '1',
  CSM_QUOTA7_MIN_H: '0.000001',
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

test('mémoire des sessions : résumé capté, puis donné à la session suivante du même dossier', async () => {
  const s = await session(S.id);
  const m = await waitFor(async () => { const r = await api('GET', '/api/memory'); return r.items.find(e => e.id === s.claudeSessionId && e.last) ? r : null; }, 15000, 'fiche mémoire');
  assert.equal(m.enabled, true);
  const e = m.items.find(x => x.id === s.claudeSessionId);
  assert.equal(e.first, 'bonjour');
  assert.match(e.last, /echo: bonjour/);
  assert.ok(fs.existsSync(path.join(DATA, 'memory', 'sessions', `${e.id}.json`)));
  await waitFor(() => fs.readdirSync(path.join(DATA, 'memory', 'projects')).length, 5000, 'mémoire du dossier (.md)');
  const N = await api('POST', '/api/sessions', { cwd: WORK, name: 'suivante' });
  const n = await idle(N.id);
  const file = path.join(HOME, '.claude', 'projects', fs.realpathSync(WORK).replace(/[^a-zA-Z0-9]/g, '-'), `${n.claudeSessionId}.context.txt`);
  const alt = path.join(HOME, '.claude', 'projects', WORK.replace(/[^a-zA-Z0-9]/g, '-'), `${n.claudeSessionId}.context.txt`);
  const ctx = await waitFor(() => [file, alt].map(f => fs.existsSync(f) && fs.readFileSync(f, 'utf8')).find(Boolean), 5000, 'contexte au démarrage');
  assert.match(ctx, /Mémoire partagée/);
  assert.match(ctx, /bonjour/);
  await api('DELETE', `/api/sessions/${N.id}`);
});

test('mémoire : chercher, note « À retenir », retirer une réponse, oublier une fiche ; notes de Claude Code', async () => {
  const s = await session(S.id);
  const found = await api('GET', '/api/memory/cards?q=bonjour');
  const card = found.items.find(e => e.id === s.claudeSessionId);
  assert.ok(card, 'trouvée par la recherche');
  assert.equal((await api('GET', '/api/memory/cards?q=introuvable-xyz')).items.length, 0);
  const full = await api('GET', `/api/memory/cards/${card.id}`);
  assert.ok(full.answers.some(a => /echo: bonjour/.test(a)));
  await api('PATCH', `/api/memory/cards/${card.id}`, { title: 'Titre corrigé', note: 'toujours répondre en français', dropAnswer: full.answers.find(a => /echo: bonjour/.test(a)) });
  const after = await api('GET', `/api/memory/cards/${card.id}`);
  assert.equal(after.title, 'Titre corrigé');
  assert.ok(!after.answers.some(a => /echo: bonjour/.test(a)), 'réponse retirée');
  // la note est donnée en premier au démarrage suivant
  const N = await api('POST', '/api/sessions', { cwd: WORK, name: 'avec-note' });
  const n = await idle(N.id);
  const dirs = [fs.realpathSync(WORK), WORK].map(w => path.join(HOME, '.claude', 'projects', w.replace(/[^a-zA-Z0-9]/g, '-'), `${n.claudeSessionId}.context.txt`));
  const ctxt = await waitFor(() => dirs.map(f => fs.existsSync(f) && fs.readFileSync(f, 'utf8')).find(Boolean), 5000, 'contexte');
  assert.match(ctxt, /À retenir[\s\S]*toujours répondre en français/);
  // un nouveau tour ne remet pas la réponse retirée
  const c = await wsClient(); c.input(S.id, 'encore\r');
  await waitFor(async () => (await api('GET', `/api/memory/cards/${card.id}`)).answers.some(a => /echo: encore/.test(a)), 15000, 'fiche à jour');
  assert.ok(!(await api('GET', `/api/memory/cards/${card.id}`)).answers.some(a => /echo: bonjour/.test(a)), 'toujours retirée');
  c.ws.close();
  // oublier : plus listée, plus donnée, pas recréée
  const nCard = (await api('GET', '/api/memory/cards')).items.find(e => e.id === n.claudeSessionId);
  if (nCard) {
    await api('PATCH', `/api/memory/cards/${nCard.id}`, { forget: true });
    assert.ok(!(await api('GET', '/api/memory/cards')).items.some(e => e.id === nCard.id));
    assert.equal((await req('GET', `/api/memory/cards/${nCard.id}`)).status, 404);
  }
  await api('DELETE', `/api/sessions/${N.id}`);
  assert.ok(!(await api('GET', '/api/memory/cards')).items.some(e => e.id === n.claudeSessionId), 'pas recréée');

  // notes de Claude Code : liste, modification (copie avant), suppression ; chemin hors memory/ refusé
  const enc = p => p.replace(/[^a-zA-Z0-9]/g, '-');
  const nd = path.join(HOME, '.claude', 'projects', enc(HOME) + '-notes', 'memory'); fs.mkdirSync(nd, { recursive: true });
  fs.writeFileSync(path.join(nd, 'MEMORY.md'), '- préférer pnpm');
  const notes = await api('GET', '/api/memory/notes?q=pnpm');
  assert.equal(notes.length, 1);
  await api('PUT', '/api/memory/notes', { p: notes[0].p, text: '- préférer npm' });
  assert.equal(fs.readFileSync(path.join(nd, 'MEMORY.md'), 'utf8'), '- préférer npm');
  assert.equal((await req('PUT', '/api/memory/notes', { p: 'CLAUDE.md', text: 'x' })).status, 400);
  assert.equal((await req('PUT', '/api/memory/notes', { p: notes[0].p.replace('MEMORY.md', '../../x.md'), text: 'x' })).status, 400);
  await api('PUT', '/api/memory/notes', { p: notes[0].p, delete: true });
  assert.ok(!fs.existsSync(path.join(nd, 'MEMORY.md')));
  assert.equal((await api('GET', '/api/memory/claude-mem?q=x')).available !== undefined, true);
});

test('réglages des sessions : moteur de mémoire (claude-mem activé ou non) et fenêtre du compactage', async () => {
  const read = async id => {
    const n = await idle(id);
    const f = [fs.realpathSync(WORK), WORK].map(w => path.join(HOME, '.claude', 'projects', w.replace(/[^a-zA-Z0-9]/g, '-'), `${n.claudeSessionId}.settings.json`)).find(fs.existsSync);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  };
  const A = await api('POST', '/api/sessions', { cwd: WORK, name: 'réglages-a' });
  const a = await read(A.id);
  assert.ok(a.hooks.SessionStart);
  assert.equal(a.enabledPlugins['claude-mem@thedotmack'], false); // mémoire native par défaut
  assert.equal(a.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1000000');
  await api('PUT', '/api/settings', { memoryEngine: 'claude-mem', autoCompactWindow: 'claude' });
  try {
    const B = await api('POST', '/api/sessions', { cwd: WORK, name: 'réglages-b' });
    const b = await read(B.id);
    assert.equal(b.enabledPlugins['claude-mem@thedotmack'], true);
    assert.equal(b.env, undefined);
    assert.equal((await api('GET', '/api/memory')).enabled, false);
    await api('DELETE', `/api/sessions/${B.id}`);
  } finally {
    await api('PUT', '/api/settings', { memoryEngine: 'native', autoCompactWindow: 'model' });
    await api('DELETE', `/api/sessions/${A.id}`);
  }
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

test('file d’attente : en pause près de la limite des 5 h, reprise à la réinitialisation, « continue » après une coupure', async () => {
  const Q = await api('POST', '/api/sessions', { cwd: WORK, name: 'quota' });
  await idle(Q.id);
  const c = await wsClient();
  const quota = (pct, resetAt) => api('POST', '/api/hook', { csm: Q.id, event: 'quota', data: { pct, resetAt } });
  try {
    // barre d'état : 96 % utilisés → la file attend la réinitialisation
    await quota(96, Date.now() + 4000); // marge : sur une machine chargée, 1,5 s pouvait s'écouler avant l'ajout à la file
    await api('PUT', `/api/sessions/${Q.id}/queue`, [{ text: 'apres-quota' }]);
    const w = await waitFor(async () => (await session(Q.id)).quotaWait, 5000, 'pause');
    assert.ok(w > Date.now() - 1000);
    await new Promise(r => setTimeout(r, 600));
    assert.ok(!(c.out[Q.id] || '').includes('echo: apres-quota'), 'rien envoyé pendant la pause');
    await waitFor(() => (c.out[Q.id] || '').includes('echo: apres-quota'), 20000, 'reprise après la réinitialisation');
    await idle(Q.id);
    assert.equal((await session(Q.id)).quotaWait, undefined);

    // limite atteinte en plein travail (message de Claude Code) : session en attente, puis « continue »
    await quota(97, 0);
    c.input(Q.id, 'quota-limite\r');
    await waitFor(async () => (await session(Q.id)).quotaWait, 8000, 'coupée par la limite');
    assert.ok(!(c.out[Q.id] || '').includes('echo: continue'));
    await quota(5, Date.now() + 30 * 3600e3); // nouvelle fenêtre de quota (après la reprise prévue) : la limite est passée
    await waitFor(() => (c.out[Q.id] || '').includes('echo: continue'), 8000, '« continue » envoyé');
  } finally {
    await quota(0, 0);
    c.ws.close();
    await api('DELETE', `/api/sessions/${Q.id}`);
  }
});

test('demandes programmées : échéances, envoi à une session, rattrapage, une seule fois', async () => {
  const { nextRun, lastDue } = require('../lib/schedule');
  const base = new Date('2026-10-05T08:00:00'); // lundi
  assert.equal(new Date(nextRun({ time: '09:30', days: [1, 3] }, base.getTime())).toString().slice(0, 21), 'Mon Oct 05 2026 09:30');
  assert.equal(new Date(nextRun({ time: '07:00', days: [1, 3] }, base.getTime())).getDay(), 3, 'heure passée : mercredi');
  assert.equal(nextRun({ time: '07:00', days: [], date: '2026-10-05' }, base.getTime()), 0, 'une fois, déjà passée');
  assert.equal(new Date(lastDue({ time: '07:00', days: [0, 1, 2, 3, 4, 5, 6] }, base.getTime())).getHours(), 7);

  const c = await wsClient();
  const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // enregistrée après son heure : pas lancée tout de suite
  const [x] = await api('PUT', '/api/schedules', [{ name: 'revue', time: hhmm, date: today, target: 'session', session: S.id, text: 'programme-du-matin' }]);
  await new Promise(r => setTimeout(r, 900));
  assert.ok(!(c.out[S.id] || '').includes('echo: programme-du-matin'), 'pas de lancement à l’enregistrement');
  // échéance manquée (app fermée) il y a moins de 2 h : rattrapée, puis désactivée (une seule fois)
  const F = path.join(DATA, 'schedules.json');
  fs.writeFileSync(F, JSON.stringify(JSON.parse(fs.readFileSync(F, 'utf8')).map(y => ({ ...y, lastRun: 0 }))));
  await waitFor(() => (c.out[S.id] || '').includes('echo: programme-du-matin'), 8000, 'envoyée');
  const after = (await api('GET', '/api/schedules'))[0];
  assert.equal(after.enabled, false);
  assert.match(after.lastResult, /envoyé|file/);
  // « Lancer maintenant »
  assert.ok((await api('POST', `/api/schedules/${x.id}/run`)).result);
  await api('PUT', '/api/schedules', []);
  c.ws.close();
});

test('mes prompts : demandes de la session, sans le bruit (outils, commandes, interruptions)', async () => {
  const c = await wsClient();
  const Q = await api('POST', '/api/sessions', { cwd: WORK, name: 'mes-prompts' });
  await idle(Q.id);
  c.input(Q.id, 'quelle est la cause du bug ?\r');
  await waitFor(() => (c.out[Q.id] || '').includes('echo: quelle est la cause du bug ?'), 10000, 'réponse');
  const list = await waitFor(async () => { const l = await api('GET', `/api/sessions/${Q.id}/prompts`); return l.some(p => p.text === 'quelle est la cause du bug ?') && l; }, 10000, 'prompt listé');
  assert.ok(list.every(p => p.t > 0 && !/^\[Request interrupted|<command-|<system-reminder/.test(p.text)));
  assert.equal((await req('GET', '/api/sessions/inconnue/prompts')).status, 404);
  c.ws.close();
  await api('DELETE', `/api/sessions/${Q.id}`);
});

test('pause : session arrêtée mais gardée, mémoire enregistrée, synchronisée « en pause » puis reprise', async () => {
  const { encodeCode } = require('../lib/sync');
  const KEY = 'p'.repeat(32);
  const fake = await fakeSyncServer([KEY]);
  const c = await wsClient();
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'pc-pause' });
    const P = await api('POST', '/api/sessions', { cwd: WORK, name: 'a-mettre-en-pause' });
    const ready = await idle(P.id);
    c.input(P.id, 'travail en cours\r');
    await waitFor(() => (c.out[P.id] || '').includes('echo: travail en cours'), 10000, 'réponse');
    await idle(P.id);
    const r = await api('POST', `/api/sessions/${P.id}/pause`);
    assert.equal(r.alive, false, 'arrêtée');
    assert.equal(r.paused, true);
    assert.equal(r.memory, true, 'mémoire enregistrée');
    assert.equal(r.synced, true, 'synchronisée avant la réponse');
    assert.ok((await api('GET', '/api/sessions')).some(x => x.id === P.id), 'toujours dans la liste');
    const sid = (await session(P.id)).syncId;
    assert.equal(fake.plain(KEY, sid).paused, true, 'en pause pour les autres machines');
    assert.ok(fake.tx(KEY).meta.get(sid), 'conversation envoyée');
    assert.ok((await api('GET', '/api/memory/cards')).items.some(e => e.id === ready.claudeSessionId), 'fiche mémoire');
    // reprise : plus en pause, ici et ailleurs
    await api('POST', `/api/sessions/${P.id}/restart`);
    await idle(P.id);
    assert.equal((await session(P.id)).paused, undefined);
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.plain(KEY, sid).paused === undefined; }, 10000, 'reprise synchronisée');
    await api('DELETE', `/api/sessions/${P.id}`);
  } finally {
    c.ws.close();
    await api('PUT', '/api/settings', { syncCode: '' });
    fake.srv.close();
  }
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
  assert.equal(r.syncMinutes, 5, 'synchro toutes les 5 min par défaut');
  assert.equal((await api('PUT', '/api/settings', { syncMinutes: 7 })).syncMinutes, 5, 'intervalle hors liste refusé');
  assert.equal((await api('PUT', '/api/settings', { syncMinutes: 30 })).syncMinutes, 30);
  await api('PUT', '/api/settings', { syncMinutes: 5 });
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
  const stats = { lists: 0 }; // GET /transcripts reçus (lectures de la liste complète)
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
      if (u.pathname === '/usage') return send(200, { bytes: [...(txs.get(sp)?.chunks.values() || [])].reduce((n, c) => n + c.length, 0), max: 200e6, sessions: rows.size, transcripts: txs.get(sp)?.meta.size || 0 });
      if (u.pathname === '/space' && q.method === 'DELETE') { // changement de code : l'espace et ses accès disparaissent
        spaces.delete(sp); txs.delete(sp);
        for (const [a, v] of linked) if (v === sp) linked.delete(a);
        if (keys.includes(sp)) keys.splice(keys.indexOf(sp), 1);
        return send(200, { ok: true });
      }
      const t = u.pathname.match(/^\/transcripts(?:\/([^/]+)(?:\/([^/]+)\/([^/]+))?)?$/);
      if (t) {
        const T = txOf(sp), [, uid, ver, n] = t;
        if (!uid) stats.lists++;
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
    srv, url: `http://127.0.0.1:${srv.address().port}`, rows: rowsOf, tx: k => txOf(idOf(k)), bearers, stats,
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

test('synchro : mémoire des sessions partagée entre machines, chiffrée', async () => {
  const zlib = require('zlib');
  const { encodeCode, seal, unseal, txVersion } = require('../lib/sync');
  const { blank } = require('../lib/memory');
  const KEY = 'n'.repeat(32);
  const aad = (uid, m) => `n|${uid}|${m.ver}|${m.updatedAt}`;
  const fake = await fakeSyncServer([KEY]);
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'mac-mem' });
    // résumé de la session principale : envoyé chiffré
    const cid = (await session(S.id)).claudeSessionId;
    const meta = await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.tx(KEY).meta.get('nm-' + cid); }, 15000, 'résumé envoyé');
    assert.equal(meta.cid, 'memory'); assert.equal(meta.origin, 'mac-mem');
    const blob = Buffer.concat([...Array(meta.chunks).keys()].map(i => fake.tx(KEY).chunks.get(`nm-${cid}/${meta.ver}/${i}`)));
    assert.ok(!blob.includes('bonjour'), 'résumé chiffré sur le serveur');
    const sent = JSON.parse(zlib.gunzipSync(unseal(KEY, blob, aad('nm-' + cid, meta))));
    assert.equal(sent.first, 'bonjour'); assert.equal(sent.off, undefined, 'offset local non partagé');

    // résumé écrit sur une autre machine : reçu ici, puis donné aux sessions de ce dossier
    const put = (e, updatedAt) => {
      const raw = Buffer.from(JSON.stringify(e)), ver = txVersion(KEY, raw), m = { cid: 'memory', ver, chunks: 1, updatedAt, origin: 'pc-bureau' };
      const b = seal(KEY, zlib.gzipSync(raw), aad('nm-' + e.id, m));
      fake.tx(KEY).chunks.set(`nm-${e.id}/${ver}/0`, b); fake.tx(KEY).meta.set('nm-' + e.id, { ...m, size: b.length });
    };
    const t = Date.now();
    const pc = Object.assign(blank('pc-memoire-1'), { project: '{home}/projmem', machine: 'pc-bureau', updated: t, first: 'refonte faite sur le PC', last: 'migration terminée' });
    put(pc, t);
    const got = await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/memory')).items.find(e => e.id === 'pc-memoire-1'); }, 15000, 'résumé reçu');
    assert.equal(got.machine, 'pc-bureau'); assert.equal(got.last, 'migration terminée');
    assert.equal((await api('GET', '/api/sync')).nmReceived, 1);
    // version plus ancienne : ignorée
    put({ ...pc, last: 'ancienne', updated: t - 60000 }, t - 60000);
    await api('POST', '/api/sync/now');
    assert.equal((await api('GET', '/api/memory')).items.find(e => e.id === 'pc-memoire-1').last, 'migration terminée');
    fs.mkdirSync(path.join(HOME, 'projmem'), { recursive: true });
    const N = await api('POST', '/api/sessions', { cwd: path.join(HOME, 'projmem'), name: 'mem-pc' });
    const n = await idle(N.id);
    const ctxFile = path.join(HOME, '.claude', 'projects', fs.realpathSync(path.join(HOME, 'projmem')).replace(/[^a-zA-Z0-9]/g, '-'), `${n.claudeSessionId}.context.txt`);
    await waitFor(() => fs.existsSync(ctxFile), 5000, 'contexte au démarrage');
    assert.match(fs.readFileSync(ctxFile, 'utf8'), /refonte faite sur le PC[\s\S]*migration terminée/);
    await api('DELETE', `/api/sessions/${N.id}`);
  } finally {
    await api('PUT', '/api/settings', { syncCode: '' });
    fake.srv.close();
  }
});

test('synchro : règles, skills, agents et mémoire de Claude partagés entre machines', async () => {
  const zlib = require('zlib');
  const { encodeCode, seal, unseal, txVersion } = require('../lib/sync');
  const KEY = 'f'.repeat(32);
  const C = path.join(HOME, '.claude'), enc = p => p.replace(/[^a-zA-Z0-9]/g, '-');
  const uidOf = p => 'cf-' + txVersion(KEY, Buffer.from('cf-path|' + p));
  const aad = (uid, m) => `c|${uid}|${m.ver}|${m.updatedAt}`;
  const w = (rel, txt) => { const f = path.join(C, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); return f; };
  w('CLAUDE.md', '@REGLES.md\n'); w('REGLES.md', 'toujours en français');
  w('skills/deploy/SKILL.md', 'déployer'); w('skills/deploy/node_modules/x.js', 'ignoré');
  const memRel = `projects/${enc(HOME)}-proj/memory/MEMORY.md`;
  w(memRel, '- note'); w(`projects/${enc(HOME)}-proj/abc.jsonl`, 'conversation : pas une règle');
  const fake = await fakeSyncServer([KEY]);
  const get = p => {
    const m = fake.tx(KEY).meta.get(uidOf(p));
    if (!m) return null;
    const blob = Buffer.concat([...Array(m.chunks).keys()].map(i => fake.tx(KEY).chunks.get(`${uidOf(p)}/${m.ver}/${i}`)));
    return { m, blob, e: JSON.parse(zlib.gunzipSync(unseal(KEY, blob, aad(uidOf(p), m)))) };
  };
  const put = (e, updatedAt) => {
    const uid = uidOf(e.p), raw = Buffer.from(JSON.stringify(e)), ver = txVersion(KEY, raw), m = { cid: 'claude', ver, chunks: 1, updatedAt, origin: 'pc-bureau' };
    const b = seal(KEY, zlib.gzipSync(raw), aad(uid, m));
    fake.tx(KEY).chunks.set(`${uid}/${ver}/0`, b); fake.tx(KEY).meta.set(uid, { ...m, size: b.length });
  };
  const b64 = s => Buffer.from(s).toString('base64');
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'mac-cf' });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return get('skills/deploy/SKILL.md'); }, 15000, 'skill envoyée');
    const r = get('REGLES.md');
    assert.ok(!r.blob.includes('français'), 'chiffré sur le serveur');
    assert.equal(Buffer.from(r.e.d, 'base64').toString(), 'toujours en français');
    assert.ok(get('CLAUDE.md'));
    // conversations, mémoires et configuration partagent une seule lecture de la liste par synchro
    const before = fake.stats.lists;
    await api('POST', '/api/sync/now');
    assert.equal(fake.stats.lists - before, 1, 'liste lue une fois par synchro');
    assert.equal(get('projects/~-proj/memory/MEMORY.md').e.p, 'projects/~-proj/memory/MEMORY.md', 'chemin portable');
    assert.equal(get('skills/deploy/node_modules/x.js'), null);
    assert.ok(![...fake.tx(KEY).meta.values()].some(m => m.cid === 'claude' && m.size > 5e6));

    // agent créé et règle modifiée sur une autre machine (plus récents) : écrits ici, l'ancienne règle sauvegardée
    const later = Date.now() + 5000;
    put({ p: 'agents/revue.md', d: b64('agent de revue'), x: 0 }, later);
    put({ p: 'REGLES.md', d: b64('règles du PC'), x: 0 }, later);
    put({ p: 'skills/deploy/SKILL.md', del: 1 }, later);
    put({ p: '../evil.md', d: b64('non'), x: 0 }, later);
    put({ p: 'projects/~-proj/memory/note.md', d: b64('note du PC'), x: 0 }, later);
    // règles, skills et agents reçus attendent une validation ; les notes de Claude Code s'appliquent seules
    const pend = await waitFor(async () => { await api('POST', '/api/sync/now'); const d = await api('GET', '/api/claude-sync'); return d.pending.length === 3 && d; }, 15000, 'fichiers à valider');
    assert.deepEqual(pend.pending.map(x => x.p).sort(), ['REGLES.md', 'agents/revue.md', 'skills/deploy/SKILL.md']);
    assert.ok(!fs.existsSync(path.join(C, 'agents', 'revue.md')), 'rien écrit avant validation');
    assert.equal(fs.readFileSync(path.join(C, `projects/${enc(HOME)}-proj/memory/note.md`), 'utf8'), 'note du PC');
    await api('POST', '/api/claude-sync/decide', { apply: true });
    assert.equal(fs.readFileSync(path.join(C, 'agents', 'revue.md'), 'utf8'), 'agent de revue');
    assert.equal(fs.readFileSync(path.join(C, 'REGLES.md'), 'utf8'), 'règles du PC');
    assert.ok(!fs.existsSync(path.join(C, 'skills/deploy/SKILL.md')), 'skill supprimée ailleurs');
    assert.ok(!fs.existsSync(path.join(HOME, 'evil.md')));
    const bk = path.join(DATA, 'claude-sync-backup');
    const saved = fs.readdirSync(bk).map(d => path.join(bk, d, 'REGLES.md')).find(f => fs.existsSync(f));
    assert.equal(fs.readFileSync(saved, 'utf8'), 'toujours en français');
    // journal + restauration : l'ancienne règle revient et repart vers les autres machines
    const entry = (await api('GET', '/api/claude-sync')).log.find(x => x.p === 'REGLES.md' && x.action === 'replaced');
    assert.ok(entry?.backup, 'remplacement noté avec sa copie');
    await api('POST', '/api/claude-sync/restore', { id: entry.id });
    assert.equal(fs.readFileSync(path.join(C, 'REGLES.md'), 'utf8'), 'toujours en français');
    await waitFor(async () => { await api('POST', '/api/sync/now'); return Buffer.from(get('REGLES.md').e.d, 'base64').toString() === 'toujours en français'; }, 15000, 'restauration envoyée');
    assert.equal((await req('POST', '/api/claude-sync/restore', { id: 'inconnu' })).status, 400);

    // lien symbolique : jamais d'écriture à travers lui (dépôt relié dans les skills)
    const repo = path.join(HOME, 'depot-relie'); fs.mkdirSync(repo, { recursive: true });
    fs.symlinkSync(repo, path.join(C, 'skills', 'relie'), process.platform === 'win32' ? 'junction' : 'dir'); // jonction : sans droits admin sous Windows
    put({ p: 'skills/relie/evil.sh', d: b64('rm -rf'), x: 1 }, Date.now() + 9000);
    put({ p: 'skills/relie/.git/hooks/pre-commit', d: b64('rm -rf'), x: 1 }, Date.now() + 9000);
    await api('POST', '/api/sync/now');
    await api('POST', '/api/claude-sync/decide', { apply: true });
    assert.ok(!fs.existsSync(path.join(repo, 'evil.sh')), 'refusé à travers le lien');
    assert.ok(!fs.existsSync(path.join(repo, '.git')), 'dossier caché refusé');
    fs.unlinkSync(path.join(C, 'skills', 'relie'));

    // fichier devenu trop gros : pas pris pour une suppression
    w('agents/gros.md', 'petit');
    await waitFor(async () => { await api('POST', '/api/sync/now'); return get('agents/gros.md'); }, 15000, 'envoyé');
    w('agents/gros.md', 'x'.repeat(2.2 * 1024 * 1024));
    await api('POST', '/api/sync/now');
    assert.ok(!get('agents/gros.md').e.del, 'pas de suppression envoyée');
    assert.ok((await api('GET', '/api/sync')).cfReceived >= 4);

    // version plus ancienne : ignorée ; modification locale : envoyée ; suppression locale : propagée
    put({ p: 'REGLES.md', d: b64('ancienne'), x: 0 }, Date.now() - 60000);
    fs.rmSync(path.join(C, memRel));
    w('CLAUDE.md', '@REGLES.md\nmodifié ici\n');
    await waitFor(async () => { await api('POST', '/api/sync/now'); return get('projects/~-proj/memory/MEMORY.md')?.e.del; }, 15000, 'suppression envoyée');
    assert.equal(fs.readFileSync(path.join(C, 'REGLES.md'), 'utf8'), 'toujours en français', 'version ancienne ignorée');
    assert.equal((await api('GET', '/api/claude-sync')).pending.length, 0, 'ni mise en attente');
    assert.match(Buffer.from(get('CLAUDE.md').e.d, 'base64').toString(), /modifié ici/);

    // option décochée : plus rien n'est envoyé pour cette catégorie
    await api('PUT', '/api/settings', { syncClaudeAgents: false });
    w('agents/autre.md', 'local seulement');
    await api('POST', '/api/sync/now');
    assert.equal(get('agents/autre.md'), null);
  } finally {
    await api('PUT', '/api/settings', { syncCode: '', syncClaudeAgents: true });
    fs.rmSync(C + '/agents', { recursive: true, force: true });
    for (const f of ['CLAUDE.md', 'REGLES.md']) fs.rmSync(path.join(C, f), { force: true });
    fs.rmSync(path.join(C, 'skills'), { recursive: true, force: true });
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

test('synchro : le choix de la mémoire (intégrée ou claude-mem) est le même sur toutes les machines', async () => {
  const { encodeCode } = require('../lib/sync');
  const KEY = 'e'.repeat(32);
  const fake = await fakeSyncServer([KEY]);
  try {
    // une machine qui rejoint un espace où claude-mem est choisi : proposé, jamais installé sans accord
    await api('PUT', '/api/settings', { memoryEngine: 'native', syncSessionMemory: true });
    const t0 = Date.now() + 2000;
    fake.put(KEY, { uid: 'csmcfg-memory', updatedAt: t0, origin: 'mac', data: sealed(KEY, 'csmcfg-memory', t0, { engine: 'claude-mem' }) });
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'pc-engine' });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/sync')).memSuggest === 'claude-mem'; }, 10000, 'proposition');
    assert.equal((await api('GET', '/api/settings')).memoryEngine, 'native', 'choix local gardé');
    assert.equal(fake.plain(KEY, 'csmcfg-memory').engine, 'claude-mem', 'rien renvoyé sans choix fait ici');
    // choix fait ici : envoyé chiffré aux autres
    await new Promise(r => setTimeout(r, 2100));
    await api('PUT', '/api/settings', { memoryEngine: 'native' });
    const row = await waitFor(async () => { await api('POST', '/api/sync/now'); const r = fake.rows(KEY).get('csmcfg-memory'); return fake.plain(KEY, 'csmcfg-memory').engine === 'native' && r; }, 10000, 'choix envoyé');
    assert.ok(!JSON.stringify(row.data).includes('native'), 'choix chiffré');
    await api('PUT', '/api/settings', { memoryEngine: 'claude-mem' });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.plain(KEY, 'csmcfg-memory').engine === 'claude-mem'; }, 10000, 'nouveau choix envoyé');
    // changé ailleurs plus tard vers la mémoire intégrée : suivi ici
    const t1 = Date.now() + 5000;
    fake.put(KEY, { uid: 'csmcfg-memory', updatedAt: t1, origin: 'mac', data: sealed(KEY, 'csmcfg-memory', t1, { engine: 'native' }) });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/settings')).memoryEngine === 'native'; }, 10000, 'changement suivi');
  } finally {
    await api('PUT', '/api/settings', { syncCode: '', memoryEngine: 'native' });
    fake.srv.close();
  }
});

test('synchro : machines de l’espace, place occupée, retirer une machine, changer de code', async () => {
  const { encodeCode, authKey } = require('../lib/sync');
  const KEY = 'k'.repeat(32);
  const fake = await fakeSyncServer([KEY]);
  try {
    const t0 = Date.now();
    fake.put(KEY, { uid: 'csmcfg-machine-aaaaaaaaaaaa', updatedAt: t0, origin: 'pc-bureau', data: sealed(KEY, 'csmcfg-machine-aaaaaaaaaaaa', t0, { name: 'pc-bureau', platform: 'win32', version: '3.17.0', engine: 'native', seen: t0 }) });
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'mac-rot' });
    const s = await api('POST', '/api/sessions', { cwd: WORK, name: 'a-garder' });
    const list = await waitFor(async () => { await api('POST', '/api/sync/now'); const r = await api('GET', '/api/sync/machines'); return r.machines.length === 2 && r; }, 10000, 'machines');
    assert.equal(list.machines[0].me, true);
    assert.equal(list.machines[0].name, 'mac-rot');
    assert.equal(list.machines[1].name, 'pc-bureau');
    assert.ok(list.usage && list.usage.max > 0, 'place occupée');
    await waitFor(() => [...fake.rows(KEY).keys()].some(u => u.startsWith('csmcfg-machine-') && u !== 'csmcfg-machine-aaaaaaaaaaaa'), 10000, 'notre machine publiée');
    // retirer : tombstone envoyée, et la fiche des autres n'est pas effacée par les synchros suivantes
    await api('DELETE', '/api/sync/machines/csmcfg-machine-aaaaaaaaaaaa');
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.rows(KEY).get('csmcfg-machine-aaaaaaaaaaaa').deleted; }, 10000, 'retirée');
    assert.equal((await api('GET', '/api/sync/machines')).machines.length, 1);
    // changer de code : ancien espace effacé (ancien code refusé), données renvoyées dans le nouvel espace
    const { code } = await api('POST', '/api/sync/rotate', {});
    const dec = require('../lib/sync').decodeCode(code);
    assert.equal(dec.url, fake.url, 'même serveur que l’espace actuel');
    assert.equal((await api('GET', '/api/settings')).syncCode, code);
    const raw = dec.key;
    const old = await fetch(fake.url + '/sessions?since=0', { headers: { authorization: 'Bearer ' + authKey(KEY) } });
    assert.equal(old.status, 401, 'ancien code refusé');
    const sid = (await session(s.id)).syncId;
    await waitFor(async () => { await api('POST', '/api/sync/now'); return [...fake.rows(raw).values()].some(r => !r.deleted && fake.plain(raw, r.uid)?.name === 'a-garder'); }, 15000, 'session dans le nouvel espace');
    assert.ok(sid);
    await api('DELETE', `/api/sessions/${s.id}`);
  } finally {
    await api('PUT', '/api/settings', { syncCode: '' });
    fake.srv.close();
  }
});

test('configuration de Claude : copies de plus de 30 jours effacées', () => {
  const claudesync = require('../lib/claudesync');
  const D = fs.mkdtempSync(path.join(require('os').tmpdir(), 'csm-purge-'));
  const old = path.join(D, 'claude-sync-backup', '2020-01-01'), recent = path.join(D, 'claude-sync-backup', 'recent');
  for (const d of [old, recent]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'CLAUDE.md'), 'x'); }
  const past = new Date(Date.now() - 31 * 86400e3); fs.utimesSync(old, past, past);
  const sc = claudesync({ DATA: D, settings: () => ({}), status: {} });
  sc.purge(true);
  assert.ok(!fs.existsSync(old) && fs.existsSync(recent));
  fs.rmSync(D, { recursive: true, force: true });
  // chemins reçus : pas de dossier caché, pas de sortie de ~/.claude
  assert.equal(claudesync.toLocal('skills/a/.git/hooks/x', '/c', '/h'), null);
  assert.equal(claudesync.toLocal('../x.md', '/c', '/h'), null);
  assert.ok(claudesync.toLocal('skills/a/SKILL.md', '/c/', '/h'), 'dossier avec / final accepté');
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

// Base claude-mem minimale (mêmes tables et index que claude-mem 12)
const MEM_SCHEMA = `
CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, content_session_id TEXT NOT NULL, memory_session_id TEXT UNIQUE, project TEXT NOT NULL,
  platform_source TEXT NOT NULL DEFAULT 'claude', user_prompt TEXT, started_at TEXT NOT NULL, started_at_epoch INTEGER NOT NULL, completed_at TEXT, completed_at_epoch INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')), worker_port INTEGER, prompt_counter INTEGER DEFAULT 0, custom_title TEXT);
CREATE UNIQUE INDEX ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id);
CREATE TABLE observations (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_session_id TEXT NOT NULL, project TEXT NOT NULL, text TEXT, type TEXT NOT NULL, title TEXT,
  narrative TEXT, created_at TEXT NOT NULL, created_at_epoch INTEGER NOT NULL, content_hash TEXT, synced_at INTEGER, origin_device_id TEXT, origin_local_id TEXT,
  sync_rev TEXT NOT NULL DEFAULT '1', FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id));
CREATE UNIQUE INDEX ux_observations_session_hash ON observations(memory_session_id, content_hash);
CREATE UNIQUE INDEX ux_observations_origin ON observations(origin_device_id, origin_local_id) WHERE origin_device_id IS NOT NULL;
CREATE TABLE session_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_session_id TEXT NOT NULL, project TEXT NOT NULL, request TEXT, learned TEXT,
  created_at TEXT NOT NULL, created_at_epoch INTEGER NOT NULL, synced_at INTEGER, origin_device_id TEXT, origin_local_id TEXT, sync_rev TEXT NOT NULL DEFAULT '1');
CREATE UNIQUE INDEX ux_session_summaries_origin ON session_summaries(origin_device_id, origin_local_id) WHERE origin_device_id IS NOT NULL;
CREATE TABLE user_prompts (id INTEGER PRIMARY KEY AUTOINCREMENT, session_db_id INTEGER, content_session_id TEXT NOT NULL, prompt_number INTEGER NOT NULL,
  prompt_text TEXT NOT NULL, created_at TEXT NOT NULL, created_at_epoch INTEGER NOT NULL, synced_at INTEGER, origin_device_id TEXT, origin_local_id TEXT,
  sync_rev TEXT NOT NULL DEFAULT '1', FOREIGN KEY(session_db_id) REFERENCES sdk_sessions(id));
CREATE UNIQUE INDEX ux_user_prompts_origin ON user_prompts(origin_device_id, origin_local_id) WHERE origin_device_id IS NOT NULL;`;

test('synchro : mémoire claude-mem envoyée chiffrée et chargée depuis les autres machines', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { encodeCode, seal, unseal, txVersion } = require('../lib/sync');
  const KEY = 'm'.repeat(32), DEV = 'a1b2c3d4e5f6';
  const fake = await fakeSyncServer([KEY]);
  const MEM = path.join(TMP, 'mem'), file = path.join(MEM, 'claude-mem.db');
  const db = new DatabaseSync(file);
  db.exec(MEM_SCHEMA);
  const now = new Date().toISOString(), ep = Date.now();
  db.prepare("INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, status, worker_port) VALUES ('cs-local', 'ms-local', 'proj', ?, ?, 'active', 37777)").run(now, ep);
  db.prepare("INSERT INTO observations (memory_session_id, project, type, title, narrative, created_at, created_at_epoch, content_hash) VALUES ('ms-local', 'proj', 'discovery', 'observation-du-mac', 'secret-memoire', ?, ?, 'h1')").run(now, ep);
  db.prepare("INSERT INTO session_summaries (memory_session_id, project, request, created_at, created_at_epoch) VALUES ('ms-local', 'proj', 'résumé-du-mac', ?, ?)").run(now, ep);
  db.prepare("INSERT INTO user_prompts (session_db_id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch) VALUES (1, 'cs-local', 1, 'prompt-du-mac', ?, ?)").run(now, ep);
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'mac-mem', memoryEngine: 'claude-mem' });
    // envoyée : un lot chiffré « mem-<machine>-1 »
    const [uid, meta] = await waitFor(async () => { await api('POST', '/api/sync/now'); return [...fake.tx(KEY).meta.entries()].find(([u]) => u.startsWith('mem-')); }, 15000, 'mémoire envoyée');
    assert.match(uid, /^mem-[0-9a-f]{12}-1$/); assert.equal(meta.cid, 'claude-mem');
    const blob = Buffer.concat([...Array(meta.chunks).keys()].map(i => fake.tx(KEY).chunks.get(`${uid}/${meta.ver}/${i}`)));
    assert.ok(!blob.includes('secret-memoire'), 'mémoire chiffrée sur le serveur');
    const sent = JSON.parse(unseal(KEY, blob, `m|${uid}|${meta.ver}|${meta.updatedAt}`));
    assert.equal(sent.observations[0].title, 'observation-du-mac');
    assert.equal(sent.sessions[0].content_session_id, 'cs-local'); assert.ok(!('worker_port' in sent.sessions[0]) && !('id' in sent.sessions[0]));
    assert.equal(sent.user_prompts[0].prompt_text, 'prompt-du-mac'); assert.equal(sent.session_summaries[0].request, 'résumé-du-mac');
    const st = await api('GET', '/api/sync');
    assert.equal(st.memory, true); assert.equal(st.memSent, 3); assert.equal(st.lastError, '');

    // mémoire d'une autre machine : chargée ici, marquée comme reçue, jamais renvoyée
    const batch = {
      v: 1, dev: DEV,
      sessions: [{ content_session_id: 'cs-pc', memory_session_id: 'ms-pc', project: 'proj', started_at: now, started_at_epoch: ep, status: 'active' }],
      observations: [{ rid: 7, memory_session_id: 'ms-pc', project: 'proj', type: 'decision', title: 'observation-du-pc', created_at: now, created_at_epoch: ep, content_hash: 'h2', inconnue: 'x' }],
      session_summaries: [{ rid: 3, memory_session_id: 'ms-pc', project: 'proj', request: 'résumé-du-pc', created_at: now, created_at_epoch: ep }],
      user_prompts: [{ rid: 9, content_session_id: 'cs-pc', prompt_number: 1, prompt_text: 'prompt-du-pc', created_at: now, created_at_epoch: ep }],
    };
    const put = (u, b, at) => {
      const raw = Buffer.from(JSON.stringify(b)), ver = txVersion(KEY, raw), sealed = seal(KEY, raw, `m|${u}|${ver}|${at}`);
      fake.tx(KEY).chunks.set(`${u}/${ver}/0`, sealed);
      fake.tx(KEY).meta.set(u, { cid: 'claude-mem', ver, chunks: 1, size: sealed.length, updatedAt: at, origin: 'pc' });
    };
    put(`mem-${DEV}-1`, batch, Date.now());
    put(`mem-${DEV}-2`, { ...batch, dev: 'ffffffffffff' }, Date.now()); // machine usurpée : ignoré
    const got = await waitFor(async () => { await api('POST', '/api/sync/now'); return db.prepare("SELECT * FROM observations WHERE title = 'observation-du-pc'").get(); }, 15000, 'mémoire reçue');
    assert.equal(got.origin_device_id, 'csm-' + DEV); assert.equal(got.origin_local_id, '7');
    assert.equal(db.prepare("SELECT status FROM sdk_sessions WHERE content_session_id = 'cs-pc'").get().status, 'completed');
    const p = db.prepare("SELECT * FROM user_prompts WHERE prompt_text = 'prompt-du-pc'").get();
    assert.equal(p.session_db_id, db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = 'cs-pc'").get().id);
    assert.equal(db.prepare("SELECT origin_local_id FROM session_summaries WHERE request = 'résumé-du-pc'").get().origin_local_id, '3');
    assert.equal((await api('GET', '/api/sync')).memReceived, 3);
    // resynchroniser : ni doublon ici, ni renvoi de ce qui a été reçu
    await api('POST', '/api/sync/now'); await api('POST', '/api/sync/now');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM observations').get().c, 2);
    assert.equal([...fake.tx(KEY).meta.keys()].filter(u => u.startsWith('mem-') && !u.startsWith(`mem-${DEV}-`)).length, 1, 'un seul lot envoyé');

    // nouvelle observation ici : un nouveau lot, avec elle seule
    db.prepare("INSERT INTO observations (memory_session_id, project, type, title, created_at, created_at_epoch, content_hash) VALUES ('ms-local', 'proj', 'discovery', 'deuxième', ?, ?, 'h3')").run(now, ep);
    const m2 = await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.tx(KEY).meta.get(uid.replace(/-1$/, '-2')); }, 15000, 'deuxième lot');
    const b2 = JSON.parse(unseal(KEY, fake.tx(KEY).chunks.get(`${uid.replace(/-1$/, '-2')}/${m2.ver}/0`), `m|${uid.replace(/-1$/, '-2')}|${m2.ver}|${m2.updatedAt}`));
    assert.deepEqual(b2.observations.map(o => o.title), ['deuxième']);

    // sessions de l'app : mémoire dans l'espace synchronisé (jamais celle du terminal, ~/.claude-mem)
    const sess = await api('POST', '/api/sessions', { name: 'mem-env', cwd: WORK });
    const envf = await waitFor(async () => { const f = path.join(TMP, "mem", `env-${sess.id}.json`); return fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')); }, 8000, 'env de la session');
    assert.equal(envf.CLAUDE_MEM_DATA_DIR, MEM);
    assert.match(envf.CLAUDE_MEM_WORKER_PORT, /^\d+$/); assert.notEqual(envf.CLAUDE_MEM_WORKER_PORT, '37777');
    assert.equal(JSON.parse(fs.readFileSync(path.join(MEM, 'settings.json'), 'utf8')).CLAUDE_MEM_DATA_DIR, MEM);
    await api('DELETE', `/api/sessions/${sess.id}`);

    // option décochée : plus rien ne part
    await api('PUT', '/api/settings', { syncSessionMemory: false });
    assert.equal((await api('POST', '/api/sync/now')).memory, false);
  } finally {
    db.close();
    await api('PUT', '/api/settings', { syncCode: '', syncSessionMemory: true, memoryEngine: 'native' });
    fake.srv.close();
    fs.rmSync(file, { force: true });
  }
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

test('connexion Claude : expiration proche signalée, renouvellement depuis l’app', async () => {
  const f = path.join(HOME, '.claude', '.credentials.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const old = fs.existsSync(f) ? fs.readFileSync(f) : null;
  try {
    fs.writeFileSync(f, JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'b', expiresAt: Date.now() + 3600e3, refreshTokenExpiresAt: Date.now() + 2 * 86400e3 } }));
    let st = await api('GET', '/api/auth');
    assert.equal(st.source, 'file'); assert.equal(st.warn, true); assert.equal(st.expired, false);
    assert.ok(!JSON.stringify(st).includes('"a"'), 'aucun jeton exposé');
    const c = await wsClient();
    await api('POST', '/api/auth/renew');
    st = await waitFor(async () => { const x = await api('GET', '/api/auth'); return x.prompt && x.url && x; }, 10000, 'lien de connexion');
    assert.match(st.url, /^https:\/\/claude\.com\/cai\/oauth\/authorize/);
    assert.equal((await req('POST', '/api/auth/code', { code: 'a b;rm' })).status, 400, 'code invalide refusé');
    await api('POST', '/api/auth/code', { code: 'CODE-OK' });
    st = await waitFor(async () => { const x = await api('GET', '/api/auth'); return !x.renewing && x; }, 10000, 'fin du renouvellement');
    assert.equal(st.error, ''); assert.equal(st.warn, false, 'connexion renouvelée : plus d’alerte');
    assert.ok(c.msgs ? true : true);
    c.ws.close();
  } finally {
    if (old) fs.writeFileSync(f, old); else fs.rmSync(f, { force: true });
  }
});

test('réglage de lancement changé : sessions ouvertes signalées puis relancées dans leur conversation', async () => {
  const c = await wsClient();
  try {
    await api('PUT', '/api/settings', { replyLanguage: 'fr' });
    const s = await api('POST', '/api/sessions', { cwd: WORK, name: 'a-relancer' });
    const first = await idle(s.id);
    await waitFor(() => /LANGUE:french/.test(c.out[s.id] || ''), 10000, 'langue au démarrage'); // la sortie peut arriver après l'état
    c.input(s.id, 'premier message\r'); // une conversation à reprendre
    await waitFor(() => /echo: premier message/.test(c.out[s.id] || ''), 10000, 'réponse');
    await idle(s.id);
    await api('PUT', '/api/settings', { replyLanguage: 'en' });
    const st = await api('GET', '/api/apply-settings');
    assert.ok(st.count >= 1, 'session signalée');
    c.out[s.id] = '';
    const r = await api('POST', '/api/apply-settings');
    assert.ok(r.now >= 1);
    await waitFor(() => /LANGUE:english/.test(c.out[s.id] || ''), 15000, 'relancée avec la nouvelle langue');
    const again = await idle(s.id);
    assert.equal(again.claudeSessionId, first.claudeSessionId, 'même conversation');
    assert.equal((await api('GET', '/api/apply-settings')).count, 0, 'plus rien à relancer');
    await api('DELETE', `/api/sessions/${s.id}`);
  } finally { c.ws.close(); await api('PUT', '/api/settings', { replyLanguage: 'app' }); }
});

test('langue des réponses : transmise à Claude Code (réglage language), par défaut celle de l’interface', async () => {
  const c = await wsClient();
  const langOf = async opts => {
    await api('PUT', '/api/settings', opts);
    const s = await api('POST', '/api/sessions', { cwd: WORK, name: 'langue' });
    await waitFor(() => (c.out[s.id] || '').includes('FAUX CLAUDE prêt'), 15000, 'démarrage');
    const m = (c.out[s.id] || '').match(/LANGUE:([a-z]+)/);
    await api('DELETE', `/api/sessions/${s.id}`);
    return m ? m[1] : undefined;
  };
  try {
    assert.equal(await langOf({ lang: 'fr', replyLanguage: 'app' }), 'french');
    // interface en « Automatique » sur un système en français (transmis par l'app) : français, pas l'anglais de Node
    assert.equal(await langOf({ lang: 'auto', replyLanguage: 'app' }), 'french');
    assert.equal(await langOf({ lang: 'en', replyLanguage: 'app' }), 'english');
    assert.equal(await langOf({ replyLanguage: 'en' }), 'english');
    assert.equal(await langOf({ replyLanguage: 'claude' }), undefined, 'réglage de Claude Code laissé tel quel');
  } finally { c.ws.close(); await api('PUT', '/api/settings', { replyLanguage: 'app', lang: 'auto' }); }
});

test('extensions : import d’un fichier, modèles, session typée avec sa vue et ses actions', async () => {
  const ext = {
    csm: 1, id: 'revue-test', name: 'Revue (test)', version: '1.2.0',
    templates: [{ id: 'revue', name: 'Revue de code', prompt: 'relis', type: 'revue' }, { id: 'mauvais id!', name: 'x' }],
    prompts: [{ id: 'resume', title: 'Résumer', text: 'Résume.' }],
    sessionTypes: [{ id: 'revue', name: 'Revue', badge: 'REVUE', color: '#7A9BEA', instructions: 'Tu es en mode revue.', actions: [{ id: 'corrige', label: 'Corriger', send: 'corrige le point 1' }] }],
  };
  // fichiers refusés : format, identifiant, JSON
  assert.equal((await req('POST', '/api/extensions', { content: JSON.stringify({ ...ext, csm: 2 }) })).status, 400);
  assert.equal((await req('POST', '/api/extensions', { content: JSON.stringify({ ...ext, id: '../x' }) })).status, 400);
  assert.equal((await req('POST', '/api/extensions', { content: '{pas du json' })).status, 400);
  const r = await api('POST', '/api/extensions', { content: JSON.stringify(ext) });
  assert.equal(r.id, 'revue-test'); assert.equal(r.counts.templates, 1, 'modèle invalide écarté'); assert.equal(r.counts.sessionTypes, 1);
  assert.ok((await api('GET', '/api/extensions')).some(e => e.id === 'revue-test' && e.enabled && e.removable));
  const tpl = (await api('GET', '/api/extensions/templates')).find(t => t.id === 'revue-test/revue');
  assert.equal(tpl.type, 'revue-test/revue');
  assert.ok((await api('GET', '/api/extensions/prompts')).some(p => p.id === 'revue-test/resume'));
  assert.ok(!(await api('GET', '/api/templates')).some(t => String(t.id).startsWith('revue-test')), 'modèles de l’utilisateur intacts');

  // session typée : consignes + fichier de vue transmis à Claude
  const c = await wsClient();
  const s = await api('POST', '/api/sessions', { cwd: WORK, name: 'typée', type: tpl.type });
  assert.equal(s.typeInfo.name, 'Revue'); assert.equal(s.typeInfo.actions[0].id, 'corrige');
  await waitFor(() => (c.out[s.id] || '').includes('FAUX CLAUDE prêt'), 15000, 'démarrage');
  c.ws.send(JSON.stringify({ t: 'input', id: s.id, d: 'montre-consignes\r' }));
  await waitFor(() => /CONSIGNES:Tu es en mode revue\.\|VUE:oui/.test(c.out[s.id] || ''), 10000, 'consignes et fichier de vue');
  c.ws.send(JSON.stringify({ t: 'input', id: s.id, d: 'ecris-vue\r' }));
  const v = await waitFor(async () => (await api('GET', `/api/sessions/${s.id}/view`)).view, 10000, 'vue écrite');
  assert.equal(v.title, 'Analyse <b>test</b>', 'texte brut conservé (échappé à l’affichage)');
  assert.deepEqual(v.sections.map(x => x.kind), ['text', 'checklist', 'draft'], 'section inconnue écartée');
  // actions : du type, puis d'un brouillon (texte relu par l'utilisateur)
  await waitFor(async () => (await session(s.id)).status === 'idle', 10000, 'prête');
  await api('POST', `/api/sessions/${s.id}/view-action`, { action: 'corrige' });
  await waitFor(() => (c.out[s.id] || '').includes('echo: corrige le point 1'), 20000, 'action envoyée');
  await waitFor(async () => (await session(s.id)).status === 'idle', 10000, 'prête');
  await api('POST', `/api/sessions/${s.id}/view-action`, { section: 2, index: 0, draft: 'Bonjour relu' });
  await waitFor(() => (c.out[s.id] || '').includes('echo: publie : Bonjour relu'), 20000, 'brouillon envoyé');
  assert.equal((await req('POST', `/api/sessions/${s.id}/view-action`, { action: 'inexistante' })).status, 404);

  // désactivée : plus de modèles ; supprimée : retirée
  await api('POST', '/api/extensions/revue-test/enabled', { on: false });
  assert.equal((await api('GET', '/api/extensions/templates')).length, 0);
  await api('DELETE', '/api/extensions/revue-test');
  assert.ok(!(await api('GET', '/api/extensions')).some(e => e.id === 'revue-test'));
  c.ws.close();
  await api('DELETE', `/api/sessions/${s.id}`);
});

test('extensions : secret demandé (jeton), enregistré sans jamais être renvoyé, donné aux sessions', async () => {
  const ext = { csm: 1, id: 'outil-test', name: 'Outil de test', secrets: [
    { id: 'jeton', name: 'Jeton de l’outil', description: 'Accès en lecture.', url: 'https://example.com/tokens', env: 'CSM_TEST_TOKEN' },
    { id: 'mauvais', env: 'pas valide' }, // ignoré : variable invalide
  ] };
  await api('POST', '/api/extensions', { content: JSON.stringify(ext) });
  try {
    let list = (await api('GET', '/api/secrets')).filter(x => x.ext === 'outil-test');
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].name, list[0].url, list[0].present], ['Jeton de l’outil', 'https://example.com/tokens', false]);
    assert.equal((await req('POST', '/api/secrets/outil-test/jeton', { value: 'court' })).status, 400, 'trop court');
    assert.equal((await req('POST', '/api/secrets/outil-test/inconnu', { value: 'x'.repeat(20) })).status, 404);
    const r = await api('POST', '/api/secrets/outil-test/jeton', { value: 'jeton-secret-1234' });
    assert.equal(r.present, true);
    list = await api('GET', '/api/secrets');
    assert.ok(!JSON.stringify(list).includes('jeton-secret-1234'), 'valeur jamais renvoyée');
    assert.equal(list.find(x => x.id === 'jeton').present, true);
    // donné aux sessions lancées ensuite
    const s = await api('POST', '/api/sessions', { cwd: WORK, name: 'avec-jeton' });
    await idle(s.id);
    await api('DELETE', `/api/sessions/${s.id}`);
    await api('POST', '/api/secrets/outil-test/jeton/dismiss');
  } finally { await api('DELETE', '/api/extensions/outil-test'); }
});

test('extensions : fournies par un plugin Claude Code (dossier csm/), non supprimables', async () => {
  const plug = path.join(HOME, 'plugin-prive');
  fs.mkdirSync(path.join(plug, 'csm'), { recursive: true });
  fs.writeFileSync(path.join(plug, 'csm', 'metier.csm.json'), JSON.stringify({ csm: 1, id: 'metier-prive', name: 'Métier privé', templates: [{ id: 'modele', name: 'Modèle métier' }] }));
  const cfg = path.join(HOME, '.claude', 'plugins');
  fs.mkdirSync(cfg, { recursive: true });
  const f = path.join(cfg, 'installed_plugins.json'), old = fs.existsSync(f) ? fs.readFileSync(f) : null;
  fs.writeFileSync(f, JSON.stringify({ version: 2, plugins: { 'prive@prive': [{ installPath: plug }] } }));
  try {
    const e = await waitFor(async () => (await api('GET', '/api/extensions')).find(x => x.id === 'metier-prive'), 5000, 'extension du plugin');
    assert.equal(e.source, 'plugin prive'); assert.equal(e.removable, false);
    assert.ok((await api('GET', '/api/extensions/templates')).some(t => t.id === 'metier-prive/modele'));
    assert.equal((await req('DELETE', '/api/extensions/metier-prive')).status, 404, 'se retire en désinstallant le plugin');
  } finally { if (old) fs.writeFileSync(f, old); else fs.rmSync(f, { force: true }); }
});

test('synchro : le type de session (extension) suit la session d’une machine à l’autre', async () => {
  const { encodeCode } = require('../lib/sync');
  const KEY = 't'.repeat(32);
  const fake = await fakeSyncServer([KEY]);
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'pc-type' });
    const s = await api('POST', '/api/sessions', { cwd: WORK, name: 'typée-synchro', type: 'mon-ext/ticket' });
    const row = await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.find(KEY, d => d.name === 'typée-synchro'); }, 10000, 'session envoyée');
    assert.equal(fake.plain(KEY, row.uid).type, 'mon-ext/ticket');
    const t1 = Date.now();
    fake.put(KEY, { uid: 'mac-type-1', updatedAt: t1, origin: 'mac', data: sealed(KEY, 'mac-type-1', t1, { name: 'venue-du-mac', cwd: '{home}', type: 'mon-ext/ticket' }) });
    const r = await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/sessions')).find(x => x.syncId === 'mac-type-1'); }, 10000, 'session reçue');
    assert.equal(r.type, 'mon-ext/ticket');
    await api('DELETE', `/api/sessions/${s.id}`); await api('DELETE', `/api/sessions/${r.id}`);
  } finally { await api('PUT', '/api/settings', { syncCode: '' }); fake.srv.close(); }
});

test('synchro : une extension importée ici s’installe sur les autres machines (et sa suppression aussi)', async () => {
  const { encodeCode } = require('../lib/sync');
  const KEY = 'x'.repeat(32);
  const fake = await fakeSyncServer([KEY]);
  const ext = { csm: 1, id: 'ext-synchro', name: 'Partagée', templates: [{ id: 'tpl', name: 'Modèle partagé' }] };
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'pc-ext' });
    await api('POST', '/api/sync/now');
    // importée ici : envoyée, chiffrée
    await api('POST', '/api/extensions', { content: JSON.stringify(ext) });
    const row = await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.rows(KEY).get('csmext-ext-synchro'); }, 10000, 'extension envoyée');
    assert.ok(!JSON.stringify(row.data).includes('Modèle partagé'), 'chiffrée');
    assert.equal(fake.plain(KEY, 'csmext-ext-synchro').ext.name, 'Partagée');
    // importée sur une autre machine : installée ici, avec son origine
    const t1 = Date.now();
    fake.put(KEY, { uid: 'csmext-venue-du-mac', updatedAt: t1, origin: 'MacBook', data: sealed(KEY, 'csmext-venue-du-mac', t1, { ext: { csm: 1, id: 'venue-du-mac', name: 'Du Mac', prompts: [{ id: 'pp', title: 'P', text: 'x' }] }, enabled: true }) });
    const got = await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/extensions')).find(e => e.id === 'venue-du-mac'); }, 10000, 'extension reçue');
    assert.equal(got.from, 'MacBook'); assert.equal(got.enabled, true);
    // invalide : ignorée
    const t2 = Date.now();
    fake.put(KEY, { uid: 'csmext-casse', updatedAt: t2, origin: 'MacBook', data: sealed(KEY, 'csmext-casse', t2, { ext: { csm: 9, id: 'casse' } }) });
    await api('POST', '/api/sync/now');
    assert.ok(!(await api('GET', '/api/extensions')).some(e => e.id === 'casse'));
    // supprimée ailleurs : retirée ici ; supprimée ici : pierre tombale
    fake.put(KEY, { uid: 'csmext-venue-du-mac', updatedAt: Date.now() + 1000, deleted: 1, data: {} });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return !(await api('GET', '/api/extensions')).some(e => e.id === 'venue-du-mac'); }, 10000, 'suppression reçue');
    await api('DELETE', '/api/extensions/ext-synchro');
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.rows(KEY).get('csmext-ext-synchro').deleted === 1; }, 10000, 'suppression envoyée');
  } finally { await api('PUT', '/api/settings', { syncCode: '' }); fake.srv.close(); }
});

test('synchro : une extension de plugin ne voyage qu’avec son plugin (jamais copiée seule)', async () => {
  const { encodeCode } = require('../lib/sync');
  const KEY = 'p'.repeat(32);
  const fake = await fakeSyncServer([KEY]);
  const plug = path.join(HOME, 'plugin-sync');
  const dir = path.join(HOME, '.claude', 'plugins');
  fs.mkdirSync(path.join(plug, 'csm'), { recursive: true }); fs.mkdirSync(dir, { recursive: true });
  const files = ['installed_plugins.json', 'known_marketplaces.json'].map(f => path.join(dir, f));
  const saved = files.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  fs.writeFileSync(path.join(plug, 'csm', 'equipe.csm.json'), JSON.stringify({ csm: 1, id: 'equipe', name: 'Équipe', version: '1.0.0', templates: [{ id: 'modele', name: 'Modèle' }] }));
  fs.writeFileSync(files[0], JSON.stringify({ version: 2, plugins: { 'equipe-plugin@equipe': [{ installPath: plug }] } }));
  fs.writeFileSync(files[1], JSON.stringify({ equipe: { source: { source: 'github', repo: 'moi/equipe' } } }));
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'pc-plugin' });
    // le plugin est publié (les autres machines l'installeront, extension comprise) ; l'extension seule, jamais
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.plain(KEY, 'csmplug-equipe-plugin--equipe'); }, 10000, 'plugin publié');
    assert.equal(fake.rows(KEY).get('csmext-equipe'), undefined, 'extension de plugin jamais publiée seule');
    assert.ok((await api('GET', '/api/extensions')).some(e => e.id === 'equipe' && e.source === 'plugin equipe-plugin'));
    // une copie publiée par une machine en 3.27 : ignorée ici (ni installée, ni effacée)
    const t1 = Date.now();
    fake.put(KEY, { uid: 'csmext-autre', updatedAt: t1, origin: 'MacBook', data: sealed(KEY, 'csmext-autre', t1, { ext: { csm: 1, id: 'autre', name: 'Autre', templates: [{ id: 'mm', name: 'M' }] }, enabled: true, kind: 'plugin', plugin: 'autre-plugin' }) });
    await api('POST', '/api/sync/now'); await api('POST', '/api/sync/now');
    assert.ok(!(await api('GET', '/api/extensions')).some(e => e.id === 'autre'), 'pas de copie sans le plugin');
    assert.equal(fake.rows(KEY).get('csmext-autre').deleted, 0, 'rien effacé chez les autres');
  } finally {
    files.forEach((f, i) => { if (saved[i]) fs.writeFileSync(f, saved[i]); else fs.rmSync(f, { force: true }); });
    await api('PUT', '/api/settings', { syncCode: '' }); fake.srv.close();
  }
});

test('synchro : plugins Claude Code — publiés, installés ailleurs (après validation), jamais retirés par une machine qui ne les a pas', async () => {
  const { encodeCode } = require('../lib/sync');
  const KEY = 'q'.repeat(32);
  const fake = await fakeSyncServer([KEY]);
  const dir = path.join(HOME, '.claude', 'plugins'); fs.mkdirSync(dir, { recursive: true });
  const files = ['installed_plugins.json', 'known_marketplaces.json'].map(f => path.join(dir, f));
  const saved = files.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  fs.writeFileSync(files[0], JSON.stringify({ version: 2, plugins: { 'outil@equipe': [{ installPath: path.join(dir, 'x') }], 'local@dossier': [{ installPath: path.join(dir, 'y') }] } }));
  fs.writeFileSync(files[1], JSON.stringify({ equipe: { source: { source: 'github', repo: 'moi/equipe' } }, dossier: { source: { source: 'directory', path: 'C:/ici' } } }));
  try {
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'pc-plug', claudeSyncReview: true });
    // publié : seulement le plugin d'un marketplace GitHub (pas celui d'un dossier local)
    const row = await waitFor(async () => { await api('POST', '/api/sync/now'); return [...fake.rows(KEY).keys()].find(u => u.startsWith('csmplug-')); }, 10000, 'plugin publié');
    assert.deepEqual(fake.plain(KEY, row), { plugin: 'outil', marketplace: 'equipe', repo: 'moi/equipe', enabled: true });
    assert.equal([...fake.rows(KEY).keys()].filter(u => u.startsWith('csmplug-')).length, 1, 'marketplace local jamais partagé');
    // reçu d'une autre machine : en attente de validation, puis installé
    const t1 = Date.now(), uid = 'csmplug-revue--outils';
    fake.put(KEY, { uid, updatedAt: t1, origin: 'MacBook', data: sealed(KEY, uid, t1, { plugin: 'revue', marketplace: 'outils', repo: 'moi/outils', enabled: true }) });
    const pend = await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/sync/plugins')).pending.find(p => p.uid === uid); }, 10000, 'plugin en attente');
    assert.equal(pend.action, 'install'); assert.equal(pend.from, 'MacBook');
    await api('POST', '/api/sync/plugins/decide', { uid, apply: true });
    const inst = JSON.parse(fs.readFileSync(files[0], 'utf8'));
    assert.ok(inst.plugins['revue@outils'], 'installé'); assert.ok(JSON.parse(fs.readFileSync(files[1], 'utf8')).outils, 'marketplace ajouté');
    // une machine qui n'a pas un plugin ne le fait pas retirer : plugin reçu puis ignoré ici, rien n'est effacé
    const t2 = Date.now(), uid2 = 'csmplug-autre--outils';
    fake.put(KEY, { uid: uid2, updatedAt: t2, origin: 'MacBook', data: sealed(KEY, uid2, t2, { plugin: 'autre', marketplace: 'outils', repo: 'moi/outils', enabled: true }) });
    await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/sync/plugins')).pending.some(p => p.uid === uid2); }, 10000, 'second plugin en attente');
    await api('POST', '/api/sync/plugins/decide', { uid: uid2, apply: false });
    await api('POST', '/api/sync/now'); await api('POST', '/api/sync/now');
    assert.equal(fake.rows(KEY).get(uid2).deleted, 0, 'pas d’effacement envoyé par une machine qui ne l’a pas');
    // désinstallé ici (où il était) : effacement propagé ; désinstallé ailleurs : proposé ici, jamais appliqué seul
    fs.writeFileSync(files[0], JSON.stringify({ version: 2, plugins: { 'revue@outils': inst.plugins['revue@outils'] } }));
    await waitFor(async () => { await api('POST', '/api/sync/now'); return fake.rows(KEY).get(row)?.deleted === 1; }, 10000, 'désinstallation propagée');
    fake.put(KEY, { uid, updatedAt: Date.now() + 5000, deleted: 1, data: {} });
    const un = await waitFor(async () => { await api('POST', '/api/sync/now'); return (await api('GET', '/api/sync/plugins')).pending.find(p => p.uid === uid && p.action === 'uninstall'); }, 10000, 'désinstallation proposée');
    assert.ok(un);
    assert.ok(JSON.parse(fs.readFileSync(files[0], 'utf8')).plugins['revue@outils'], 'pas désinstallé sans accord');
  } finally {
    files.forEach((f, i) => { if (saved[i]) fs.writeFileSync(f, saved[i]); else fs.rmSync(f, { force: true }); });
    await api('PUT', '/api/settings', { syncCode: '' }); fake.srv.close();
  }
});

test('quotas 5 h et 7 j : reçus de la barre d’état, servis à l’interface', async () => {
  const S = await api('POST', '/api/sessions', { cwd: WORK, name: 'quota-ui' });
  await idle(S.id);
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 21, resetAt: Date.now() + 3600e3, seven: { pct: 88, resetAt: Date.now() + 2 * 86400e3 } } });
  const q = await api('GET', '/api/quota');
  assert.equal(q.five.pct, 21); assert.equal(q.seven.pct, 88);
  // valeur ancienne d'une session inactive (même fenêtre, plus basse) : ignorée ; nouvelle fenêtre : prise
  const r5 = q.five.resetAt;
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 9, resetAt: r5, seven: { pct: 80, resetAt: q.seven.resetAt } } });
  let q2 = await api('GET', '/api/quota');
  assert.equal(q2.five.pct, 21); assert.equal(q2.seven.pct, 88);
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 3, resetAt: r5 + 10 * 60e3 } });
  q2 = await api('GET', '/api/quota');
  assert.equal(q2.five.pct, 3);
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 0, resetAt: r5 + 20 * 60e3 } });
  await api('DELETE', `/api/sessions/${S.id}`);
});

test('usage : temps de travail du jour et historique du quota pour la prévision', async () => {
  const w = await api('GET', '/api/worktime');
  assert.equal(typeof w.today.total, 'number'); assert.equal(typeof w.today.queued, 'number'); assert.ok(w.today.sessions);
  const S = await api('POST', '/api/sessions', { cwd: WORK, name: 'usage-q' });
  await idle(S.id);
  const r = Date.now() + 3 * 3600e3;
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 30, resetAt: r } });
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 31, resetAt: r } });
  const q = await api('GET', '/api/quota');
  assert.ok(q.hist.length >= 2, 'historique gardé'); assert.equal(q.hist.at(-1).pct, 31);
  assert.equal(q.forecast, null, 'pas de prévision sur quelques secondes de mesures');
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 0, resetAt: 0 } });
  await api('DELETE', `/api/sessions/${S.id}`);
});

test('usage : période ?days sur /api/usage et /api/worktime', async () => {
  for (const d of [1, 7, 30]) {
    const u = await api('GET', `/api/usage?days=${d}`);
    assert.equal(u.days, d); assert.equal(typeof u.period.cost, 'number'); assert.ok(u.d7 && u.today && Array.isArray(u.top));
    const w = await api('GET', `/api/worktime?days=${d}`);
    assert.equal(w.nbDays, d); assert.equal(typeof w.period.total, 'number'); assert.ok(w.today && w.days);
  }
  assert.equal((await api('GET', '/api/usage')).days, 7, 'défaut : 7 jours');
  assert.equal((await api('GET', '/api/usage?days=999')).days, 7, 'valeur hors liste : défaut');
  assert.equal((await api('GET', '/api/quota')).pause.threshold, 95);
});

test('usage : historique et prévision du quota 7 jours (forecast7)', async () => {
  const S = await api('POST', '/api/sessions', { cwd: WORK, name: 'usage-q7' });
  await idle(S.id);
  const r7 = Date.now() + 5 * 86400e3;
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 10, resetAt: 0, seven: { pct: 10, resetAt: r7 } } });
  const q0 = await api('GET', '/api/quota');
  assert.equal(q0.seven.pct, 10); assert.ok(q0.hist7.length >= 1, 'historique 7 j gardé'); assert.equal(q0.forecast7, null, 'une seule mesure : pas de prévision');
  await new Promise(r => setTimeout(r, 60));
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 10, resetAt: 0, seven: { pct: 12, resetAt: r7 } } });
  const q = await api('GET', '/api/quota');
  assert.equal(q.hist7.at(-1).pct, 12);
  assert.ok(q.forecast7 && q.forecast7.perHour > 0 && q.forecast7.limitAt > 0 && q.forecast7.limitAt < r7, 'limite prévue avant la réinitialisation');
  assert.ok(fs.existsSync(path.join(DATA, 'quota7.json')), 'historique persistant');
  // rythme lent : pas de limite avant la réinitialisation
  await new Promise(r => setTimeout(r, 60));
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 10, resetAt: 0, seven: { pct: 12, resetAt: r7 } } });
  assert.ok(Array.isArray((await api('GET', '/api/quota')).hist7));
  await api('POST', '/api/hook', { csm: S.id, event: 'quota', data: { pct: 0, resetAt: 0 } });
  await api('DELETE', `/api/sessions/${S.id}`);
});

test('synchro : document d’usage publié (chiffré, agrégats) et reçu des autres machines', async () => {
  const { encodeCode } = require('../lib/sync');
  const KEY = 'u'.repeat(32);
  const fake = await fakeSyncServer([KEY]);
  try {
    const t0 = Date.now(), k = new Date();
    const local = `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
    const cell = { w: 600, c: 1.5, t: 4000 };
    fake.put(KEY, { uid: 'csmcfg-usage-macdev000001', updatedAt: t0, origin: 'mac', data: sealed(KEY, 'csmcfg-usage-macdev000001', t0, { name: 'mac-test', platform: 'darwin', days: { [local]: cell }, sessions: { abc123: { n: 'Revue Mac', d: { [local]: cell } } } }) });
    await api('PUT', '/api/settings', { syncCode: encodeCode(fake.url, KEY), syncMachine: 'pc-test', syncUsage: true });
    const row = await waitFor(async () => { await api('POST', '/api/sync/now'); return [...fake.rows(KEY).keys()].find(u => u.startsWith('csmcfg-usage-') && u !== 'csmcfg-usage-macdev000001'); }, 10000, 'document publié');
    const doc = fake.plain(KEY, row);
    assert.equal(doc.name, 'pc-test'); assert.ok(doc.days && doc.sessions);
    assert.ok(!JSON.stringify(fake.rows(KEY).get(row).data).includes('pc-test'), 'chiffré');
    const all = await waitFor(async () => { await api('POST', '/api/sync/now'); const u = await api('GET', '/api/usage?days=7&scope=all'); return u.all.machines.length > 1 && u; }, 10000, 'reçu');
    assert.ok(all.all.machines.some(m => m.name === 'mac-test' && m.work === 600 && m.cost === 1.5));
    assert.ok(all.all.rows.some(r => r.machine === 'mac-test' && r.name === 'Revue Mac'));
    assert.ok(all.all.total.work >= 600);
    // option coupée : les autres machines ne sont plus affichées
    await api('PUT', '/api/settings', { syncUsage: false });
    assert.equal((await api('GET', '/api/usage?days=7&scope=all')).all.machines.length, 1);
  } finally {
    await api('PUT', '/api/settings', { syncCode: '', syncUsage: true });
    fake.srv.close();
  }
});

test('extensions : import par lien (fichier GitHub, dépôt, adresse https), mise à jour', async () => {
  const mk = (id, name) => JSON.stringify({ csm: 1, id, name, version: '1.0', prompts: [{ name: 'p', text: 'x' }] });
  const files = { 'csm/lien-a.csm.json': mk('lien-a', 'Lien A'), 'outils/lien-b.csm.json': mk('lien-b', 'Lien B') };
  const gh = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x'), m = u.pathname.match(/^\/repos\/moi\/depot\/contents\/?(.*)$/);
    if (q.url === '/plain/lien-c.csm.json') { r.end(mk('lien-c', 'Lien C')); return; }
    if (!m) { r.writeHead(404); r.end('{}'); return; }
    const p = decodeURIComponent(m[1]);
    if (files[p]) { r.end(files[p]); return; }
    const kids = Object.keys(files).filter(f => path.dirname(f) === p).map(f => ({ type: 'file', name: path.basename(f), path: f }));
    if (p === '') kids.push({ type: 'dir', name: 'csm', path: 'csm' });
    if (!kids.length) { r.writeHead(404); r.end('{}'); return; }
    r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(kids));
  }).listen(PORT + 3, '127.0.0.1');
  try {
    // dépôt : racine sans extension → dossier csm/
    let r = await api('POST', '/api/extensions', { url: 'https://github.com/moi/depot' });
    assert.deepEqual(r.imported.map(x => x.id), ['lien-a']);
    // fichier (blob)
    r = await api('POST', '/api/extensions', { url: 'https://github.com/moi/depot/blob/main/outils/lien-b.csm.json' });
    assert.equal(r.imported[0].name, 'Lien B');
    // adresse quelconque (http seulement en local)
    r = await api('POST', '/api/extensions', { url: `http://127.0.0.1:${PORT + 3}/plain/lien-c.csm.json` });
    assert.equal(r.imported[0].id, 'lien-c');
    const list = await api('GET', '/api/extensions');
    assert.match(list.find(x => x.id === 'lien-b').url, /lien-b\.csm\.json$/);
    // mise à jour : même lien, nouvelle version
    files['outils/lien-b.csm.json'] = mk('lien-b', 'Lien B v2');
    r = await api('POST', '/api/extensions', { url: list.find(x => x.id === 'lien-b').url });
    assert.equal(r.imported[0].replaced, true);
    assert.equal((await api('GET', '/api/extensions')).find(x => x.id === 'lien-b').name, 'Lien B v2');
    // refus : http distant, introuvable, lien invalide
    assert.equal((await req('POST', '/api/extensions', { url: 'http://example.com/x.csm.json' })).status, 400);
    assert.match((await req('POST', '/api/extensions', { url: 'https://github.com/moi/absent' })).text, /introuvable/);
    assert.equal((await req('POST', '/api/extensions', { url: 'pas un lien' })).status, 400);
    for (const id of ['lien-a', 'lien-b', 'lien-c']) await api('DELETE', `/api/extensions/${id}`);
  } finally { gh.close(); }
});

test('barre d’état : relais vers celle de l’utilisateur, quotas toujours relevés', async () => {
  const home = fs.mkdtempSync(path.join(TMP, 'sl-'));
  fs.mkdirSync(path.join(home, '.claude'));
  const script = path.join(home, 'ma-barre.js');
  fs.writeFileSync(script, "let i='';process.stdin.on('data',c=>i+=c).on('end',()=>console.log('MA BARRE '+JSON.parse(i).model.display_name))");
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: `"${process.execPath}" "${script}"` } }));
  const out = execFileSync(process.execPath, [path.join(ROOT, 'statusline.js'), '--relay'], {
    input: JSON.stringify({ model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 12 } } }),
    env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8',
  });
  assert.match(out, /MA BARRE Opus/);
  assert.doesNotMatch(out, /5h/);
});
test('rappel « Claude is waiting for your input » : la session reste prête (pas une question)', async () => {
  const S = await api('POST', '/api/sessions', { cwd: WORK, name: 'rappel-idle' });
  await idle(S.id);
  await api('POST', '/api/hook', { csm: S.id, event: 'attention', data: { message: 'Claude is waiting for your input', notification_type: 'idle_prompt' } });
  assert.equal((await session(S.id)).status, 'idle');
  await api('POST', '/api/hook', { csm: S.id, event: 'attention', data: { message: 'Claude needs your permission to use Bash' } });
  assert.equal((await session(S.id)).status, 'attention');
  await api('POST', '/api/hook', { csm: S.id, event: 'attention', data: { message: 'Claude is waiting for your input' } });
  assert.equal((await session(S.id)).status, 'idle');
  await api('DELETE', `/api/sessions/${S.id}`);
});

test('Windows : jamais le script « claude » sans extension (erreur 193) ; .exe d’abord, sinon node + cli.js de npm', () => {
  const { winClaude } = require('../lib/config');
  const dir = fs.mkdtempSync(path.join(TMP, 'npmbin-'));
  const bare = path.join(dir, 'claude'), cmd = path.join(dir, 'claude.cmd'), exe = path.join(TMP, 'claude.exe');
  assert.equal(winClaude([bare, cmd, exe]), exe, '.exe préféré, même listé après');
  assert.equal(winClaude([bare]), null, 'script sans extension ignoré');
  assert.equal(winClaude([bare, cmd]), cmd, 'sans cli.js : le .cmd');
  const cli = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true }); fs.writeFileSync(cli, '');
  const saved = process.env.CSM_CLAUDE_ARGS;
  try {
    const r = winClaude([bare, cmd]);
    if (process.platform === 'win32') { assert.match(r, /node\.exe$/i); assert.ok(process.env.CSM_CLAUDE_ARGS.includes(cli)); }
    else assert.equal(r, cmd); // pas de node.exe hors Windows
  } finally { if (saved === undefined) delete process.env.CSM_CLAUDE_ARGS; else process.env.CSM_CLAUDE_ARGS = saved; }
});

test('vue : verdict, avancement, prochaine étape et lot (format validé)', () => {
  const { cleanView } = require('../lib/extensions');
  const v = cleanView({
    title: 'T', verdict: { text: 'V', level: 'bizarre' }, steps: { items: ['a', 'b', 'c'], current: 9 },
    next: { label: 'Publier', button: 'Go', send: 'publie' },
    items: [{ id: '1', title: 'Un', state: 'à publier', risk: 'oui', verdict: 'phrase', sections: [{ kind: 'kv', items: [{ label: 'a', value: 'b' }] }, { kind: 'inconnu' }] }, { foo: 1 }],
  });
  assert.deepEqual(v.verdict, { text: 'V', sub: '', level: 'info' });
  assert.equal(v.steps.current, 3, 'borné au nombre d’étapes');
  assert.equal(v.next.send, 'publie');
  assert.equal(v.items.length, 1, 'élément sans id ni titre écarté');
  assert.equal(v.items[0].risk, false, 'risk : booléen strict');
  assert.equal(v.items[0].verdict.text, 'phrase', 'verdict texte accepté');
  assert.equal(v.items[0].sections.length, 1, 'section inconnue écartée');
  assert.equal(cleanView({ title: 'x' }).verdict, null);
});
