'use strict';
// Claude Sessions — application de bureau (Windows / macOS).
// La fenêtre n'est qu'une vue : les sessions vivent dans le serveur local (processus séparé), qui continue
// de tourner quand on ferme ou quitte l'application.
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain, session, screen } = require('electron');
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
if (IS_WIN) app.setAppUserModelId('com.claude-sessions.app'); // notifications Windows rattachées à l'app
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let win = null;
let tray = null;
let quitting = false;

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
  for (let i = 0; i < 60; i++) { if (await isUp()) return true; await new Promise(r => setTimeout(r, 200)); }
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
    title: 'Claude Sessions', icon: ICON, show: false, backgroundColor: '#16181c', autoHideMenuBar: true,
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

  win.once('ready-to-show', () => { if (!START_HIDDEN || win.__forceShow) win.show(); });
  win.on('close', e => {
    saveState();
    if (!quitting) { e.preventDefault(); win.hide(); } // fermer = masquer (notifications, sessions continuent)
  });
  for (const ev of ['resize', 'move']) win.on(ev, debounce(saveState, 500));
  win.on('focus', () => win.flashFrame(false));

  win.webContents.on('did-fail-load', async (e, code, desc, url, isMain) => {
    if (!isMain) return;
    // Serveur pas encore prêt ou arrêté : on le relance puis on recharge.
    if (await ensureServer()) setTimeout(() => !win.isDestroyed() && win.loadURL(URL_), 300);
    else dialog.showErrorBox('Claude Sessions', `Le serveur local ne démarre pas.\n\nJournal : ${path.join(DATA, 'server.log')}`);
  });
  win.loadURL(URL_);
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.__forceShow = true;
  if (win.isMinimized()) win.restore();
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
    tray?.setToolTip(n ? `Claude Sessions — ${n} session(s) en attente` : 'Claude Sessions');
  });
  ipcMain.on('csm:focus', e => { if (trusted(e)) showWindow(); });
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

function buildTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'public', 'icon.png')).resize({ width: IS_MAC ? 18 : 16, height: IS_MAC ? 18 : 16 });
  tray = new Tray(img);
  tray.setToolTip('Claude Sessions');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Ouvrir Claude Sessions', click: showWindow },
    { label: 'Nouvelle session…', click: () => send('new') },
    { label: 'Historique…', click: () => send('history') },
    { type: 'separator' },
    { label: 'Lancer au démarrage de l’ordinateur', type: 'checkbox', checked: loginItem(), click: i => setLoginItem(i.checked) },
    { label: 'Redémarrer le serveur (les sessions reviennent)', click: async () => { stopServer(); await new Promise(r => setTimeout(r, 800)); await ensureServer(); win?.loadURL(URL_); } },
    { type: 'separator' },
    { label: 'Quitter (les sessions continuent)', click: () => { quitting = true; app.quit(); } },
    { label: 'Quitter et arrêter toutes les sessions', click: () => { quitting = true; stopServer(); app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', () => (IS_WIN ? showWindow() : null));
  tray.on('right-click', () => tray.setContextMenu(menu()));
}

function buildAppMenu() {
  if (!IS_MAC) { Menu.setApplicationMenu(null); return; } // Windows : pas de barre de menus
  // macOS : menu requis pour Cmd+C/V/X/A/Q dans les champs.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { label: 'Quitter (les sessions continuent)', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } }] },
    { label: 'Fichier', submenu: [{ label: 'Nouvelle session…', accelerator: 'Cmd+N', click: () => send('new') }, { label: 'Historique…', accelerator: 'Cmd+Shift+H', click: () => send('history') }, { type: 'separator' }, { role: 'close', label: 'Fermer la fenêtre' }] },
    { role: 'editMenu' },
    { label: 'Présentation', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
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
  buildTray();
  // Premier lancement : démarrage automatique activé (désactivable dans le menu de l'icône).
  const firstRun = path.join(DATA, 'app-first-run');
  if (app.isPackaged && PORT === 7890 && !fs.existsSync(firstRun)) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(firstRun, new Date().toISOString()); setLoginItem(true); }
  if (!(await ensureServer())) {
    dialog.showErrorBox('Claude Sessions', `Le serveur local ne démarre pas.\n\nJournal : ${path.join(DATA, 'server.log')}`);
  }
  createWindow();
});
