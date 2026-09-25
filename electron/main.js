'use strict';
// Claude Sessions — application de bureau (Windows / macOS).
// La fenêtre n'est qu'une vue : les sessions vivent dans le serveur local (processus séparé), qui continue
// de tourner quand on ferme ou quitte l'application.
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain, session, screen, Notification, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const { ROOT, PORT, IS_WIN, IS_MAC, DATA } = require('../lib/config');

const ORIGIN = `http://127.0.0.1:${PORT}`;
const URL_ = `${ORIGIN}/`;
const SERVER = path.join(ROOT, 'server.js');
const ICON = path.join(ROOT, 'public', IS_WIN ? 'icon.ico' : 'icon.png');
const STATE = path.join(DATA, 'app-window.json');
const START_HIDDEN = process.argv.includes('--hidden');

app.setName('Claude Sessions');
// Autre port = instance séparée (tests, essais) : profil et verrou d'instance unique distincts.
if (PORT !== 7890) app.setPath('userData', path.join(DATA, 'electron'));
if (IS_WIN) app.setAppUserModelId('com.claude-sessions.app'); // notifications Windows rattachées à l'app
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let win = null;
let tray = null;
let quitting = false;
// Préférences de fenêtre transmises par la page (réglages du serveur) ; valeurs par défaut en attendant.
const prefs = { minimizeToTray: true, closeToTray: true };
let attention = 0;
let updates = null; // electron/updater.js

// Lecture d'un réglage du serveur (le jeton est dans le dossier de données, lisible par l'utilisateur seul).
function serverGet(p) {
  return new Promise(resolve => {
    let token = ''; try { token = fs.readFileSync(path.join(DATA, 'token'), 'utf8').trim(); } catch { }
    const req = http.get(`${ORIGIN}${p}`, { headers: { 'X-CSM-Token': token }, timeout: 2000 }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ---------------------------------------------------------------- serveur
function isUp() {
  return new Promise(resolve => {
    const req = http.get(URL_, { timeout: 800 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Une app lancée depuis le Finder / le Dock n'a pas le PATH du shell (claude, git, node… introuvables).
function loginShellPath() {
  if (!IS_MAC) return process.env.PATH;
  try {
    const sh = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(sh, ['-ilc', 'printf "__P__%s__P__" "$PATH"'], { encoding: 'utf8', timeout: 4000 });
    return (out.match(/__P__(.*)__P__/) || [])[1] || process.env.PATH;
  } catch { return process.env.PATH; }
}

async function ensureServer() {
  if (await isUp()) return true;
  fs.mkdirSync(DATA, { recursive: true });
  // Electron lui-même en mode Node : aucune installation de Node.js requise. Détaché = survit à l'app.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PATH: loginShellPath() };
  spawn(process.execPath, [SERVER, `--port=${PORT}`], { cwd: ROOT, env, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 150; i++) { if (await isUp()) return true; await new Promise(r => setTimeout(r, 200)); }
  return false;
}

function stopServer() {
  try {
    const pid = Number(fs.readFileSync(path.join(DATA, 'server.pid'), 'utf8'));
    if (pid) process.kill(pid, IS_WIN ? undefined : 'SIGTERM'); // SIGTERM : les sessions ouvertes sont mémorisées
  } catch { }
}

// ---------------------------------------------------------------- fenêtre
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const visible = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return s.x < a.x + a.width - 100 && s.x + s.width > a.x + 100 && s.y >= a.y - 10 && s.y < a.y + a.height - 100;
    });
    return visible ? s : { width: s.width, height: s.height, maximized: s.maximized };
  } catch { return { width: 1400, height: 900 }; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(STATE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { }
}

const sameOrigin = url => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
const external = url => { try { return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol); } catch { return false; } };

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1400, height: st.height || 900, minWidth: 760, minHeight: 480,
    title: 'Claude Sessions', icon: ICON, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181c' : '#f4f1ec', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      spellcheck: false, backgroundThrottling: false, // le terminal reste réactif quand la fenêtre est en arrière-plan
    },
  });
  if (st.maximized) win.maximize();

  // Navigation verrouillée sur le serveur local ; tout lien externe part dans le navigateur par défaut.
  win.webContents.setWindowOpenHandler(({ url }) => { if (external(url) && !sameOrigin(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!sameOrigin(url)) { e.preventDefault(); if (external(url)) shell.openExternal(url); } });
  win.webContents.on('will-attach-webview', e => e.preventDefault());

  win.once('ready-to-show', () => { if (process.env.CSM_HIDE_WINDOW) return; if (!START_HIDDEN || win.__forceShow) win.show(); }); // CSM_HIDE_WINDOW : tests automatiques, rien à l'écran
  win.on('close', e => {
    saveState();
    if (quitting) return;
    if (prefs.closeToTray) { e.preventDefault(); toTray(); } // fermer = masquer (notifications, sessions continuent)
    else { quitting = true; } // fermer = quitter l'app ; le serveur et les sessions continuent
  });
  // Réduire : dans la zone de notification (Windows) / la barre de menus (macOS) plutôt que la barre des tâches.
  win.on('minimize', () => { if (prefs.minimizeToTray && tray) toTray(); });
  for (const ev of ['resize', 'move']) win.on(ev, debounce(saveState, 500));
  win.on('focus', () => { win.flashFrame(false); updates?.onFocus?.(); });
  win.on('show', () => updates?.onFocus?.());

  win.webContents.on('did-fail-load', async (e, code, desc, url, isMain) => {
    if (!isMain) return;
    // Serveur pas encore prêt ou arrêté : on le relance puis on recharge.
    if (await ensureServer()) setTimeout(() => !win.isDestroyed() && win.loadURL(URL_), 300);
    else (process.env.CSM_HIDE_WINDOW ? (t, m) => console.error(m) : dialog.showErrorBox)('Claude Sessions', `Le serveur local ne démarre pas.\n\nJournal : ${path.join(DATA, 'server.log')}`);
  });
  win.loadURL(URL_);
}

// Masque la fenêtre (plus d'entrée dans la barre des tâches) ; la 1re fois, explique où elle est passée.
function toTray() {
  if (!win || win.isDestroyed()) return;
  win.hide();
  if (IS_MAC && prefs.minimizeToTray) app.dock?.hide?.();
  const flag = path.join(DATA, 'app-tray-hint');
  if (tray && !fs.existsSync(flag)) {
    try { fs.writeFileSync(flag, new Date().toISOString()); } catch { }
    const msg = IS_WIN
      ? 'Claude Sessions continue en arrière-plan, avec tes sessions. Clique sur son icône près de l’horloge pour la rouvrir (si elle n’est pas visible : flèche ^).'
      : 'Claude Sessions continue en arrière-plan, avec tes sessions. Rouvre-la depuis son icône dans la barre des menus.';
    if (IS_WIN && tray.displayBalloon) tray.displayBalloon({ title: 'Claude Sessions', content: msg, iconType: 'info' });
    else if (Notification.isSupported()) new Notification({ title: 'Claude Sessions', body: msg, silent: true }).show();
  }
}

function showWindow() {
  if (IS_MAC) app.dock?.show?.();
  if (!win || win.isDestroyed()) createWindow();
  win.__forceShow = true;
  if (win.isMinimized()) win.restore();
  if (process.env.CSM_HIDE_WINDOW) return;
  win.show(); win.focus();
}
const send = (action) => { showWindow(); win.webContents.send('csm:action', action); };

// ---------------------------------------------------------------- sécurité de la session web
function hardenSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(allowed.has(perm) && sameOrigin(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => allowed.has(perm) && sameOrigin(origin + '/'));
  ses.on('will-download', e => e.preventDefault());
}

// IPC : uniquement depuis la page du serveur local.
function trusted(e) { return sameOrigin(e.senderFrame?.url || ''); }
function registerIpc() {
  ipcMain.handle('csm:pick-folder', async (e, initial) => {
    if (!trusted(e)) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Dossier de travail de la session Claude',
      defaultPath: typeof initial === 'string' && initial && fs.existsSync(initial) ? initial : undefined,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    return r.canceled ? null : r.filePaths[0] || null;
  });
  ipcMain.on('csm:attention', (e, n) => {
    if (!trusted(e)) return;
    n = Math.max(0, Math.min(99, Number(n) || 0));
    if (IS_MAC) app.setBadgeCount(n);
    if (IS_WIN && win) win.setOverlayIcon(n ? badgeIcon() : null, n ? `${n} en attente` : '');
    if (n && win && !win.isFocused()) win.flashFrame(true);
    attention = n;
    refreshTrayIcon();
  });
  ipcMain.on('csm:prefs', (e, p) => {
    if (!trusted(e) || !p || typeof p !== 'object') return;
    for (const k of Object.keys(prefs)) if (typeof p[k] === 'boolean') prefs[k] = p[k];
  });
  ipcMain.on('csm:focus', e => { if (trusted(e)) showWindow(); });
  ipcMain.handle('csm:update', async (e, action) => {
    if (!trusted(e) || !updates) return updates?.state || null;
    if (action === 'check') await updates.check();
    else if (action === 'install') await updates.install();
    return updates.state;
  });
  ipcMain.on('csm:app-version', e => { e.returnValue = trusted(e) ? app.getVersion() : ''; });
  ipcMain.handle('csm:restart-server', async e => {
    if (!trusted(e)) return false;
    stopServer();
    for (let i = 0; i < 75 && (await isUp()); i++) await new Promise(r => setTimeout(r, 200));
    const ok = await ensureServer();
    if (ok && win && !win.isDestroyed()) win.loadURL(URL_);
    return ok;
  });
}

let trayImg = null, trayImgAlert = null;
function trayImages() {
  if (trayImg) return;
  const size = IS_MAC ? 18 : 16;
  trayImg = nativeImage.createFromPath(path.join(ROOT, 'public', 'icon.png')).resize({ width: size, height: size, quality: 'best' });
  // même icône + point rouge en bas à droite (pixels BGRA sous Windows, RGBA ailleurs)
  const s = trayImg.getSize(), bmp = Buffer.from(trayImg.toBitmap());
  const r = Math.round(s.width * 0.28), cx = s.width - r - 0.5, cy = s.height - r - 0.5;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const d = Math.hypot(x - cx, y - cy), i = (y * s.width + x) * 4;
    if (d <= r + 1) {
      const edge = d > r; // liseré sombre pour détacher le point
      const [R_, G, B] = edge ? [30, 27, 24] : [240, 86, 74];
      if (IS_WIN) { bmp[i] = B; bmp[i + 1] = G; bmp[i + 2] = R_; } else { bmp[i] = R_; bmp[i + 1] = G; bmp[i + 2] = B; }
      bmp[i + 3] = 255;
    }
  }
  trayImgAlert = nativeImage.createFromBitmap(bmp, { width: s.width, height: s.height });
}
async function refreshTrayIcon() {
  if (!tray) return;
  trayImages();
  tray.setImage(attention ? trayImgAlert : trayImg);
  const list = (await serverGet('/api/sessions')) || [];
  const alive = list.filter(s => s.alive).length;
  tray.setToolTip(`Claude Sessions — ${alive} session${alive > 1 ? 's' : ''} active${alive > 1 ? 's' : ''}${attention ? ` · ${attention} en attente de réponse` : ''}`);
}

let badge = null;
function badgeIcon() {
  if (badge) return badge;
  // Pastille rouge 16×16 (overlay de la barre des tâches Windows).
  const size = 16, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5), i = (y * size + x) * 4;
    if (d <= 7.5) { buf[i] = 0x4a; buf[i + 1] = 0x56; buf[i + 2] = 0xf0; buf[i + 3] = d > 6.5 ? 160 : 255; } // BGRA
  }
  return (badge = nativeImage.createFromBitmap(buf, { width: size, height: size }));
}

// ---------------------------------------------------------------- barre des tâches / de menus
function loginItem() { return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin; }
function setLoginItem(on) { app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true, args: ['--hidden'] }); }

let refreshTray = () => { };
function updateMenuItems() {
  const st = updates?.state; if (!st) return [];
  if (st.status === 'ready') return [{ label: `Redémarrer pour installer la version ${st.version}`, click: () => updates.install() }, { type: 'separator' }];
  if (st.status === 'available') return [{ label: `Télécharger la version ${st.version}…`, click: () => updates.install() }, { type: 'separator' }];
  if (st.status === 'downloading') return [{ label: `Téléchargement de la version ${st.version || ''}… ${st.progress ? st.progress + ' %' : ''}`, enabled: false }, { type: 'separator' }];
  return [];
}
function buildTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'public', 'icon.png')).resize({ width: IS_MAC ? 18 : 16, height: IS_MAC ? 18 : 16 });
  tray = new Tray(img);
  tray.setToolTip('Claude Sessions');
  const STATE = { working: '🟠', attention: '🔴', idle: '🟢', starting: '⚪', exited: '⚫' };
  const LABEL = { working: 'travaille', attention: 'attend ta réponse', idle: 'prête', starting: 'démarre', exited: 'arrêtée' };
  let lastSessions = [];
  const sessionItems = () => {
    const list = lastSessions.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!list.length) return [];
    const items = list.slice(0, 12).map(s => ({
      label: `${STATE[s.status] || '•'}  ${s.name.length > 40 ? s.name.slice(0, 39) + '…' : s.name}   —  ${LABEL[s.status] || s.status}`,
      click: () => send(`select:${s.id}`),
    }));
    if (list.length > 12) items.push({ label: `… et ${list.length - 12} autre(s)`, click: showWindow });
    return [{ label: 'Sessions', enabled: false }, ...items, { type: 'separator' }];
  };
  const menu = () => Menu.buildFromTemplate([
    ...sessionItems(),
    { label: 'Ouvrir Claude Sessions', click: showWindow },
    ...updateMenuItems(),
    { label: 'Nouvelle session…', click: () => send('new') },
    { label: 'Historique…', click: () => send('history') },
    { label: 'Réglages…', click: () => send('settings') },
    { type: 'separator' },
    { label: 'Rechercher des mises à jour', click: () => updates?.check(), visible: !!updates && app.isPackaged },
    { label: 'Lancer au démarrage de l’ordinateur', type: 'checkbox', checked: loginItem(), click: i => setLoginItem(i.checked), visible: !process.windowsStore }, // version Store : non géré par l'app
    { label: 'Redémarrer le serveur (les sessions reviennent)', click: async () => { stopServer(); await new Promise(r => setTimeout(r, 800)); await ensureServer(); win?.loadURL(URL_); } },
    { type: 'separator' },
    { label: 'Quitter (les sessions continuent)', click: () => { quitting = true; app.quit(); } },
    { label: 'Quitter et arrêter toutes les sessions', click: () => { quitting = true; stopServer(); app.quit(); } },
  ]);
  // Menu reconstruit à chaque ouverture (état des sessions à jour).
  const popup = async () => { lastSessions = (await serverGet('/api/sessions')) || []; tray.popUpContextMenu(menu()); };
  refreshTray = () => { if (IS_MAC) tray.setContextMenu(menu()); };
  if (IS_MAC) { tray.setContextMenu(menu()); tray.on('mouse-enter', async () => { lastSessions = (await serverGet('/api/sessions')) || []; tray.setContextMenu(menu()); }); }
  else {
    tray.on('click', () => (win && win.isVisible() && win.isFocused() ? toTray() : showWindow())); // clic = afficher / masquer
    tray.on('right-click', popup);
  }
  tray.on('double-click', showWindow);
  refreshTrayIcon();
  setInterval(refreshTrayIcon, 15000);
}

// Libellés des menus natifs selon la langue du système (la page, elle, suit le réglage « Langue »).
const L = (fr, en) => (/^fr/i.test(app.getLocale() || '') ? fr : en);
function buildAppMenu() {
  if (!IS_MAC) { Menu.setApplicationMenu(null); return; } // Windows : pas de barre de menus
  // macOS : menu requis pour Cmd+C/V/X/A/Q dans les champs.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', submenu: [{ role: 'about', label: L('À propos de Claude Sessions', 'About Claude Sessions') }, { type: 'separator' }, { role: 'hide', label: L('Masquer Claude Sessions', 'Hide Claude Sessions') }, { role: 'hideOthers', label: L('Masquer les autres', 'Hide Others') }, { role: 'unhide', label: L('Tout afficher', 'Show All') }, { type: 'separator' },
      { label: L('Quitter (les sessions continuent)', 'Quit (sessions keep running)'), accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } }] },
    { label: L('Fichier', 'File'), submenu: [{ label: L('Nouvelle session…', 'New session…'), accelerator: 'Cmd+N', click: () => send('new') }, { label: L('Historique…', 'History…'), accelerator: 'Cmd+Shift+H', click: () => send('history') }, { label: L('Réglages…', 'Settings…'), accelerator: 'Cmd+,', click: () => send('settings') }, { type: 'separator' }, { role: 'close', label: L('Fermer la fenêtre', 'Close Window') }] },
    // Édition et Fenêtre construits à la main : les menus prédéfinis d'Electron restent en anglais
    { label: L('Édition', 'Edit'), submenu: [
      { role: 'undo', label: L('Annuler', 'Undo') }, { role: 'redo', label: L('Rétablir', 'Redo') }, { type: 'separator' },
      { role: 'cut', label: L('Couper', 'Cut') }, { role: 'copy', label: L('Copier', 'Copy') }, { role: 'paste', label: L('Coller', 'Paste') },
      { role: 'pasteAndMatchStyle', label: L('Coller et adapter le style', 'Paste and Match Style') }, { role: 'delete', label: L('Supprimer', 'Delete') },
      { role: 'selectAll', label: L('Tout sélectionner', 'Select All') }] },
    { label: L('Présentation', 'View'), submenu: [{ role: 'reload', label: L('Recharger', 'Reload') }, { role: 'togglefullscreen', label: L('Plein écran', 'Toggle Full Screen') }] },
    { label: L('Fenêtre', 'Window'), role: 'window', submenu: [
      { role: 'minimize', label: L('Réduire', 'Minimize') }, { role: 'zoom', label: L('Zoom', 'Zoom') }, { type: 'separator' },
      { role: 'front', label: L('Tout ramener au premier plan', 'Bring All to Front') }] },
  ]));
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------------------------------------------------------------- cycle de vie
app.on('second-instance', showWindow);
app.on('activate', showWindow); // clic sur l'icône du Dock
app.on('before-quit', () => { quitting = true; saveState(); });
app.on('window-all-closed', e => e.preventDefault()); // reste dans la barre des tâches / de menus
app.on('web-contents-created', (e, wc) => { wc.on('will-attach-webview', ev => ev.preventDefault()); });

app.whenReady().then(async () => {
  hardenSession();
  registerIpc();
  buildAppMenu();
  if (!process.env.CSM_HIDE_WINDOW) buildTray();
  // Premier lancement : démarrage automatique activé (désactivable dans le menu de l'icône).
  const firstRun = path.join(DATA, 'app-first-run');
  if (app.isPackaged && !process.windowsStore && PORT === 7890 && !fs.existsSync(firstRun)) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(firstRun, new Date().toISOString()); setLoginItem(true); }
  if (!(await ensureServer())) {
    (process.env.CSM_HIDE_WINDOW ? (t, m) => console.error(m) : dialog.showErrorBox)('Claude Sessions', `Le serveur local ne démarre pas.\n\nJournal : ${path.join(DATA, 'server.log')}`);
  }
  createWindow();
  updates = require('./updater')({
    enabled: async () => ((await serverGet('/api/settings')) || {}).autoUpdate !== false,
    beforeInstall: async () => { stopServer(); for (let i = 0; i < 75 && (await isUp()); i++) await new Promise(r => setTimeout(r, 200)); },
    onState: st => { refreshTray(); if (win && !win.isDestroyed()) win.webContents.send('csm:update-state', st); },
    log: m => console.log(m),
  });
});
