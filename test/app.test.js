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
  await win.waitForFunction(() => [...sessions.values()].some(s => s.name === 'e2e' && s.status === 'idle'), null, { timeout: 120000 });
  await win.click('.term.show');
  await win.keyboard.type('bonjour e2e');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => { const tt = terms.get(active); const b = tt.term.buffer.active; for (let y = 0; y < b.length; y++) if (b.getLine(y).translateToString().includes('echo: bonjour e2e')) return true; return false; }, null, { timeout: 45000 });
});

test('menu clic droit du terminal : tient dans une fenêtre basse et défile', async () => {
  await win.setViewportSize({ width: 900, height: 420 });
  const id = await win.evaluate(() => active);
  await win.evaluate(id => showMenu(terminalItems(id), 300, 200), id);
  const r = await win.evaluate(() => { const m = document.querySelector('#ctx'), b = m.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, scroll: m.scrollHeight > m.clientHeight, full: m.scrollHeight, h: innerHeight }; });
  assert.ok(r.top >= 0 && r.bottom <= r.h, `menu dans la fenêtre (${r.top}-${r.bottom} / ${r.h})`);
  if (r.full > r.h) assert.ok(r.scroll, 'menu défilant'); // contenu plus haut que la fenêtre
  // défilé jusqu'en bas : le dernier élément est dans la zone visible du menu
  const last = await win.evaluate(() => {
    const m = document.querySelector('#ctx'); m.scrollTop = m.scrollHeight;
    const a = m.getBoundingClientRect(), b = m.lastElementChild.getBoundingClientRect();
    return { inside: b.top >= a.top - 1 && b.bottom <= a.bottom + 1, a: [a.top, a.bottom], b: [b.top, b.bottom] };
  });
  assert.ok(last.inside, 'dernier élément atteignable ' + JSON.stringify(last));
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

test('palette : sections, surlignage, préfixe > et Ctrl+Entrée dans un panneau', async () => {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await win.click('[data-layout="1"]');
  await win.keyboard.press(mod + '+K');
  await win.waitForSelector('#dlgPalette[open]');
  await win.waitForSelector('#palList li.palSec');
  const heads = await win.$$eval('#palList li.palSec', l => l.map(x => x.textContent));
  assert.ok(heads.length >= 2 && /Sessions|sessions/i.test(heads[0]) && heads.some(h => /Actions/i.test(h)), heads.join('|'));
  assert.ok(await win.$('#palFoot kbd'));
  await win.keyboard.type('deux');
  await win.waitForSelector('#palList li.sel .pl mark');
  assert.match(await win.textContent('#palList li.sel .pl mark'), /deux/i);
  // Ctrl+Entrée : ouvre la session sélectionnée dans un panneau (passe en 2 colonnes)
  await win.keyboard.press(mod + '+Enter');
  await win.waitForFunction(() => layout === '2c' && visibleIds().length === 2);
  // préfixe > : seulement des actions
  await win.keyboard.press(mod + '+K');
  await win.waitForSelector('#dlgPalette[open]');
  await win.keyboard.type('>');
  await win.waitForSelector('#palList li.palSec');
  const heads2 = await win.$$eval('#palList li.palSec', l => l.map(x => x.textContent));
  assert.equal(heads2.length, 1);
  assert.match(heads2[0], /Actions/i);
  await win.keyboard.press('Escape');
});

test('vue partagée : envoi groupé aux sessions affichées depuis la barre du bas', async () => {
  await win.click('[data-layout="2c"]');
  await win.waitForSelector('#splitBar:not([hidden])');
  const ids = await win.evaluate(() => visibleIds().filter(id => sessions.get(id)?.alive));
  assert.equal(ids.length, 2);
  assert.match(await win.textContent('#sbCount'), /2/);
  await win.fill('#sbText', 'groupe-e2e');
  await win.click('#splitBar button[type=submit]');
  try {
    for (const id of ids) await win.waitForFunction(id => { const b = terms.get(id).term.buffer.active; for (let y = 0; y < b.length; y++) if (b.getLine(y).translateToString().includes('echo: groupe-e2e')) return true; return false; }, id, { timeout: 30000 });
  } catch (e) {
    const diag = await win.evaluate(ids => ids.map(id => { const s = sessions.get(id), b = terms.get(id).term.buffer.active, l = []; for (let y = Math.max(0, b.length - 8); y < b.length; y++) l.push(b.getLine(y).translateToString().trim()); return { name: s.name, status: s.status, queue: s.queue, tail: l.filter(Boolean) }; }), ids);
    throw new Error(e.message + ' — ' + JSON.stringify(diag));
  } finally { await win.click('[data-layout="1"]'); }
  await win.waitForSelector('#splitBar', { state: 'hidden' });
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

test('pièces jointes : miniature sur la session active seulement, agrandie au clic, retirée à l’envoi', async () => {
  const id = await win.evaluate(() => active);
  await win.evaluate(async id => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 80;
    const g = c.getContext('2d'); g.fillStyle = '#d97757'; g.fillRect(0, 0, 120, 80);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await attachFiles(id, [new File([blob], 'capture.png', { type: 'image/png' })]);
  }, id);
  const thumb = `.term .thumbs:not([hidden]) .thumb img`;
  await win.waitForSelector(thumb);
  assert.equal(await win.$eval('.term .thumbs:not([hidden]) .thumb', b => b.classList.contains('sent')), false, 'message en cours');
  await win.click('.term .thumbs:not([hidden]) .thumb');
  await win.waitForSelector('#dlgImage[open] img');
  assert.match(await win.textContent('#dlgImage figcaption'), /capture\.png/);
  if (process.env.CSM_SHOT) await win.screenshot({ path: process.env.CSM_SHOT.replace(/(\.png)?$/, '-image.png') });
  await win.keyboard.press('Escape');
  // autre session active : l'aperçu de la première n'apparaît pas
  const other = await win.evaluate(id => [...sessions.keys()].find(x => x !== id), id);
  if (other) {
    await win.evaluate(o => select(o), other);
    await win.waitForFunction(() => !document.querySelector('.term .thumbs:not([hidden])'));
    assert.equal(await win.evaluate(o => terms.get(o)?.el.querySelector('.thumbs:not([hidden])') || null, other), null, 'rien sur l’autre session');
    await win.evaluate(i => select(i), id);
    await win.waitForSelector(thumb);
  }
  // message envoyé : aperçu retiré
  await win.evaluate(id => attachmentsSent(id), id);
  await win.waitForFunction(() => !document.querySelector('.term .thumbs:not([hidden])'));
  // masquer à la main
  await win.evaluate(async id => {
    const c = document.createElement('canvas'); c.width = 10; c.height = 10;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    addAttachments(id, [new File([blob], 'b.png', { type: 'image/png' })]);
  }, id);
  await win.waitForSelector(thumb);
  await win.click('.term .thumbs:not([hidden]) .thumbsClose');
  assert.equal(await win.$('.term .thumbs:not([hidden])'), null, 'masquée');
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

test('connexion Claude : bandeau avant expiration, renouvellement dans l’app', async () => {
  const f = path.join(HOME, '.claude', '.credentials.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'b', expiresAt: Date.now() + 3600e3, refreshTokenExpiresAt: Date.now() + 2.5 * 86400e3 } }));
  await win.evaluate(() => api('GET', '/api/auth').then(s => window.dispatchEvent(new CustomEvent('csm:auth', { detail: { status: s } }))));
  await win.waitForSelector('#authBanner:not([hidden])');
  assert.match(await win.textContent('#authText'), /expire dans 2 jours/);
  await win.click('#authRenew');
  await win.waitForSelector('#dlgAuth[open] #authCodeRow:not([hidden])', { timeout: 20000 });
  assert.equal(await win.isVisible('#authLink'), true, 'lien de connexion proposé');
  await win.fill('#authCode', 'CODE-OK');
  await win.click('#authCodeSend');
  try {
    await win.waitForFunction(() => !document.querySelector('#dlgAuth').open && document.querySelector('#authBanner').hidden, null, { timeout: 20000 });
  } catch (e) {
    const diag = await win.evaluate(async () => ({ auth: await api('GET', '/api/auth'), open: document.querySelector('#dlgAuth').open, banner: !document.querySelector('#authBanner').hidden, step: document.querySelector('#authStep').textContent, text: document.querySelector('#authText').textContent, ui: window.csmFeatures.authState?.() }));
    throw new Error(e.message + ' — ' + JSON.stringify(diag));
  }
  fs.rmSync(f, { force: true });
});

test('notifications et pastille : test depuis les réglages, nombre sur l’icône', async () => {
  const r = await win.evaluate(() => window.csmNative.notifyTest());
  assert.ok(['native', 'applescript', 'unsupported'].includes(r.how), JSON.stringify(r));
  if (process.platform !== 'darwin') assert.equal(r.how, 'native');
  // pastille : 1, 12 (« 9+ ») puis 0, sans erreur dans le processus principal
  for (const n of [1, 12, 0]) await win.evaluate(n => window.csmNative.setAttention(n), n);
  await new Promise(res => setTimeout(res, 300));
  if (process.platform === 'win32') assert.equal(await app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows()[0]), true);
});

test('extensions : modèle dans Nouvelle session, affichage dédié rempli par Claude, action', async () => {
  const ext = { csm: 1, id: 'ext-e2e', name: 'Extension e2e', templates: [{ id: 'rev', name: 'Revue e2e', type: 'rev' }],
    sessionTypes: [{ id: 'rev', name: 'Revue', badge: 'REVUE', color: '#7A9BEA', instructions: 'mode revue', actions: [{ id: 'go', label: 'Corriger', send: 'corrige-e2e', primary: true }] }] };
  await win.evaluate(c => api('POST', '/api/extensions', { content: c }), JSON.stringify(ext));
  // Réglages › Extensions : listée
  await win.evaluate(() => window.csmFeatures.openSettings('extensions')); // ouverture directe : la liste se charge
  await win.waitForFunction(() => {
    // relu toutes les 2 s si besoin (machine lente)
    if (!window.__extT || Date.now() - window.__extT > 2000) { window.__extT = Date.now(); window.csmFeatures.renderExtensions(); }
    return /Extension e2e/.test(document.querySelector('#extsList').textContent);
  }, null, { timeout: 30000 });
  await win.evaluate(() => document.querySelector('#dlgSettings').close());
  // Nouvelle session depuis le modèle de l'extension
  await win.click('#btnNew');
  await win.waitForFunction(() => [...document.querySelectorAll('#formNew [name=template] optgroup option')].some(o => o.textContent === 'Revue e2e'));
  // carte du modèle de l'extension (nouvelle fenêtre) : sélectionnée au clic
  await win.click('#tplCards .tplCard:has-text("Revue e2e")');
  assert.equal(await win.evaluate(() => document.querySelector('#formNew [name=template]').value), 'ext-e2e/rev');
  assert.equal(await win.evaluate(() => document.querySelector('#tplCards .tplCard.on .tn').textContent), 'Revue e2e');
  await win.fill('#formNew [name=cwd]', WORK);
  await win.click('#formNew button[value=ok]');
  const id = await win.waitForFunction(() => [...sessions.values()].find(s => s.typeInfo?.name === 'Revue' && s.status === 'idle')?.id, null, { timeout: 60000 }).then(h => h.jsonValue());
  await win.waitForSelector('#curType:not([hidden])');
  assert.equal(await win.textContent('#curType'), 'REVUE');
  // Claude écrit la vue : affichée en texte (le HTML reste du texte)
  await win.evaluate(id => send({ t: 'input', id, d: 'ecris-vue\r' }), id);
  await win.waitForFunction(id => /Analyse <b>test<\/b>/.test(terms.get(id).el.querySelector('.typeView')?.textContent || ''), id, { timeout: 20000 });
  assert.equal(await win.evaluate(id => terms.get(id).el.querySelector('.typeView script, .typeView b'), id), null, 'aucun HTML interprété');
  // action du type : envoyée à la session
  await win.click('.term.show .typeView .tvHead button:has-text("Corriger")');
  await win.waitForFunction(id => { const b = terms.get(id).term.buffer.active; for (let y = 0; y < b.length; y++) if (b.getLine(y).translateToString().includes('echo: corrige-e2e')) return true; return false; }, id, { timeout: 20000 });
  // bascule vers le terminal
  await win.click('#btnView');
  assert.equal(await win.evaluate(id => terms.get(id).el.querySelector('.typeView').hidden, id), true);
  await win.evaluate(() => api('DELETE', '/api/extensions/ext-e2e'));
});

test('centre d’attention : demande d’autorisation affichée et acceptée depuis le centre', async () => {
  const id = await win.evaluate(() => [...sessions.values()].find(s => s.name === 'e2e').id);
  await win.evaluate(id => send({ t: 'input', id, d: 'demande\r' }), id);
  await win.waitForSelector('#btnAttention:not([hidden])', { timeout: 30000 });
  await win.click('#btnAttention'); // bouton « À traiter » de la barre du haut
  await win.waitForSelector('#dlgAttention[open] .atCard.perm', { timeout: 15000 });
  assert.match(await win.textContent('#dlgAttention .atCard.perm .atCtx'), /Do you want to proceed/);
  await win.click('#dlgAttention .atCard.perm button:has-text("Autoriser")');
  await win.waitForFunction(id => { const b = terms.get(id).term.buffer.active; for (let y = 0; y < b.length; y++) if (b.getLine(y).translateToString().includes('AUTORISATION:oui')) return true; return false; }, id, { timeout: 20000 });
  await win.waitForFunction(() => !document.querySelector('#dlgAttention .atCard.perm'), null, { timeout: 15000 });
  await win.evaluate(() => document.querySelector('#dlgAttention').close());
});

test('usage de Claude : indicateurs, quota, sessions (Ctrl+Alt+U)', async () => {
  await win.evaluate(() => window.csmFeatures.openUsage()); // (raccourci Ctrl+Alt+U, palette, quotas de la barre latérale)
  await win.waitForSelector('#dlgUsage[open] #dbKpis .dbKpi', { timeout: 15000 });
  assert.equal(await win.evaluate(() => document.querySelectorAll('#dbKpis .dbKpi').length), 4);
  assert.match(await win.textContent('#dbKpis'), /Sessions actives/);
  await win.waitForFunction(() => document.querySelector('#dbRows').children.length > 0);
  await win.evaluate(() => document.querySelector('#dlgUsage').close());
});

test('fermer la fenêtre ne coupe pas les sessions', async () => {
  await win.evaluate(() => window.close());
  await new Promise(r => setTimeout(r, 800));
  const token = fs.readFileSync(path.join(DATA, 'token'), 'utf8').trim();
  const r = await fetch(`http://127.0.0.1:${PORT}/api/sessions`, { headers: { 'X-CSM-Token': token } });
  const list = await r.json();
  assert.ok(list.filter(s => s.alive).length >= 2, 'sessions toujours actives');
});
