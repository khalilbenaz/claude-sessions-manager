'use strict';
// Test de bout en bout de l'application Electron (Playwright) avec le faux claude.
// Lancer : npm run test:app
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = 19000 + Math.floor(Math.random() * 900);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-app-'));
const HOME = path.join(TMP, 'home'), DATA = path.join(TMP, 'data'), WORK = path.join(TMP, 'projet');
for (const d of [HOME, DATA, WORK]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ onboarded: true, lang: 'fr', autoUpdate: false }));

const env = {
  ...process.env, CSM_PORT: String(PORT), CSM_DATA: DATA, HOME, USERPROFILE: HOME,
  CSM_HIDE_WINDOW: '1', CSM_CLAUDE: process.execPath, CSM_CLAUDE_ARGS: `"${path.join(__dirname, 'fake-claude.js')}"`,
};
for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|ELECTRON_RUN_AS_NODE)/.test(k)) delete env[k];

let app, win;
before(async () => {
  app = await electron.launch({ args: [ROOT], env, timeout: 60000 });
  win = await app.firstWindow();
  // au 1er lancement, la page peut se recharger une fois (langue du système ≠ réglage) : attendre qu'elle soit prête
  await win.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
  await new Promise(r => setTimeout(r, 500));
  await win.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
});
after(async () => {
  // l'app reste dans la barre des tâches quand la fenêtre est fermée : on la quitte explicitement
  try { await Promise.race([app.evaluate(({ app: a }) => { a.exit(0); }), new Promise(r => setTimeout(r, 3000))]); } catch { }
  try { app?.process().kill(); } catch { }
  // le serveur est détaché de l'app (il survit volontairement) : on l'arrête ici
  try { process.kill(Number(fs.readFileSync(path.join(DATA, 'server.pid'), 'utf8'))); } catch { }
  await new Promise(r => setTimeout(r, 800));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { }
});

test('fenêtre isolée : pas d’accès Node dans la page', async () => {
  assert.equal(await win.evaluate(() => typeof require), 'undefined');
  assert.equal(await win.evaluate(() => typeof process), 'undefined');
  assert.equal(await win.evaluate(() => typeof window.csmNative.pickFolder), 'function');
});

test('créer une session depuis l’interface et échanger', async () => {
  await win.click('#btnNew');
  await win.fill('#formNew [name=cwd]', WORK);
  await win.fill('#formNew [name=name]', 'e2e');
  await win.click('#formNew button[value=ok]');
  await win.waitForFunction(() => [...sessions.values()].some(s => s.name === 'e2e' && s.status === 'idle'), null, { timeout: 60000 });
  await win.click('.term.show');
  await win.keyboard.type('bonjour e2e');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => { const tt = terms.get(active); const b = tt.term.buffer.active; for (let y = 0; y < b.length; y++) if (b.getLine(y).translateToString().includes('echo: bonjour e2e')) return true; return false; }, null, { timeout: 45000 });
});

test('vue partagée et palette', async () => {
  await win.evaluate(() => api('POST', '/api/sessions', { cwd: document.querySelector('#formNew [name=cwd]').value, name: 'deuxième' }));
  await win.waitForFunction(() => sessions.size >= 2);
  await win.click('[data-layout="2c"]');
  await win.waitForFunction(() => visibleIds().length === 2);
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await win.waitForSelector('#dlgPalette[open]');
  await win.keyboard.type('deux');
  const first = await win.textContent('#palList li.sel .pl');
  assert.match(first, /deuxième|Disposition/);
  await win.keyboard.press('Escape');
});

test('fermer la fenêtre ne coupe pas les sessions', async () => {
  await win.evaluate(() => window.close());
  await new Promise(r => setTimeout(r, 800));
  const token = fs.readFileSync(path.join(DATA, 'token'), 'utf8').trim();
  const r = await fetch(`http://127.0.0.1:${PORT}/api/sessions`, { headers: { 'X-CSM-Token': token } });
  const list = await r.json();
  assert.ok(list.filter(s => s.alive).length >= 2, 'sessions toujours actives');
});
