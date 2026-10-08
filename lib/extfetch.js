'use strict';
// Import d'extensions depuis un lien : fichier GitHub (blob, raw), dossier ou dépôt GitHub (ses *.csm.json, à la
// racine ou dans csm/ ou extensions/), gist, ou n'importe quelle adresse https d'un fichier .csm.json.
// Dépôt privé : on réessaie avec le jeton de la CLI GitHub (`gh auth token`) si elle est connectée ; ce jeton
// n'est envoyé qu'à l'API GitHub, jamais ailleurs, et sans suivre de redirection.
const { execFile } = require('child_process');

const MAX_FILE = 256 * 1024;
const GH_API = () => (process.env.CSM_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const local = u => ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);

let ghToken; // undefined = pas encore demandé ; '' = indisponible
function getGhToken() {
  if (process.env.CSM_NO_GH_TOKEN) return Promise.resolve('');
  if (ghToken !== undefined) return Promise.resolve(ghToken);
  return new Promise(r => execFile('gh', ['auth', 'token'], { timeout: 5000, windowsHide: true, encoding: 'utf8' },
    (e, out) => r(ghToken = e ? '' : String(out || '').trim())));
}

async function readCapped(res) {
  const text = await res.text();
  if (text.length > MAX_FILE) throw new Error('fichier trop gros (256 Ko au plus)');
  return text;
}

async function gh(apiPath, raw) {
  const url = GH_API() + apiPath;
  const headers = { 'User-Agent': 'claude-sessions', Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  let res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if ([401, 403, 404].includes(res.status)) {
    const tok = await getGhToken();
    if (tok) res = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${tok}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  }
  if (res.status === 404) throw new Error('introuvable sur GitHub (dépôt privé : connecte la CLI GitHub avec « gh auth login »)');
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  return raw ? readCapped(res) : res.json();
}

const enc = p => p.split('/').map(encodeURIComponent).join('/');
const contents = (o, r, p, ref) => `/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}/contents/${enc(p)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;

async function ghFile(o, r, p, ref) { return [{ name: p.split('/').pop(), content: await gh(contents(o, r, p, ref), true) }]; }
async function ghDir(o, r, p, ref) {
  const dirs = p ? [p] : ['', 'csm', 'extensions'];
  for (const d of dirs) {
    let list;
    try { list = await gh(contents(o, r, d, ref)); } catch (e) { if (d && !p) continue; throw e; }
    const files = (Array.isArray(list) ? list : []).filter(f => f.type === 'file' && f.name.endsWith('.csm.json'));
    if (files.length) {
      const out = [];
      for (const f of files.slice(0, 20)) out.push({ name: f.name, content: await gh(contents(o, r, f.path, ref), true) });
      return out;
    }
  }
  return [];
}

// → [{ name, content }]
async function fetchExtensions(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { throw new Error('lien invalide'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local(u))) throw new Error('lien https attendu');
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (u.hostname === 'github.com' && parts.length >= 2) {
    const [o, r0, kind, ref, ...p] = parts, r = r0.replace(/\.git$/, '');
    if ((kind === 'blob' || kind === 'raw') && ref && p.length) return ghFile(o, r, p.join('/'), ref);
    if (kind === 'tree' && ref) return ghDir(o, r, p.join('/'), ref);
    if (!kind) return ghDir(o, r, '', '');
    throw new Error('lien GitHub non reconnu : fichier, dossier ou dépôt attendu');
  }
  if (u.hostname === 'raw.githubusercontent.com' && parts.length >= 4) {
    const [o, r, ref, ...p] = parts;
    return ghFile(o, r, p.join('/'), ref);
  }
  if (u.hostname === 'gist.github.com' && parts.length) {
    const g = await gh(`/gists/${encodeURIComponent(parts[parts.length - 1])}`);
    return Object.values(g.files || {}).filter(f => /\.json$/.test(f.filename) && !f.truncated)
      .map(f => ({ name: f.filename, content: String(f.content || '') }));
  }
  const res = await fetch(u, { headers: { 'User-Agent': 'claude-sessions' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`l'adresse a répondu ${res.status}`);
  return [{ name: parts.pop() || u.hostname, content: await readCapped(res) }];
}

module.exports = { fetchExtensions, _resetToken: () => { ghToken = undefined; } };
