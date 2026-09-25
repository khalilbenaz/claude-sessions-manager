'use strict';
// Faux Claude Code pour les tests : même interface que claude pour ce qu'utilise Claude Sessions
// (--settings avec hooks, --resume, transcript .jsonl, invite interactive, collage entre crochets).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
if (argv.includes('--version')) { console.log('0.0.0 (faux claude)'); process.exit(0); }

const settings = JSON.parse(fs.readFileSync(opt('--settings'), 'utf8'));
const resume = opt('--resume');
const fork = argv.includes('--fork-session');
const sessionId = resume && !fork ? resume : crypto.randomUUID();
const cwd = process.cwd();
const dir = path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const transcript = path.join(dir, `${sessionId}.jsonl`);
if (resume && fork) { const src = fs.readdirSync(path.dirname(dir)).map(d => path.join(path.dirname(dir), d, `${resume}.jsonl`)).find(fs.existsSync); if (src) fs.copyFileSync(src, transcript); }
const log = o => fs.appendFileSync(transcript, JSON.stringify({ ...o, sessionId, cwd, timestamp: new Date().toISOString() }) + '\n');

function hook(ev, data = {}) {
  return Promise.all((settings.hooks[ev] || []).flatMap(h => h.hooks).map(h => new Promise(res => {
    const p = exec(h.command, { env: process.env }, () => res());
    p.stdin.end(JSON.stringify({ session_id: sessionId, hook_event_name: ev, cwd, ...data }));
  })));
}

const out = s => process.stdout.write(s);
let turn = 0;
async function prompt(text) {
  turn++;
  log({ type: 'user', message: { role: 'user', content: text }, uuid: crypto.randomUUID() });
  await hook('UserPromptSubmit', { prompt: text });
  await hook('PreToolUse', { tool_name: 'Read' });
  const images = (text.match(/\S+\.(png|jpe?g|gif|webp)/gi) || []).length;
  const reply = `echo: ${text.replace(/\S+\.(png|jpe?g|gif|webp)/gi, m => `[Image #${images}]`)}`;
  log({ type: 'assistant', message: { id: `msg_${turn}_${sessionId.slice(0, 6)}`, model: 'claude-haiku-4-5', role: 'assistant',
    content: [{ type: 'text', text: reply }, { type: 'tool_use', name: 'Read', input: { file_path: path.join(cwd, 'README.md') } }],
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } } });
  if (/touch (\S+)/.test(text)) fs.writeFileSync(path.join(cwd, RegExp.$1), `créé par le faux claude (${turn})\n`);
  out(`\r\n● ${reply}\r\n`);
  if (/attends/.test(text)) await hook('Notification', { message: 'Claude attend ta permission' });
  await hook('Stop');
  out('\r\n❯ ');
}

(async () => {
  await hook('SessionStart', { source: resume ? 'resume' : 'startup' });
  out(`FAUX CLAUDE prêt ${resume ? '(reprise ' + resume.slice(0, 8) + ')' : ''} — session ${sessionId}\r\n❯ `);
  let buf = '';
  process.stdin.setRawMode?.(true);
  process.stdin.on('data', d => {
    buf += d.toString('utf8');
    buf = buf.replace(/\x1b\[20[01]~/g, '');
    let i;
    while ((i = buf.search(/[\r\n]/)) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line === '/exit') { hook('SessionEnd').then(() => process.exit(0)); return; }
      if (line) prompt(line);
    }
  });
})();
