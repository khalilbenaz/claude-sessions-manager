'use strict';
// Premier lancement sur une machine neuve : Claude Code absent, installé pendant que l'app tourne, puis
// pas connecté à un compte. Instance isolée (port et dossiers temporaires), fenêtre invisible.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PORT = 7800 + Math.floor(Math.random() * 80);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-firstrun-'));
const HOME = path.join(TMP, 'home'), DATA = path.join(TMP, 'data'), BIN = path.join(TMP, 'bin');
// « claude » pas encore installé : son futur emplacement (copie de node, qui lance le faux claude)
const CLAUDE = path.join(BIN, process.platform === 'win32' ? 'claude.exe' : 'claude');
fs.mkdirSync(HOME, { recursive: true });
const env = {
  ...process.env, CSM_PORT: String(PORT), CSM_DATA: DATA, CSM_SECRETS_FILE_ONLY: '1', HOME, USERPROFILE: HOME,
  CSM_HIDE_WINDOW: '1', CSM_CLAUDE: CLAUDE, CSM_CLAUDE_ARGS: `"${path.join(__dirname, 'fake-claude.js')}"`,
  CSM_DEFAULT_SYNC_SERVER: 'http://127.0.0.1:9', CSM_SYS_LANG: 'fr',
};
for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|ELECTRON_RUN_AS_NODE)/.test(k)) delete env[k];

let app, win;
before(async () => {
  app = await electron.launch({ args: [ROOT], env, timeout: 60000 });
  win = await app.firstWindow();
  await win.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
});
after(async () => {
  // comme test/app.test.js : l'app quittée explicitement, puis le serveur détaché arrêté
  try { await Promise.race([app.evaluate(({ app: a }) => { a.exit(0); }), new Promise(r => setTimeout(r, 3000))]); } catch { }
  try { app?.process().kill(); } catch { }
  try { process.kill(Number(fs.readFileSync(path.join(DATA, 'server.pid'), 'utf8'))); } catch { }
  await new Promise(r => setTimeout(r, 800));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { } // Windows : fichiers encore ouverts
});

test('machine neuve : Claude Code à installer, trouvé sans redémarrer, puis connexion depuis l’app', async () => {
  // assistant (dans la langue de la machine : français ou anglais) : Claude Code absent, commande d'installation proposée
  await win.waitForSelector('#dlgWelcome[open] #welcomeCheck .fix code', { timeout: 30000 });
  assert.match(await win.textContent('#welcomeCheck'), /pas installé|not installed/);
  assert.match(await win.textContent('#welcomeCheck code'), /claude\.ai\/install/);
  // installé pendant que l'app tourne : « Vérifier de nouveau » le trouve
  fs.mkdirSync(BIN, { recursive: true });
  fs.copyFileSync(process.execPath, CLAUDE);
  await win.click('#welcomeCheck [data-a=recheck]');
  await win.waitForFunction(() => /Claude Code 0\.0\.0/.test(document.querySelector('#welcomeCheck').textContent), null, { timeout: 20000 });
  // pas connecté : connexion depuis l'app (code collé), puis vérifié de nouveau tout seul
  assert.match(await win.textContent('#welcomeCheck'), /pas connecté|not signed in/);
  await win.click('#welcomeCheck [data-a=login]');
  await win.waitForSelector('#dlgAuth[open] #authCodeRow:not([hidden])', { timeout: 20000 });
  await win.fill('#authCode', 'CODE-OK');
  await win.click('#authCodeSend');
  await win.waitForFunction(() => /réussie|connecté|Connecté/i.test(document.querySelector('#authStep').textContent), null, { timeout: 20000 }).catch(() => { });
  await win.evaluate(() => document.querySelector('#dlgAuth').close());
  await win.waitForFunction(() => /✓ (Connecté à Claude|Signed in to Claude)/.test(document.querySelector('#welcomeCheck').textContent), null, { timeout: 20000 });
  assert.equal(await win.$('#welcomeCheck [data-a=recheck]'), null, 'plus rien à faire');
});
