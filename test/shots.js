'use strict';
// Captures de l'interface (vérification visuelle, pas un test) : node test/shots.js <dossier>
// Instance isolée (port, profil et données temporaires) avec le faux claude ; ne touche à aucune autre instance.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const OUT = path.resolve(process.argv[2] || 'shots');
const ROOT = path.join(__dirname, '..');
const PORT = 19900 + Math.floor(Math.random() * 90);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-shots-'));
const HOME = path.join(TMP, 'home'), DATA = path.join(TMP, 'data'), WORK = path.join(TMP, 'projet');
for (const d of [HOME, DATA, WORK, OUT]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ onboarded: true, lang: 'fr', autoUpdate: false, theme: 'dark', groupList: 'Travail\nPerso' }));
const env = {
  ...process.env, CSM_PORT: String(PORT), CSM_DATA: DATA, HOME, USERPROFILE: HOME,
  CSM_HIDE_WINDOW: '1', CSM_CLAUDE: process.execPath, CSM_CLAUDE_ARGS: `"${path.join(__dirname, 'fake-claude.js')}"`,
};
for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|ELECTRON_RUN_AS_NODE)/.test(k)) delete env[k];

(async () => {
  const app = await electron.launch({ args: [ROOT], env, timeout: 60000 });
  const win = await app.firstWindow();
  try {
    await win.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.evaluate(() => window.dispatchEvent(new Event('resize'))); // comme un vrai redimensionnement de fenêtre
    for (const [name, group] of [['CSM — synchro', 'Travail'], ['CSM — refonte', 'Travail'], ['KTV Flutter', 'Perso']]) {
      await win.evaluate(([cwd, name, group]) => api('POST', '/api/sessions', { cwd, name, group }), [WORK, name, group]);
    }
    await win.waitForFunction(() => [...sessions.values()].filter(s => s.status === 'idle').length >= 3, null, { timeout: 90000 });
    const id = await win.evaluate(() => [...sessions.values()].find(s => s.name === 'CSM — synchro').id);
    await win.evaluate(id => { select(id); send({ t: 'input', id, d: 'la synchro perd le contexte\r' }); }, id);
    await win.evaluate(id => api('POST', '/api/hook', { csm: id, event: 'quota', data: { pct: 20, resetAt: Date.now() + 7740e3, seven: { pct: 90, resetAt: Date.now() + 2 * 86400e3 } } }), id);
    await new Promise(r => setTimeout(r, 2500));
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('csm:quota')));
    await new Promise(r => setTimeout(r, 800));
    await win.screenshot({ path: path.join(OUT, 'main-dark.png') });
    await win.evaluate(() => saveSettings({ theme: 'light' }));
    await new Promise(r => setTimeout(r, 1200));
    await win.screenshot({ path: path.join(OUT, 'main-light.png') });
    await win.evaluate(() => saveSettings({ theme: 'dark' }));
    await new Promise(r => setTimeout(r, 600));
    await win.click('#btnNew'); await new Promise(r => setTimeout(r, 600));
    await win.screenshot({ path: path.join(OUT, 'new-dark.png') });
    await win.keyboard.press('Escape');
    await win.evaluate(() => window.csmFeatures.openSettings('sync')); await new Promise(r => setTimeout(r, 600));
    await win.screenshot({ path: path.join(OUT, 'settings-dark.png') });
    await win.evaluate(() => document.querySelector('#dlgSettings').close());
    for (const extra of (process.argv[3] || '').split(',').filter(Boolean)) {
      await win.evaluate(code => eval(code), fs.readFileSync(extra, 'utf8')); // étapes supplémentaires (fichier JS évalué dans la page)
      await new Promise(r => setTimeout(r, 1200));
      await win.screenshot({ path: path.join(OUT, path.basename(extra, '.js') + '.png') });
    }
  } finally {
    try { app.process().kill(); } catch { }
    try { process.kill(Number(fs.readFileSync(path.join(DATA, 'server.pid'), 'utf8'))); } catch { }
    await new Promise(r => setTimeout(r, 800));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { }
  }
  console.log('captures :', OUT);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
