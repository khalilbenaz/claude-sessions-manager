// Tests du Worker de synchro sur un vrai runtime local (wrangler dev : D1 et R2 locaux, dossier temporaire).
// npm test (dans sync-worker/) ; aussi lancé par GitHub Actions avant chaque déploiement.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
// wrangler lancé par node directement : même commande sous Linux, macOS et Windows
const WRANGLER = process.execPath, W = path.join(DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const PORT = 8800 + Math.floor(Math.random() * 500);
const U = `http://127.0.0.1:${PORT}`;
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-worker-'));
let dev;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
async function space() {
  const key = crypto.randomBytes(16).toString('hex');
  const r = await fetch(U + '/spaces', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': crypto.randomBytes(4).join('.') }, body: JSON.stringify({ auth: sha(key) }) });
  assert.equal(r.status, 200, 'espace créé');
  const H = { authorization: 'Bearer ' + key };
  const j = async (method, p, body) => {
    const res = await fetch(U + p, { method, headers: { ...H, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const putPart = (uid, ver, n, buf) => fetch(`${U}/transcripts/${uid}/${ver}/${n}`, { method: 'PUT', headers: H, body: buf });
  const getPart = (uid, ver, n) => fetch(`${U}/transcripts/${uid}/${ver}/${n}`, { headers: H });
  return { key, H, j, putPart, getPart };
}
const sql = cmd => JSON.parse(execFileSync(WRANGLER, [W, 'd1', 'execute', 'csm-sync', '--local', '--persist-to', STATE, '--json', '--command', cmd], { cwd: DIR, encoding: 'utf8' }))[0].results;
const usage = key => sql(`SELECT bytes FROM csm_usage WHERE space = '${sha(key)}'`)[0]?.bytes || 0;
const V = c => c.repeat(32);

before(async () => {
  execFileSync(WRANGLER, [W, 'd1', 'execute', 'csm-sync', '--local', '--persist-to', STATE, '--file', 'schema.sql'], { cwd: DIR, stdio: 'ignore' });
  dev = spawn(WRANGLER, [W, 'dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', STATE, '--test-scheduled', '--show-interactive-dev-session=false'], { cwd: DIR, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(U + '/health')).ok) return; } catch { }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('wrangler dev ne répond pas');
});
after(() => { dev?.kill(); try { fs.rmSync(STATE, { recursive: true, force: true }); } catch { } }); // Windows : fichiers encore verrouillés

test('conversation : envoi, relecture, nouvelle version, suppression de la session', async () => {
  const s = await space(), uid = 'sess-aaaaaa', blob = crypto.randomBytes(300000);
  for (const n of [0, 1]) assert.equal((await s.putPart(uid, V('a'), n, blob)).status, 200);
  assert.equal((await s.j('PUT', `/transcripts/${uid}`, { cid: 'c', ver: V('a'), chunks: 3, updatedAt: 1 })).status, 409, 'morceau manquant');
  const ok = await s.j('PUT', `/transcripts/${uid}`, { cid: 'c', ver: V('a'), chunks: 2, size: 1, updatedAt: 1 });
  assert.equal(ok.body.applied, true);
  const list = (await s.j('GET', '/transcripts')).body.items;
  assert.equal(list[0].size, 600000, 'taille comptée par le serveur, pas celle annoncée');
  assert.ok(Buffer.from(await (await s.getPart(uid, V('a'), 1)).arrayBuffer()).equals(blob), 'morceau relu identique');
  assert.equal(usage(s.key), 600000);

  await s.putPart(uid, V('b'), 0, blob);
  assert.equal((await s.j('PUT', `/transcripts/${uid}`, { cid: 'c', ver: V('b'), chunks: 1, updatedAt: 2 })).body.applied, true);
  assert.equal((await s.getPart(uid, V('a'), 0)).status, 404, 'ancienne version effacée de R2');
  assert.equal(usage(s.key), 300000, 'place libérée');

  // version plus ancienne refusée : ses morceaux sont retirés
  await s.putPart(uid, V('c'), 0, blob);
  assert.equal((await s.j('PUT', `/transcripts/${uid}`, { cid: 'c', ver: V('c'), chunks: 1, updatedAt: 1 })).body.applied, false);
  assert.equal((await s.getPart(uid, V('c'), 0)).status, 404);
  assert.equal(usage(s.key), 300000);

  assert.equal((await s.j('POST', '/sessions', { items: [{ uid, data: {}, updatedAt: 5, deleted: true }] })).status, 200);
  assert.equal((await s.j('GET', '/transcripts')).body.items.length, 0);
  assert.equal((await s.getPart(uid, V('b'), 0)).status, 404, 'morceaux supprimés');
  assert.equal(usage(s.key), 0);
});

test('accès : clé inconnue refusée, espaces isolés, ancienne création de code retirée', async () => {
  const a = await space(), b = await space(), blob = crypto.randomBytes(1000);
  await a.putPart('sess-bbbbbb', V('d'), 0, blob);
  assert.equal((await b.getPart('sess-bbbbbb', V('d'), 0)).status, 404, 'un autre espace ne lit pas');
  assert.equal((await fetch(`${U}/transcripts`, { headers: { authorization: 'Bearer ' + 'z'.repeat(32) } })).status, 401);
  assert.equal((await fetch(U + '/spaces', { method: 'POST' })).status, 410);
  assert.equal((await fetch(`${U}/transcripts/..%2Fx/${V('d')}/0`, { headers: a.H })).status, 400, 'uid invalide');
});

test('limites : morceaux en attente plafonnés, place comptée à la réception', async () => {
  const s = await space(), small = crypto.randomBytes(10);
  let last;
  for (let i = 0; i < 201; i++) last = await s.putPart('sess-' + String(i).padStart(6, '0'), V('e'), 0, small);
  assert.equal(last.status, 429, 'au-delà de 200 morceaux non validés');
  assert.equal(usage(s.key), 2000, 'les morceaux en attente comptent');
  // réécrire le même morceau ne compte pas deux fois
  await s.putPart('sess-000000', V('e'), 0, crypto.randomBytes(30));
  assert.equal(usage(s.key), 2020);
});

test('ménage nocturne : morceaux en attente depuis plus d’une heure retirés, place recalculée', async () => {
  const s = await space();
  await s.putPart('sess-cccccc', V('f'), 0, crypto.randomBytes(500));
  sql(`UPDATE csm_parts SET at = 0 WHERE space = '${sha(s.key)}'`);
  sql(`UPDATE csm_usage SET bytes = 99999 WHERE space = '${sha(s.key)}'`); // dérive simulée
  assert.equal((await fetch(U + '/__scheduled?cron=17+3+*+*+*')).status, 200);
  assert.equal((await s.getPart('sess-cccccc', V('f'), 0)).status, 404);
  assert.equal(usage(s.key), 0, 'recalculé depuis les morceaux présents');
});

test('sessions : pagination par 1000, plafond de lignes exact', async () => {
  const s = await space();
  for (let k = 0; k < 3; k++) {
    const items = Array.from({ length: 400 }, (_, i) => ({ uid: `row-${k}-${String(i).padStart(4, '0')}`, data: { i }, updatedAt: 1 }));
    assert.equal((await s.j('POST', '/sessions', { items })).status, 200);
  }
  const p1 = (await s.j('GET', '/sessions?since=0')).body;
  assert.equal(p1.items.length, 1000);
  assert.equal(p1.rev, p1.items.at(-1).rev, 'curseur = dernière ligne de la page');
  const p2 = (await s.j('GET', `/sessions?since=${p1.rev}`)).body;
  assert.equal(p2.items.length, 200, 'la suite arrive');
});

test('espace : place occupée, puis effacement complet (changement de code)', async () => {
  const s = await space(), blob = crypto.randomBytes(5000);
  await s.putPart('sess-dddddd', V('a'), 0, blob);
  await s.j('PUT', '/transcripts/sess-dddddd', { cid: 'c', ver: V('a'), chunks: 1, updatedAt: 1 });
  await s.j('POST', '/sessions', { items: [{ uid: 'sess-dddddd', data: {}, updatedAt: 1 }] });
  const u = (await s.j('GET', '/usage')).body;
  assert.deepEqual([u.bytes, u.sessions, u.transcripts], [5000, 1, 1]);
  assert.equal(u.max, 1024 * 1024 * 1024, 'limite : 1 Gio par espace');
  assert.deepEqual(u.parts, { conversations: { n: 1, bytes: 5000 } }, 'détail par catégorie');
  const other = await space();
  await other.putPart('sess-eeeeee', V('a'), 0, blob);
  assert.equal((await s.j('DELETE', '/space')).status, 200);
  assert.equal((await s.j('GET', '/usage')).status, 401, 'ancien code refusé');
  assert.equal(sql(`SELECT COUNT(*) c FROM csm_parts WHERE space = '${sha(s.key)}'`)[0].c, 0);
  assert.equal((await other.getPart('sess-eeeeee', V('a'), 0)).status, 200, 'les autres espaces ne bougent pas');
});

test('temps réel : les autres machines de l’espace sont prévenues, pas l’auteur ni les autres espaces', async () => {
  const s = await space(), other = await space();
  const cA = crypto.randomBytes(8).toString('hex'), cB = crypto.randomBytes(8).toString('hex');
  const live = (sp, c) => new Promise((res, rej) => {
    const ws = new WebSocket(U.replace('http', 'ws') + '/live', { headers: { ...sp.H, 'x-csm-client': c } });
    ws.got = 0; ws.onmessage = e => { if (e.data === 'changed') ws.got++; };
    ws.onopen = () => res(ws); ws.onerror = () => rej(new Error('connexion /live refusée'));
  });
  const a = await live(s, cA), b = await live(s, cB), o = await live(other, cA);
  const r = await fetch(U + '/sessions', { method: 'POST', headers: { ...s.H, 'content-type': 'application/json', 'x-csm-client': cA }, body: JSON.stringify({ items: [{ uid: 'live-aaaaaa', data: {}, updatedAt: 1 }] }) });
  assert.equal(r.status, 200);
  for (let i = 0; i < 50 && !b.got; i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(b.got, 1, 'autre machine prévenue');
  assert.equal(a.got, 0, 'l’auteur ne l’est pas');
  assert.equal(o.got, 0, 'autre espace jamais prévenu');
  // rien d'appliqué (version plus ancienne) : personne n'est prévenu
  await fetch(U + '/sessions', { method: 'POST', headers: { ...s.H, 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ uid: 'live-aaaaaa', data: {}, updatedAt: 0 }] }) });
  await new Promise(r => setTimeout(r, 500));
  assert.equal(b.got, 1);
  await assert.rejects(live({ H: { authorization: 'Bearer ' + 'x'.repeat(32) } }, cB), /refusée/, 'code inconnu refusé');
  for (const w of [a, b, o]) w.close();
});
