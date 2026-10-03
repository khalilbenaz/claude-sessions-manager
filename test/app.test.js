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

test('menu clic droit du terminal : tient dans une fenêtre basse et défile', async () => {
  await win.setViewportSize({ width: 900, height: 420 });
  const id = await win.evaluate(() => active);
  await win.evaluate(id => showMenu(terminalItems(id), 300, 200), id);
  const r = await win.evaluate(() => { const m = document.querySelector('#ctx'), b = m.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, scroll: m.scrollHeight > m.clientHeight, h: innerHeight }; });
  assert.ok(r.top >= 0 && r.bottom <= r.h, `menu dans la fenêtre (${r.top}-${r.bottom} / ${r.h})`);
  assert.ok(r.scroll, 'menu défilant');
  await win.evaluate(() => { const m = document.querySelector('#ctx'); m.lastElementChild.scrollIntoView(); });
  assert.ok(await win.isVisible('#ctx button:last-child'), 'dernier élément atteignable');
  await win.evaluate(() => hideMenu());
  await win.setViewportSize({ width: 1280, height: 800 });
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

test('groupes : créer un groupe vide, y glisser une session, le renommer, le supprimer', async () => {
  await win.click('#btnNewGroup');
  await win.waitForSelector('#dlgRename[open]');
  await win.fill('#renInput', 'Clients');
  await win.click('#dlgRename button[value=ok]');
  // groupe vide visible, avec sa zone de dépôt
  await win.waitForFunction(() => [...document.querySelectorAll('#list li.ghead.empty .gname')].some(x => x.textContent === 'Clients'));
  const src = await win.evaluate(() => [...sessions.values()].find(s => s.name === 'e2e').id);
  await win.dragAndDrop(`#list li[data-id="${src}"]`, '#list li.gempty');
  await win.waitForFunction(id => sessions.get(id).group === 'Clients', src, { timeout: 15000 });
  await win.waitForFunction(() => !document.querySelector('#list li.gempty'));
  // menu « Déplacer vers le groupe » : retour dans « Sans groupe »
  await win.evaluate(id => showMenu(moveItems(id), 50, 50), src);
  await win.click('#ctx button:has-text("Sans groupe")');
  await win.waitForFunction(id => !sessions.get(id).group, src);
  // renommer par le bouton ✎ du titre (groupe vide : il reste déclaré sous son nouveau nom)
  const head = n => `#list li.ghead:has(.gname:text-is("${n}"))`;
  await win.hover(head('Clients'));
  await win.click(`${head('Clients')} .gren`);
  await win.waitForSelector('#dlgRename[open]');
  await win.fill('#renInput', 'Clients 2');
  await win.click('#dlgRename button[value=ok]');
  await win.waitForFunction(() => groupNames().includes('Clients 2') && !groupNames().includes('Clients'));
  // supprimer par le bouton ✕ : il disparaît
  await win.hover(head('Clients 2'));
  await win.click(`${head('Clients 2')} .gdel`);
  await win.waitForFunction(() => !groupNames().includes('Clients 2'));
});

test('synchro : créer un code l’affiche en clair, prêt à copier', async () => {
  const http = require('http');
  const auths = new Set(), sha = x => require('crypto').createHash('sha256').update(x).digest('hex');
  const srv = http.createServer((q, r) => {
    const send = (c, v) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(v)); };
    let b = ''; q.on('data', c => { b += c; });
    q.on('end', () => {
      if (q.method === 'POST' && q.url === '/spaces') { auths.add(JSON.parse(b || '{}').auth); return send(200, { ok: true }); }
      if (!auths.has(sha((q.headers.authorization || '').replace(/^Bearer /, '')))) return send(401, {});
      send(200, q.method === 'GET' ? (q.url.startsWith('/transcripts') ? { items: [] } : { rev: 0, items: [] }) : { rev: 0, applied: 0 });
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    await win.evaluate(url => saveSettings({ syncServer: url, syncCode: '' }), `http://127.0.0.1:${srv.address().port}`);
    await win.evaluate(() => window.csmFeatures.openSettings('sync'));
    await win.waitForSelector('#syncSetup:not([hidden])');
    assert.equal(await win.isHidden('#syncOn'), true);
    await win.click('#syncNew');
    await win.waitForSelector('#syncOn:not([hidden])');
    assert.match(await win.textContent('#syncCodeShow'), /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(await win.isHidden('#syncSetup'), true);
    await win.waitForFunction(() => /✓/.test(document.querySelector('#syncStatus').textContent));
    if (process.env.CSM_SHOT) await win.screenshot({ path: process.env.CSM_SHOT });
    await win.evaluate(() => { window.confirm = () => true; });
    await win.click('#syncOff');
    await win.waitForSelector('#syncSetup:not([hidden])');
  } finally {
    await win.evaluate(() => { saveSettings({ syncServer: '', syncCode: '' }); document.querySelector('#dlgSettings').close(); });
    srv.close();
  }
});

test('réglages : mémoire au choix, demandes programmées, fichiers reçus', async () => {
  try {
    await win.evaluate(() => window.csmFeatures.openSettings('general'));
    await win.waitForSelector('input[name=memoryEngine][value=native]');
    assert.equal(await win.isChecked('input[name=memoryEngine][value=native]'), true, 'mémoire intégrée cochée');
    assert.equal(await win.isChecked('[data-set=queueQuotaPause]'), true);
    await win.click('.setNav [data-st=schedules]');
    await win.waitForSelector('#schForm');
    await win.fill('#schForm [name=name]', 'Revue du matin');
    await win.fill('#schForm [name=text]', 'relis le dépôt');
    await win.fill('#schForm [name=time]', '08:15');
    await win.check('#schForm [name=day][value="1"]');
    assert.equal(await win.isHidden('#schForm [data-for=once]'), true, 'date masquée quand des jours sont choisis');
    await win.click('#schForm button[type=submit]');
    await win.waitForFunction(() => /Revue du matin/.test(document.querySelector('#schList').textContent));
    assert.match(await win.textContent('#schList'), /08:15 · lun/);
    if (process.env.CSM_SHOT) await win.screenshot({ path: process.env.CSM_SHOT.replace(/(\.png)?$/, '-programmees.png') });
    await win.click('#schList [data-a=del]');
    await win.waitForFunction(() => /Aucune demande/.test(document.querySelector('#schList').textContent));
    await win.click('.setNav [data-st=sync]');
    assert.equal(await win.isChecked('[data-set=claudeSyncReview]'), true, 'validation demandée par défaut');
    // mémoire : fiches de la session e2e, recherche, détail
    await win.click('.setNav [data-st=memory]');
    await win.waitForFunction(() => document.querySelectorAll('#memList li').length > 0);
    if (process.env.CSM_SHOT) await win.screenshot({ path: process.env.CSM_SHOT.replace(/(\.png)?$/, '-memoire-liste.png') });
    const card = await win.$('#memList li[data-id]');
    if (card) {
      await card.click();
      await win.waitForSelector('#memEdit:not([hidden]) [name=note]');
      if (process.env.CSM_SHOT) await win.screenshot({ path: process.env.CSM_SHOT.replace(/(\.png)?$/, '-memoire.png') });
    }
    await win.fill('#memQ', 'zzz-introuvable');
    await win.waitForFunction(() => document.querySelector('#memList li.empty'));
    await win.selectOption('#memSrc', 'notes');
    await win.waitForFunction(() => document.querySelector('#memList li'));
  } finally {
    await win.evaluate(() => document.querySelector('#dlgSettings').close());
  }
});

test('thème clair : le code coloré pour un fond sombre reste lisible (contraste minimal)', async () => {
  await win.evaluate(() => saveSettings({ theme: 'light' }));
  await win.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  const ratio = await win.evaluate(() => [...terms.values()][0].term.options.minimumContrastRatio);
  assert.equal(ratio, 4.5);
  await win.evaluate(() => [...terms.values()][0].term.write('\r\n\x1b[38;2;230;230;230mconst blanc = "texte RVB très clair";\x1b[0m \x1b[38;2;255;214;102mjaune clair\x1b[0m \x1b[97mblanc vif\x1b[0m\r\n'));
  await new Promise(r => setTimeout(r, 300));
  if (process.env.CSM_SHOT) await win.screenshot({ path: process.env.CSM_SHOT.replace(/(\.png)?$/, '-clair.png') });
  await win.evaluate(() => saveSettings({ theme: 'dark' }));
  await win.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await win.evaluate(() => [...terms.values()][0].term.options.minimumContrastRatio), 1);
});

test('affichage tué (mémoire saturée) : la fenêtre est recréée, les sessions continuent', async () => {
  const next = app.waitForEvent('window', { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  win = await next;
  await win.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
  await win.waitForFunction(() => [...sessions.values()].some(s => s.name === 'e2e'), null, { timeout: 30000 });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'une seule fenêtre, l’ancienne est détruite');
});

test('fermer la fenêtre ne coupe pas les sessions', async () => {
  await win.evaluate(() => window.close());
  await new Promise(r => setTimeout(r, 800));
  const token = fs.readFileSync(path.join(DATA, 'token'), 'utf8').trim();
  const r = await fetch(`http://127.0.0.1:${PORT}/api/sessions`, { headers: { 'X-CSM-Token': token } });
  const list = await r.json();
  assert.ok(list.filter(s => s.alive).length >= 2, 'sessions toujours actives');
});
