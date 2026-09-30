'use strict';
// Mises à jour automatiques (#3).
// Windows : electron-updater (GitHub Releases) — téléchargement en arrière-plan, installation au redémarrage.
// macOS : Squirrel.Mac exige une app signée par Apple → mise à jour maison : téléchargement du .dmg de
// l'architecture (empreinte sha512 vérifiée contre latest-mac.yml), copie de l'app dans un dossier d'attente,
// puis au redémarrage un petit script remplace l'app et la relance (mot de passe demandé seulement si le
// dossier de l'app n'est pas modifiable). En cas d'échec : lien vers la release, comme avant.
// Sur les deux systèmes, une version prête s'installe seule (redémarrage compris) dès que canRestart() le permet :
// réglage actif, aucune session au travail, fenêtre réduite / cachée ou ordinateur inactif. Les sessions sont restaurées au redémarrage.
const { app, net, shell, Notification } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const REPO = 'khalilbenaz/claude-sessions-manager';
const EVERY = 6 * 3600e3;

function newer(a, b) { // a > b ?
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

module.exports = function setupUpdater({ enabled, canRestart = async () => false, beforeInstall, onState, log }) {
  const state = { status: 'idle', version: null, url: `https://github.com/${REPO}/releases/latest`, error: null };
  const set = patch => { Object.assign(state, patch); onState({ ...state }); };
  if (!app.isPackaged) { set({ status: 'dev' }); return { state, check: async () => { }, install: () => { } }; }
  // Version Microsoft Store : c'est le Store qui installe les mises à jour.
  if (process.windowsStore) { set({ status: 'store' }); return { state, check: async () => { }, install: () => shell.openExternal('ms-windows-store://downloadsandupdates'), onFocus: () => { } }; }

  let updater = null;
  if (process.platform === 'win32') {
    try {
      ({ autoUpdater: updater } = require('electron-updater'));
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = false; // on installe seulement sur demande (sessions redémarrées proprement)
      updater.logger = { info: m => log(`[maj] ${m}`), warn: m => log(`[maj] ${m}`), error: m => log(`[maj] ${m}`), debug: () => { } };
      updater.on('checking-for-update', () => set({ status: 'checking', error: null }));
      updater.on('update-not-available', () => set({ status: 'uptodate' }));
      updater.on('update-available', i => set({ status: 'downloading', version: i.version }));
      updater.on('download-progress', p => set({ status: 'downloading', progress: Math.round(p.percent) }));
      updater.on('update-downloaded', i => {
        set({ status: 'ready', version: i.version });
        if (Notification.isSupported()) new Notification({ title: 'Claude Sessions', body: `Version ${i.version} prête : elle s'installera toute seule dès que la fenêtre sera en arrière-plan (ou redémarre l'application maintenant).` }).show();
      });
      updater.on('error', e => set({ status: 'error', error: String(e && e.message || e).slice(0, 300) }));
    } catch (e) { log(`[maj] electron-updater indisponible : ${e.message}`); updater = null; }
  }

  // ---------------------------------------------------------------- macOS
  const STAGE = path.join(app.getPath('userData'), 'update');
  const bundle = () => { const b = path.resolve(process.execPath, '..', '..', '..'); return b.endsWith('.app') ? b : null; };
  const sh = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { timeout: 5 * 60e3, ...opts }, (e, out, err) => e ? rej(new Error(String(err || e.message).trim().slice(0, 300))) : res(out)));
  let staged = null; // { version, app } : nouvelle version prête à installer
  let busy = false;

  // empreinte attendue du .dmg de cette architecture, lue dans latest-mac.yml
  function expected(yml, name) {
    const i = yml.indexOf(`url: ${name}`);
    const m = i >= 0 && /sha512:\s*(\S+)/.exec(yml.slice(i));
    return m ? m[1] : null;
  }

  async function download(url, file, total) {
    const r = await net.fetch(url);
    if (!r.ok) throw new Error(`téléchargement : HTTP ${r.status}`);
    const hash = crypto.createHash('sha512'), out = fs.createWriteStream(file);
    let got = 0, shown = -1;
    const reader = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value); got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res));
        const p = total ? Math.floor(got * 100 / total) : 0;
        if (p !== shown && p % 5 === 0) { shown = p; set({ progress: p }); }
      }
    } finally { await new Promise(res => out.end(res)); }
    return hash.digest('base64');
  }

  async function stage(rel, version) {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const dmg = rel.assets.find(a => a.name.endsWith(`-${arch}.dmg`));
    const yml = rel.assets.find(a => a.name === 'latest-mac.yml');
    if (!dmg || !yml) throw new Error(`pas de .dmg ${arch} dans la release`);
    const sha = expected(await (await net.fetch(yml.browser_download_url)).text(), dmg.name);
    if (!sha) throw new Error('empreinte absente de latest-mac.yml');
    fs.rmSync(STAGE, { recursive: true, force: true });
    fs.mkdirSync(STAGE, { recursive: true });
    const file = path.join(STAGE, dmg.name), mnt = path.join(STAGE, 'mnt'), dest = path.join(STAGE, version);
    set({ status: 'downloading', version, progress: 0 });
    if (await download(dmg.browser_download_url, file, dmg.size) !== sha) throw new Error('empreinte du téléchargement invalide');
    fs.mkdirSync(mnt);
    await sh('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt, file]);
    try {
      const name = fs.readdirSync(mnt).find(f => f.endsWith('.app'));
      if (!name) throw new Error('aucune application dans le .dmg');
      fs.mkdirSync(dest);
      await sh('ditto', [path.join(mnt, name), path.join(dest, name)]);
      staged = { version, app: path.join(dest, name) };
    } finally { await sh('hdiutil', ['detach', mnt, '-force']).catch(() => { }); }
    fs.rmSync(file, { force: true });
    await sh('xattr', ['-cr', staged.app]).catch(() => { }); // pas de quarantaine : l'app se relance sans alerte
  }

  async function checkMac() {
    if (busy) return;
    busy = true;
    set({ status: 'checking', error: null });
    let rel = null;
    try {
      const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      rel = await r.json();
      if (!rel.tag_name || !newer(rel.tag_name, app.getVersion())) { set({ status: 'uptodate' }); return; }
      const version = rel.tag_name.replace(/^v/, '');
      set({ url: rel.html_url, version });
      if (!(staged && staged.version === version && fs.existsSync(staged.app))) {
        if (!bundle()) throw new Error('emplacement de l’application inconnu');
        await stage(rel, version);
      }
      set({ status: 'ready', version, progress: null });
      if (Notification.isSupported()) new Notification({ title: 'Claude Sessions', body: `Version ${version} prête : elle s'installera toute seule dès que la fenêtre sera en arrière-plan (ou redémarre l'application maintenant).` }).show();
    } catch (e) {
      log(`[maj] ${e.message}`);
      // repli : lien vers la release
      if (rel && rel.tag_name && newer(rel.tag_name, app.getVersion())) set({ status: 'available', version: rel.tag_name.replace(/^v/, ''), url: rel.html_url, error: e.message, progress: null });
      else set({ status: 'error', error: e.message });
    } finally { busy = false; }
  }

  // Remplace l'app une fois celle-ci fermée, puis la relance.
  const macWritable = dest => { try { fs.accessSync(path.dirname(dest), fs.constants.W_OK); fs.accessSync(dest, fs.constants.W_OK); return true; } catch { return false; } };
  async function installMac(auto) {
    const dest = bundle();
    await beforeInstall({ auto });
    const writable = macWritable(dest);
    const script = [
      'while kill -0 "$CSM_PID" 2>/dev/null; do sleep 0.3; done',
      writable
        ? 'rm -rf "$CSM_DEST.old"; mv "$CSM_DEST" "$CSM_DEST.old" && if ditto "$CSM_SRC" "$CSM_DEST"; then rm -rf "$CSM_DEST.old"; else rm -rf "$CSM_DEST"; mv "$CSM_DEST.old" "$CSM_DEST"; fi'
        : `osascript -e "do shell script \"rm -rf '$CSM_DEST' && ditto '$CSM_SRC' '$CSM_DEST' && xattr -cr '$CSM_DEST'\" with prompt \"Claude Sessions installe la version ${staged.version}.\" with administrator privileges"`,
      'xattr -cr "$CSM_DEST" 2>/dev/null',
      'rm -rf "$CSM_STAGE"',
      'open "$CSM_DEST"',
    ].join('\n');
    const out = path.join(os.tmpdir(), 'csm-update.log');
    spawn('/bin/sh', ['-c', script], {
      detached: true, stdio: ['ignore', fs.openSync(out, 'a'), fs.openSync(out, 'a')],
      env: { ...process.env, CSM_PID: String(process.pid), CSM_SRC: staged.app, CSM_DEST: dest, CSM_STAGE: STAGE },
    }).unref();
    app.quit();
  }

  async function check() {
    if (!(await enabled())) { set({ status: 'disabled' }); return; }
    if (updater) { try { await updater.checkForUpdates(); } catch (e) { set({ status: 'error', error: e.message }); } }
    else await checkMac();
  }

  async function install(auto = false) {
    if (process.platform === 'darwin' && state.status === 'ready' && staged && bundle()) return installMac(auto);
    if (updater && state.status === 'ready') {
      await beforeInstall({ auto }); // arrêt propre du serveur : il redémarre avec le nouveau code, sessions restaurées
      updater.quitAndInstall(true, true);
    } else shell.openExternal(state.url);
  }

  // au lancement, toutes les 6 h, et au retour sur la fenêtre si la dernière vérification date de plus d'une heure
  let last = 0;
  const run = () => { last = Date.now(); return check(); };
  setTimeout(run, 20e3);
  setInterval(run, EVERY);
  // Installation automatique : vérifiée chaque minute tant qu'une version est prête.
  // Sur macOS, seulement si l'app peut être remplacée sans mot de passe (sinon personne n'est là pour le taper).
  let installing = false;
  setInterval(async () => {
    if (installing || state.status !== 'ready') return;
    if (process.platform === 'darwin' && !(staged && bundle() && macWritable(bundle()))) return;
    try {
      if (!(await enabled()) || !(await canRestart())) return;
      installing = true;
      log(`[maj] installation automatique de la version ${state.version}`);
      await install(true);
    } catch (e) { installing = false; log(`[maj] installation automatique : ${e.message}`); }
  }, 60e3);
  const onFocus = () => { if (Date.now() - last > 3600e3 && state.status !== 'ready' && state.status !== 'downloading') run(); };
  return { state, check: run, install, onFocus };
};
