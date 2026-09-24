'use strict';
// Claude Sessions Manager — serveur local : héberge N sessions Claude Code (PTY) et les expose à une UI web.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.CSM_PORT || 7890);
const HOST = '127.0.0.1';
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const SCROLLBACK_MAX = 2 * 1024 * 1024;

fs.mkdirSync(DATA, { recursive: true });

// Journal fichier : le serveur tourne sans console (tâche planifiée / conhost --headless).
const LOG = path.join(DATA, 'server.log');
for (const k of ['log', 'error']) {
  const orig = console[k];
  console[k] = (...a) => {
    try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${a.map(x => x instanceof Error ? x.stack : String(x)).join(' ')}\n`); } catch { }
    orig.apply(console, a);
  };
}
process.on('uncaughtException', e => console.error('uncaught', e));
process.on('unhandledRejection', e => console.error('unhandled', e));

// Jeton anti-CSRF : un site tiers ne peut pas lire la page, donc ne peut pas connaître le jeton.
const TOKEN_FILE = path.join(DATA, 'token');
const TOKEN = fs.existsSync(TOKEN_FILE)
  ? fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  : (() => { const t = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(TOKEN_FILE, t); return t; })();

function resolveClaude() {
  if (process.env.CSM_CLAUDE) return process.env.CSM_CLAUDE;
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(cmd, ['claude'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean).trim();
  } catch { return 'claude'; }
}
const CLAUDE = resolveClaude();

// Hooks injectés via --settings : remontent l'état réel (travaille / attend / idle) et le session_id Claude.
const HOOK_SCRIPT = path.join(ROOT, 'hook.js').replace(/\\/g, '/');
const hookCmd = (ev) => [{ hooks: [{ type: 'command', command: `node "${HOOK_SCRIPT}" ${ev}`, timeout: 5 }] }];
const HOOK_SETTINGS = path.join(DATA, 'hooks-settings.json');
fs.writeFileSync(HOOK_SETTINGS, JSON.stringify({
  hooks: {
    SessionStart: hookCmd('start'),
    UserPromptSubmit: hookCmd('working'),
    PreToolUse: hookCmd('working'),
    Notification: hookCmd('attention'),
    Stop: hookCmd('idle'),
    SessionEnd: hookCmd('end'),
  },
}, null, 2));

// ---------------------------------------------------------------- sessions gérées
const STORE = path.join(DATA, 'sessions.json');
/** @type {Map<string, any>} */
const sessions = new Map();

function persist() {
  const list = [...sessions.values()].map(s => ({
    id: s.id, name: s.name, cwd: s.cwd, args: s.args, claudeSessionId: s.claudeSessionId,
    createdAt: s.createdAt, order: s.order, wantRun: s.wantRun !== false,
  }));
  fs.writeFileSync(STORE, JSON.stringify(list, null, 2));
}

function publicView(s) {
  return {
    id: s.id, name: s.name, cwd: s.cwd, args: s.args, status: s.status, message: s.message,
    claudeSessionId: s.claudeSessionId, createdAt: s.createdAt, lastActivity: s.lastActivity,
    statusSince: s.statusSince, alive: !!s.pty, order: s.order,
  };
}

function setStatus(s, status, message) {
  if (s.status === status && s.message === message) return;
  s.status = status;
  s.message = message || '';
  s.statusSince = Date.now();
  broadcast({ t: 'session', s: publicView(s) });
}

function splitArgs(str) {
  const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(str || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// Claude n'écrit le transcript qu'au premier message : une session jamais utilisée n'est pas reprenable.
function transcriptExists(id) {
  try { return fs.readdirSync(PROJECTS).some(d => fs.existsSync(path.join(PROJECTS, d, `${id}.jsonl`))); } catch { return false; }
}

function spawnSession(s, { resume } = {}) {
  if (resume && !transcriptExists(resume)) resume = undefined;
  const args = ['--settings', HOOK_SETTINGS, ...splitArgs(s.args)];
  if (resume) args.push('--resume', resume);
  const env = { ...process.env, CSM_ID: s.id, CSM_PORT: String(PORT), CSM_TOKEN: TOKEN, COLORTERM: 'truecolor' };
  // Si le serveur a été lancé depuis une session Claude, ne pas propager son identité (sinon session "enfant" non persistée).
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$)/i.test(k)) delete env[k];
  let p;
  try {
    p = pty.spawn(CLAUDE, args, {
      name: 'xterm-256color', cols: s.cols || 120, rows: s.rows || 32,
      cwd: fs.existsSync(s.cwd) ? s.cwd : os.homedir(), env,
    });
  } catch (e) {
    s.pty = null;
    appendOut(s, `\r\n\x1b[31m[csm] Échec du lancement : ${e.message}\x1b[0m\r\n`);
    setStatus(s, 'exited', 'échec du lancement');
    return;
  }
  s.pty = p;
  if (s.wantRun !== true) { s.wantRun = true; persist(); }
  setStatus(s, 'starting');
  p.onData(d => { s.lastActivity = Date.now(); appendOut(s, d); });
  p.onExit(({ exitCode }) => {
    if (s.pty !== p || !sessions.has(s.id)) return; // relancée entre-temps, ou fermée
    s.pty = null;
    // Sortie volontaire (/exit) => ne pas la relancer au prochain démarrage. Le délai évite de marquer
    // "arrêtées" les sessions tuées par l'extinction de Windows (le serveur meurt avant l'échéance).
    setTimeout(() => {
      if (!shuttingDown && !s.pty && sessions.has(s.id)) { s.wantRun = false; persist(); }
    }, 8000);
    appendOut(s, `\r\n\x1b[90m[csm] session terminée (code ${exitCode})\x1b[0m\r\n`);
    setStatus(s, 'exited', `code ${exitCode}`);
  });
}

function appendOut(s, d) {
  s.buf += d;
  if (s.buf.length > SCROLLBACK_MAX) {
    // coupe au prochain saut de ligne pour limiter les séquences d'échappement tronquées
    let cut = s.buf.length - SCROLLBACK_MAX;
    const nl = s.buf.indexOf('\n', cut);
    s.buf = s.buf.slice(nl > 0 ? nl + 1 : cut);
  }
  broadcast({ t: 'out', id: s.id, d });
}

function createSession({ name, cwd, args, resume }) {
  cwd = cwd ? path.resolve(cwd.replace(/^~(?=$|[\\/])/, os.homedir())) : os.homedir();
  const id = crypto.randomBytes(6).toString('hex');
  const order = Math.max(0, ...[...sessions.values()].map(x => x.order || 0)) + 1;
  const s = {
    id, name: name || path.basename(cwd || '') || 'session', cwd: cwd || os.homedir(), args: args || '',
    claudeSessionId: resume || null, createdAt: Date.now(), lastActivity: Date.now(),
    status: 'starting', message: '', statusSince: Date.now(), buf: '', pty: null, order,
  };
  sessions.set(id, s);
  spawnSession(s, { resume });
  persist();
  broadcast({ t: 'session', s: publicView(s) });
  return s;
}

function killSession(s) {
  if (s.pty) { try { s.pty.kill(); } catch { } }
}

// Sessions de la dernière exécution du serveur (reboot, crash, csm restart) : celles qui tournaient sont
// relancées automatiquement avec --resume ; celles arrêtées volontairement restent reprenables d'un clic.
let shuttingDown = false;
const toRestore = [];
try {
  for (const x of JSON.parse(fs.readFileSync(STORE, 'utf8'))) {
    const s = { ...x, status: 'exited', message: 'arrêtée', statusSince: Date.now(), lastActivity: x.createdAt, buf: '', pty: null };
    sessions.set(x.id, s);
    if (x.wantRun !== false) toRestore.push(s);
    else s.buf = `\x1b[90m[csm] Session arrêtée. Cliquer « Reprendre » pour la relancer.\x1b[0m\r\n`;
  }
} catch { }

function restoreSessions() {
  toRestore.forEach((s, i) => setTimeout(() => {
    if (!sessions.has(s.id) || s.pty) return;
    s.buf = `\x1b[90m[csm] Session restaurée.\x1b[0m\r\n`;
    broadcast({ t: 'clear', id: s.id });
    spawnSession(s, { resume: s.claudeSessionId || undefined });
  }, i * 1200)); // échelonné : évite de lancer N claude + hooks en même temps
}

// ---------------------------------------------------------------- historique (~/.claude/projects)
const histCache = new Map(); // file -> { mtime, entry }

function readSlice(fd, pos, len) {
  const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.slice(0, n).toString('utf8');
}

function parseTranscript(file, stat) {
  const fd = fs.openSync(file, 'r');
  try {
    const HEAD = 96 * 1024, TAIL = 96 * 1024;
    const head = readSlice(fd, 0, Math.min(HEAD, stat.size));
    const tail = stat.size > HEAD ? readSlice(fd, Math.max(0, stat.size - TAIL), Math.min(TAIL, stat.size)) : '';
    let cwd = null, title = null, customTitle = null, lastPrompt = null, firstPrompt = null, branch = null;
    for (const line of (head + '\n' + tail).split('\n')) {
      if (!line.startsWith('{')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!cwd && o.cwd) cwd = o.cwd;
      if (!branch && o.gitBranch && o.gitBranch !== 'HEAD') branch = o.gitBranch;
      if (o.type === 'ai-title' && o.aiTitle) title = o.aiTitle;
      if (o.type === 'custom-title' && o.customTitle) customTitle = o.customTitle;
      if (o.type === 'summary' && o.summary && !title) title = o.summary;
      if (o.type === 'last-prompt' && o.lastPrompt) lastPrompt = o.lastPrompt;
      if (!firstPrompt && o.type === 'user' && o.message && !o.isMeta) {
        const c = o.message.content;
        const txt = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(p => p.type === 'text') || {}).text : null;
        if (txt && !txt.startsWith('<') && !txt.startsWith('Caveat:')) firstPrompt = txt;
      }
    }
    if (!cwd && !firstPrompt && !title) return null;
    return {
      id: path.basename(file, '.jsonl'), cwd, branch,
      title: customTitle || title || (firstPrompt || lastPrompt || '').slice(0, 120) || '(sans titre)',
      lastPrompt: (lastPrompt || firstPrompt || '').slice(0, 200),
      mtime: stat.mtimeMs, size: stat.size,
    };
  } finally { fs.closeSync(fd); }
}

function history() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS); } catch { return out; }
  for (const d of dirs) {
    if (/observer-sessions/i.test(d)) continue; // sessions internes de claude-mem
    const dir = path.join(PROJECTS, d);
    let files; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, f);
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (st.size < 200) continue;
      const c = histCache.get(file);
      if (c && c.mtime === st.mtimeMs) { if (c.entry) out.push(c.entry); continue; }
      let entry = null; try { entry = parseTranscript(file, st); } catch { }
      histCache.set(file, { mtime: st.mtimeMs, entry });
      if (entry) out.push(entry);
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------------------------------------------------------------- sélecteur de dossier natif
let picking = null;
function pickFolder(initial) {
  if (picking) return picking; // un seul dialogue à la fois
  const shell = process.env.CSM_PWSH || 'pwsh';
  const env = { ...process.env, CSM_INITIAL: initial || '' };
  picking = new Promise(resolve => {
    execFile(shell, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'pick-folder.ps1')],
      { env, windowsHide: true, timeout: 10 * 60 * 1000, encoding: 'utf8' },
      (err, stdout) => resolve(err ? null : (stdout || '').trim() || null));
  }).finally(() => { picking = null; });
  return picking;
}

// ---------------------------------------------------------------- sessions ouvertes dans un terminal
// Claude Code tient un registre des sessions interactives en cours : ~/.claude/sessions/<pid>.json.
const REGISTRY = path.join(os.homedir(), '.claude', 'sessions');

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

function externalSessions() {
  const managedIds = new Set([...sessions.values()].map(s => s.claudeSessionId).filter(Boolean));
  const managedPids = new Set([...sessions.values()].filter(s => s.pty).map(s => s.pty.pid));
  let files = []; try { files = fs.readdirSync(REGISTRY).filter(f => /^\d+\.json$/.test(f)); } catch { }
  const titles = new Map(history().map(h => [h.id, h.title]));
  const out = [];
  for (const f of files) {
    let o; try { o = JSON.parse(fs.readFileSync(path.join(REGISTRY, f), 'utf8')); } catch { continue; }
    if (o.kind !== 'interactive' || o.entrypoint !== 'cli' || !o.sessionId) continue; // exclut SDK / observateurs
    if (managedIds.has(o.sessionId) || managedPids.has(o.pid) || !pidAlive(o.pid)) continue;
    out.push({
      pid: o.pid, sessionId: o.sessionId, cwd: o.cwd, status: o.status, startedAt: o.startedAt,
      title: titles.get(o.sessionId) || path.basename(o.cwd || '') || o.sessionId.slice(0, 8),
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

// Déplace une session de terminal dans csm : arrête le processus du terminal puis reprend la conversation ici.
async function importExternal(pid, sessionId) {
  const ext = externalSessions().find(x => x.pid === pid && x.sessionId === sessionId);
  if (!ext) throw new Error('session introuvable (déjà fermée ou déjà dans csm)');
  try { process.kill(pid); } catch { }
  for (let i = 0; i < 50 && pidAlive(pid); i++) await new Promise(r => setTimeout(r, 100));
  if (pidAlive(pid)) throw new Error(`le processus ${pid} ne s'arrête pas`);
  await new Promise(r => setTimeout(r, 300)); // laisse le transcript se fermer
  return createSession({ cwd: ext.cwd, name: ext.title.slice(0, 40), resume: sessionId, args: '--model opus' });
}

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const STATIC = {
  '/xterm.js': 'node_modules/@xterm/xterm/lib/xterm.js',
  '/xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
  '/addon-fit.js': 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
  '/addon-web-links.js': 'node_modules/@xterm/addon-web-links/lib/addon-web-links.js',
};

function hostOk(req) {
  const h = (req.headers.host || '').toLowerCase();
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!hostOk(req)) { res.writeHead(403); return res.end('bad host'); }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace('__CSM_TOKEN__', TOKEN);
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  if (req.method === 'GET' && (STATIC[p] || /^\/[\w.-]+\.(js|css|svg|png)$/.test(p))) {
    const file = STATIC[p] ? path.join(ROOT, STATIC[p]) : path.join(ROOT, 'public', p.slice(1));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(file).pipe(res);
  }

  if (!p.startsWith('/api/')) { res.writeHead(404); return res.end(); }
  if (req.headers['x-csm-token'] !== TOKEN) return json(res, 401, { error: 'token' });

  try {
    if (p === '/api/hook' && req.method === 'POST') {
      const { csm, event, data } = await readBody(req);
      const s = sessions.get(csm);
      if (!s) return json(res, 404, {});
      if (data && data.session_id && s.claudeSessionId !== data.session_id) { s.claudeSessionId = data.session_id; persist(); }
      if (event === 'start') setStatus(s, 'idle');
      else if (event === 'working') setStatus(s, 'working', data && data.tool_name ? data.tool_name : '');
      else if (event === 'attention') setStatus(s, 'attention', (data && data.message) || 'attend une réponse');
      else if (event === 'idle') setStatus(s, 'idle', 'terminé');
      broadcast({ t: 'session', s: publicView(s) });
      return json(res, 200, {});
    }
    if (p === '/api/sessions' && req.method === 'GET') return json(res, 200, [...sessions.values()].map(publicView));
    if (p === '/api/sessions' && req.method === 'POST') {
      const b = await readBody(req);
      return json(res, 200, publicView(createSession(b)));
    }
    if (p === '/api/history' && req.method === 'GET') {
      const managed = new Set([...sessions.values()].map(s => s.claudeSessionId).filter(Boolean));
      return json(res, 200, history().slice(0, 400).map(h => ({ ...h, managed: managed.has(h.id) })));
    }
    if (p === '/api/external' && req.method === 'GET') return json(res, 200, externalSessions());
    if (p === '/api/import' && req.method === 'POST') {
      const { items } = await readBody(req);
      const done = [], errors = [];
      for (const it of items || []) {
        try { done.push(publicView(await importExternal(Number(it.pid), String(it.sessionId)))); }
        catch (e) { errors.push(`${it.title || it.sessionId}: ${e.message}`); }
      }
      return json(res, 200, { done, errors });
    }
    if (p === '/api/pick-folder' && req.method === 'POST') {
      const { initial } = await readBody(req);
      const picked = await pickFolder(initial);
      return json(res, 200, { path: picked });
    }
    if (p === '/api/order' && req.method === 'POST') {
      const { ids } = await readBody(req);
      (ids || []).forEach((id, i) => { const s = sessions.get(id); if (s) s.order = i + 1; });
      persist(); broadcastAll();
      return json(res, 200, {});
    }
    const m = p.match(/^\/api\/sessions\/(\w+)(?:\/(\w+))?$/);
    const s = m && sessions.get(m[1]);
    if (m && !s) return json(res, 404, { error: 'session inconnue' });
    if (s && req.method === 'DELETE' && !m[2]) {
      killSession(s); sessions.delete(s.id); persist();
      broadcast({ t: 'removed', id: s.id });
      return json(res, 200, {});
    }
    if (s && m[2] === 'rename' && req.method === 'POST') {
      const { name } = await readBody(req);
      s.name = String(name || s.name).slice(0, 80); persist();
      broadcast({ t: 'session', s: publicView(s) });
      return json(res, 200, publicView(s));
    }
    if (s && m[2] === 'kill' && req.method === 'POST') { s.wantRun = false; persist(); killSession(s); return json(res, 200, {}); }
    if (s && m[2] === 'restart' && req.method === 'POST') {
      killSession(s);
      s.buf += '\x1b[2J\x1b[H';
      broadcast({ t: 'clear', id: s.id });
      spawnSession(s, { resume: s.claudeSessionId || undefined });
      return json(res, 200, publicView(s));
    }
    if (s && m[2] === 'seen' && req.method === 'POST') {
      if (s.status === 'attention' || (s.status === 'idle' && s.message === 'terminé')) setStatus(s, 'idle', '');
      return json(res, 200, {});
    }
    return json(res, 404, { error: 'route' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(data);
}
function broadcastAll() { broadcast({ t: 'sessions', list: [...sessions.values()].map(publicView) }); }

server.on('upgrade', (req, sock, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!hostOk(req) || url.pathname !== '/ws' || url.searchParams.get('token') !== TOKEN) { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, ws => {
    clients.add(ws);
    ws.send(JSON.stringify({ t: 'sessions', list: [...sessions.values()].map(publicView) }));
    for (const s of sessions.values()) if (s.buf) ws.send(JSON.stringify({ t: 'replay', id: s.id, d: s.buf }));
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      const s = sessions.get(m.id);
      if (!s) return;
      if (m.t === 'input' && s.pty) s.pty.write(m.d);
      else if (m.t === 'resize' && m.cols > 10 && m.rows > 3) {
        s.cols = m.cols; s.rows = m.rows;
        if (s.pty) try { s.pty.resize(m.cols, m.rows); } catch { }
      }
    });
    ws.on('close', () => clients.delete(ws));
  });
});

server.on('error', e => { console.error('écoute impossible', e.message); process.exit(1); }); // ex. déjà lancé
server.listen(PORT, HOST, () => {
  fs.writeFileSync(path.join(DATA, 'server.pid'), String(process.pid));
  console.log(`Claude Sessions Manager -> http://${HOST}:${PORT}  (claude: ${CLAUDE})`);
  restoreSessions();
});

function shutdown() {
  shuttingDown = true;
  persist(); // avant de tuer : les sessions ouvertes seront restaurées au prochain démarrage
  for (const s of sessions.values()) killSession(s);
  persist();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
