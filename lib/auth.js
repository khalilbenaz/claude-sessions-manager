'use strict';
// Connexion de Claude Code à claude.ai (« Your login expires in 3 days · run /login to renew »).
// Surveille la date d'expiration de la connexion et propose de la renouveler en un clic, sans quitter l'app :
// `claude auth login` tourne dans un terminal caché, le navigateur s'ouvre sur la page de connexion, et le code
// éventuellement demandé se colle dans l'app. Rien n'est lu ni stocké d'autre que la date d'expiration.
//
// Date d'expiration : fichier de connexion de Claude Code (~/.claude/.credentials.json, Windows / Linux) ; sur
// macOS il est dans le trousseau, que l'app ne lit pas (cela demanderait une autorisation) : l'expiration est
// alors déduite des avertissements que Claude affiche dans les sessions.
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');

const DAY = 86400e3;
const strip = s => s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, ' ').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
const WARN = /login expires in (\d+) (minute|hour|day)s?/i;
const EXPIRED = /(OAuth token has expired|login has expired|Please run \/login|Invalid API key · Please run \/login)/i;

module.exports = function (ctx) {
  const { route, json, readBody, sessions, broadcast } = ctx;
  const credFile = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json');
  const st = { expiresAt: 0, source: '', renewing: false, url: '', prompt: false, error: '', renewedAt: 0, seenAt: 0 };

  function fromFile() {
    try {
      const o = JSON.parse(fs.readFileSync(credFile(), 'utf8')).claudeAiOauth || {};
      // refreshTokenExpiresAt : fin de la connexion (le jeton d'accès, lui, se renouvelle tout seul)
      const t = Number(o.refreshTokenExpiresAt) || 0;
      return t > 0 ? t : 0;
    } catch { return 0; }
  }
  // Avertissement de Claude dans une session (fin du tampon) : « expires in N days », ou connexion expirée.
  function fromOutput() {
    if (Date.now() - st.renewedAt < 20 * 3600e3) return 0; // ancien message encore à l'écran après un renouvellement
    let best = 0;
    for (const s of sessions.values()) {
      if (!s.buf) continue;
      const tail = strip(s.buf.slice(-6000));
      const m = [...tail.matchAll(new RegExp(WARN, 'gi'))].pop();
      if (m) {
        const n = Number(m[1]), unit = m[2].toLowerCase();
        const at = Date.now() + n * (unit === 'day' ? DAY : unit === 'hour' ? 3600e3 : 60e3);
        if (!best || at < best) best = at;
      } else if (EXPIRED.test(tail)) best = Date.now() - 1;
    }
    return best;
  }
  function refresh() {
    const f = fromFile();
    const o = f ? 0 : fromOutput();
    const next = f || o || 0;
    const changed = next !== st.expiresAt;
    st.expiresAt = next; st.source = f ? 'file' : o ? 'output' : '';
    if (changed) broadcast({ t: 'auth', status: view() });
  }
  const warnDays = () => Math.max(1, Number(ctx.getSettings?.().authWarnDays) || 5);
  const view = () => {
    const left = st.expiresAt ? st.expiresAt - Date.now() : null;
    return {
      expiresAt: st.expiresAt, source: st.source, msLeft: left,
      warn: left !== null && left < warnDays() * DAY, expired: left !== null && left <= 0,
      renewing: st.renewing, url: st.url, prompt: st.prompt, error: st.error, renewedAt: st.renewedAt,
      enabled: ctx.getSettings?.().authReminder !== false,
    };
  };
  ctx.authStatus = () => { refresh(); return view(); };

  // ---------------------------------------------------------------- renouvellement
  let proc = null;
  function renew() {
    if (proc) return;
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|ELECTRON_RUN_AS_NODE$)/.test(k)) delete env[k];
    const args = [...ctx.splitArgs(process.env.CSM_CLAUDE_ARGS || ''), 'auth', 'login'];
    let out = '';
    Object.assign(st, { renewing: true, url: '', prompt: false, error: '' });
    try {
      proc = pty.spawn(ctx.CLAUDE, args, { name: 'xterm-256color', cols: 4000, rows: 30, cwd: os.homedir(), env });
    } catch (e) {
      Object.assign(st, { renewing: false, error: 'lancement impossible : ' + e.message });
      broadcast({ t: 'auth', status: view() });
      return;
    }
    const p = proc;
    const timer = setTimeout(() => { try { p.kill(); } catch { } }, 15 * 60e3); // abandon après 15 min
    p.onData(d => {
      out = (out + d).slice(-20000);
      const plain = strip(out);
      const osc = out.match(/\x1b\]8;[^;]*;(https:\/\/[^\x07\x1b]+)/);
      const url = osc ? osc[1] : (plain.match(/https:\/\/\S*oauth\S*/) || [])[0];
      const prompt = /paste code/i.test(plain);
      if ((url && url !== st.url) || prompt !== st.prompt) { st.url = url || st.url; st.prompt = prompt; broadcast({ t: 'auth', status: view() }); }
    });
    p.onExit(({ exitCode }) => {
      clearTimeout(timer);
      proc = null;
      refresh();
      const ok = exitCode === 0 && !/error|failed|invalid/i.test(strip(out).slice(-400));
      Object.assign(st, { renewing: false, url: '', prompt: false, error: ok ? '' : (strip(out).trim().split('\n').pop() || `code ${exitCode}`).slice(0, 200) });
      if (ok) st.renewedAt = Date.now();
      if (ok && st.source !== 'file') { st.expiresAt = 0; st.source = ''; } // macOS : plus d'avertissement à suivre
      broadcast({ t: 'auth', status: view(), done: ok });
    });
    broadcast({ t: 'auth', status: view() });
  }

  route('GET', /^\/api\/auth$/, async ({ res }) => { refresh(); json(res, 200, view()); });
  route('POST', /^\/api\/auth\/renew$/, async ({ res }) => { renew(); json(res, 200, view()); });
  route('POST', /^\/api\/auth\/code$/, async ({ req, res }) => {
    const code = String((await readBody(req)).code || '').trim();
    if (!proc) return json(res, 409, { error: 'aucune connexion en cours' });
    if (!/^[\w#.~-]{4,400}$/.test(code)) return json(res, 400, { error: 'code invalide' });
    proc.write(code + '\r');
    json(res, 200, view());
  });
  route('POST', /^\/api\/auth\/cancel$/, async ({ res }) => {
    if (proc) { try { proc.kill(); } catch { } }
    json(res, 200, view());
  });

  setTimeout(refresh, 3000);
  setInterval(refresh, 10 * 60e3).unref?.();
  // un avertissement vient d'apparaître dans une session : relu vite (sans attendre 10 min)
  setInterval(() => { if (st.source !== 'file') refresh(); }, 60e3).unref?.();
};
