'use strict';
// Emplacements et réglages communs au serveur et à la CLI, par OS.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// --port=N (utilisé par la tâche planifiée / le LaunchAgent, qui ne transmettent pas d'environnement) ou CSM_PORT.
const argPort = (process.argv.find(a => a.startsWith('--port=')) || '').slice(7);
const PORT = Number(argPort || process.env.CSM_PORT || 7890);
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function defaultDataDir() {
  if (IS_WIN) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'claude-sessions');
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'claude-sessions');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'claude-sessions');
}
// Un port non standard a ses propres données (permet de tester sans toucher l'instance principale).
const DATA = process.env.CSM_DATA || (PORT === 7890 ? defaultDataDir() : `${defaultDataDir()}-${PORT}`);
const LEGACY_DATA = path.join(ROOT, 'data'); // v1 : données dans le dossier du code

// Même nom d'instance pour la tâche planifiée / le LaunchAgent / le raccourci.
const SUFFIX = PORT === 7890 ? '' : ` ${PORT}`;
const TASK_NAME = `Claude Sessions Manager${SUFFIX}`;
const LAUNCHD_LABEL = PORT === 7890 ? 'com.claude-sessions.server' : `com.claude-sessions.server.${PORT}`;
const APP_NAME = `Claude Sessions${SUFFIX}`;

// Lancé depuis le Finder/Dock ou launchd, le PATH peut être minimal (/usr/bin:/bin…) si le shell de connexion
// n'a pas répondu à temps : claude (script « #!/usr/bin/env node ») échoue alors en « env: node: No such file
// or directory » (code 127). On complète le PATH avec les emplacements usuels de node/claude, sans rien retirer.
function extraPathDirs() {
  if (IS_WIN) return [];
  const home = os.homedir();
  // Gestionnaires de versions de node d'abord (comme dans le shell) : Homebrew peut porter un claude périmé.
  const dirs = [path.join(home, '.local', 'bin'), path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
    path.join(home, '.volta', 'bin')];
  const nvm = path.join(home, '.nvm', 'versions', 'node');
  try { for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, 'bin')); } catch {}
  return [...dirs, path.join(home, '.bun', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
}
function addToPath(dirs) {
  const cur = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) if (d && !cur.includes(d) && fs.existsSync(d)) cur.push(d);
  process.env.PATH = cur.join(path.delimiter);
}
addToPath(extraPathDirs());
// Dossier réel d'un exécutable (ex. …/fnm/node-versions/<v>/installation/bin) : contient le node qui l'accompagne.
function addBinDirToPath(bin) {
  if (!bin || !path.isAbsolute(bin)) return;
  const dirs = [path.dirname(bin)];
  try { dirs.push(path.dirname(fs.realpathSync(bin))); } catch {}
  addToPath(dirs);
}

function which(cmd) {
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).map(s => s.trim()).find(Boolean) || null;
  } catch { return null; }
}

// fnm expose des dossiers temporaires par shell (…/fnm_multishells/<pid>_…/bin) : on remplace le dossier par
// son emplacement réel (…/node-versions/<v>/installation/bin), en gardant le nom du lien (qui suit les mises à jour).
// Les autres chemins (liens stables comme ~/.local/bin/claude ou /opt/homebrew/bin/node) sont laissés tels quels.
function stablePath(p) {
  if (!p || !/fnm_multishells/.test(p)) return p;
  try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch { return p; }
}

// claude peut ne pas être dans le PATH d'un service (launchd a un PATH minimal) : emplacements usuels en secours.
function resolveClaude() {
  if (process.env.CSM_CLAUDE) return process.env.CSM_CLAUDE;
  const found = which('claude');
  if (found) return stablePath(found);
  const home = os.homedir();
  const candidates = IS_WIN
    ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')]
    : [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'),
      '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || 'claude';
}

module.exports = { addBinDirToPath, stablePath, ROOT, PORT, IS_WIN, IS_MAC, DATA, LEGACY_DATA, TASK_NAME, LAUNCHD_LABEL, APP_NAME, which, resolveClaude };
