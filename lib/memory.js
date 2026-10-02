'use strict';
// Mémoire native des sessions (sans claude-mem) : à chaque fin de tour (hook Stop / SessionEnd), le transcript
// de la session est relu depuis là où on s'était arrêté et résumé dans une fiche : première demande, demandes
// suivantes, dernière réponse de chaque tour, fichiers modifiés, outils utilisés. Les fiches sont gardées dans
// DATA/memory/sessions/<id>.json et rassemblées par dossier dans DATA/memory/projects/*.md (lisibles et
// cherchables). Au démarrage d'une session (hook SessionStart), les fiches récentes du même dossier sont
// données à Claude comme contexte. Avec un code de synchro, les fiches sont partagées chiffrées entre les
// machines (lib/sync.js, préfixe « nm- ») : le dossier est comparé sous sa forme portable ({home}/…).
//
// Réglages : memoryEngine = native (capture + contexte), syncSessionMemory (partage par la synchro).
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_PROMPTS = 40, MAX_ANSWERS = 12, MAX_FILES = 80;
const PROMPT_LEN = 600, ANSWER_LEN = 1500;
const CONTEXT_BUDGET = 9000, CONTEXT_SESSIONS = 6, OTHER_PROJECTS = 5;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const ID = /^[\w-]{6,60}$/;

const clip = (s, n) => { s = String(s || '').replace(/\s+\n/g, '\n').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p && p.type === 'text').map(p => p.text).join('\n') : '';
// Messages « utilisateur » qui n'en sont pas : sorties de commandes, rappels système, interruptions.
const noise = t => !t || /^\s*<(command-|local-command|system-reminder|bash-|user-memory|task-notification)/.test(t) || /^\[Request interrupted/.test(t);

function blank(id) {
  return { v: 1, id, title: '', project: '', cwd: '', machine: '', branch: '', created: 0, updated: 0, first: '', prompts: [], answers: [], last: '', files: [], tools: {} };
}

// Ajoute à la fiche les lignes (objets JSON du transcript) lues depuis la dernière fois.
function digest(e, lines) {
  for (const o of lines) {
    if (!o || typeof o !== 'object') continue;
    const ts = Date.parse(o.timestamp) || 0;
    if (o.type === 'ai-title' || o.type === 'custom-title' || o.type === 'summary') {
      const t = o.customTitle || o.aiTitle || o.title || (o.type === 'summary' && o.summary);
      if (t && (o.type === 'custom-title' || !e.titleFixed)) { e.title = clip(t, 120); if (o.type === 'custom-title') e.titleFixed = true; }
      continue;
    }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    if (o.isSidechain) continue; // sous-agents
    if (ts) { e.created = e.created || ts; e.updated = Math.max(e.updated, ts); }
    if (o.cwd) e.cwd = o.cwd;
    if (o.gitBranch) e.branch = o.gitBranch;
    const c = o.message && o.message.content;
    if (o.type === 'user') {
      if (o.isMeta || o.isCompactSummary || o.toolUseResult) continue;
      const t = textOf(c);
      if (noise(t)) continue;
      if (e.last) { e.answers.push(e.last); e.last = ''; }
      const p = clip(t, PROMPT_LEN);
      if (!e.first) e.first = p;
      e.prompts.push({ t: ts, text: p });
    } else {
      for (const part of Array.isArray(c) ? c : []) {
        if (part.type === 'text' && part.text && part.text.trim()) e.last = clip(part.text, ANSWER_LEN);
        else if (part.type === 'tool_use' && part.name) {
          e.tools[part.name] = (e.tools[part.name] || 0) + 1;
          const f = part.input && (part.input.file_path || part.input.notebook_path);
          if (EDIT_TOOLS.has(part.name) && f && !e.files.includes(f)) e.files.push(f);
        }
      }
    }
  }
  if (e.prompts.length > MAX_PROMPTS) e.prompts = e.prompts.slice(-MAX_PROMPTS);
  if (e.answers.length > MAX_ANSWERS) e.answers = e.answers.slice(-MAX_ANSWERS);
  if (e.files.length > MAX_FILES) e.files = e.files.slice(-MAX_FILES);
  return e;
}

// Lit le transcript à partir de l'octet off ; renvoie les lignes complètes et le nouvel offset.
function readFrom(file, off) {
  const size = fs.statSync(file).size;
  if (size < off) return null; // transcript réécrit : tout relire
  if (size === off) return { lines: [], off };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - off);
    fs.readSync(fd, buf, 0, buf.length, off);
    const end = buf.lastIndexOf(10);
    if (end < 0) return { lines: [], off };
    const lines = [];
    for (const l of buf.subarray(0, end).toString('utf8').split('\n')) { if (l) try { lines.push(JSON.parse(l)); } catch { } }
    return { lines, off: off + end + 1 };
  } finally { fs.closeSync(fd); }
}

const rel = (f, cwd) => cwd && f.startsWith(cwd + path.sep) ? f.slice(cwd.length + 1) : f;
const day = t => t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '?';
const titleOf = e => e.title || clip(e.first, 80) || e.id.slice(0, 8);

function section(e, full) {
  const out = [`## ${titleOf(e)} — ${day(e.updated)} · ${e.machine || '?'}${e.branch ? ' · ' + e.branch : ''}`];
  if (e.first) out.push(`Demande : ${full ? e.first : clip(e.first, 300)}`);
  const later = e.prompts.slice(1).slice(full ? 0 : -3);
  if (later.length) out.push((full ? 'Demandes suivantes :' : 'Dernières demandes :') + '\n' + later.map(p => '- ' + (full ? p.text : clip(p.text, 200))).join('\n'));
  const answers = [...e.answers, e.last].filter(Boolean);
  if (full && answers.length > 1) out.push('Réponses (fin de tour) :\n' + answers.slice(0, -1).map(a => '- ' + clip(a, 400).replace(/\n+/g, ' ')).join('\n'));
  if (answers.length) out.push(`Où on en est : ${full ? answers[answers.length - 1] : clip(answers[answers.length - 1], 700)}`);
  if (e.files.length) out.push(`Fichiers modifiés : ${e.files.slice(full ? 0 : -15).map(f => rel(f, e.cwd)).join(', ')}`);
  if (full) out.push(`Session : ${e.id}`);
  return out.join('\n');
}

const sameProject = (a, b, isWin) => !!a && !!b && (isWin ? a.toLowerCase() === b.toLowerCase() : a === b);
const slug = p => (String(p || 'sans-dossier').replace(/^\{(\w+)\}/, '$1').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'racine').slice(-100);

// Contexte donné à Claude au démarrage : sessions récentes du même dossier, puis autres dossiers récents.
function buildContext(entries, project, { exclude, dir, isWin } = {}) {
  const mine = entries.filter(e => e.id !== exclude && sameProject(e.project, project, isWin) && (e.first || e.last)).sort((a, b) => b.updated - a.updated);
  const others = new Map();
  for (const e of entries.slice().sort((a, b) => b.updated - a.updated)) {
    if (e.id === exclude || sameProject(e.project, project, isWin) || !e.project || others.has(e.project)) continue;
    others.set(e.project, e);
  }
  if (!mine.length && !others.size) return '';
  const head = ['# Mémoire partagée (Claude Sessions)',
    'Résumé des sessions précédentes, toutes machines confondues. À utiliser comme contexte : ne pas refaire ce qui est fait, vérifier dans le code avant de s’y fier.'];
  if (dir) head.push(`Mémoire complète, cherchable : ${path.join(dir, 'projects')}${mine.length ? ` (ce dossier : ${slug(project)}.md)` : ''}`);
  let out = head.join('\n');
  let n = 0;
  for (const e of mine.slice(0, CONTEXT_SESSIONS)) {
    const s = '\n\n' + section(e, false);
    if (out.length + s.length > CONTEXT_BUDGET && n) break;
    out += s.slice(0, CONTEXT_BUDGET); n++;
  }
  if (others.size) {
    const lines = [...others.values()].slice(0, OTHER_PROJECTS).map(e => `- ${e.project} : ${titleOf(e)} (${day(e.updated)})`);
    const s = '\n\n## Autres dossiers récents\n' + lines.join('\n');
    if (out.length + s.length <= CONTEXT_BUDGET + 1500) out += s;
  }
  return out;
}

function renderProject(project, entries) {
  return `# Mémoire — ${project || 'sans dossier'}\n\n` + entries.slice().sort((a, b) => b.updated - a.updated).map(e => section(e, true)).join('\n\n---\n\n') + '\n';
}

// Fiche telle qu'elle est partagée (sans les champs propres à cette machine).
const shared = e => { const { off, file, ...rest } = e; return rest; };
function valid(e) {
  return !!e && typeof e === 'object' && e.v === 1 && ID.test(e.id || '') && Array.isArray(e.prompts) && Array.isArray(e.answers) &&
    Array.isArray(e.files) && e.tools && typeof e.tools === 'object' && Number.isFinite(e.updated);
}

module.exports = function (ctx) {
  const { route, json, sessions, transcriptPath, DATA, IS_WIN } = ctx;
  const dir = path.join(DATA, 'memory'), sdir = path.join(dir, 'sessions'), pdir = path.join(dir, 'projects');
  fs.mkdirSync(sdir, { recursive: true }); fs.mkdirSync(pdir, { recursive: true });
  const settings = () => ctx.getSettings?.() || {};
  const on = () => (settings().memoryEngine || 'native') === 'native';
  const machine = () => String(settings().syncMachine || '').trim() || os.hostname();
  const { parseRoots, toPortable } = require('./sync');
  const portable = cwd => toPortable(cwd, parseRoots(settings().syncRoots, os.homedir(), IS_WIN));

  const cache = new Map();
  for (const f of fs.readdirSync(sdir)) {
    if (!f.endsWith('.json')) continue;
    try { const e = JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8')); if (valid(e)) cache.set(e.id, e); } catch { }
  }
  const save = e => {
    cache.set(e.id, e);
    const tmp = path.join(sdir, e.id + '.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(e), { mode: 0o600 });
    fs.renameSync(tmp, path.join(sdir, e.id + '.json'));
    dirty.add(e.project);
    clearTimeout(renderTimer); renderTimer = setTimeout(render, 500);
  };
  const dirty = new Set();
  let renderTimer = null;
  function render() {
    for (const p of dirty) {
      const list = [...cache.values()].filter(e => sameProject(e.project, p, IS_WIN));
      const f = path.join(pdir, slug(p) + '.md');
      try { list.length ? fs.writeFileSync(f, renderProject(p, list), { mode: 0o600 }) : fs.rmSync(f, { force: true }); } catch { }
    }
    dirty.clear();
  }

  function capture(id) {
    if (!on() || !ID.test(id || '')) return;
    const file = transcriptPath(id);
    if (!file) return;
    let e = cache.get(id);
    e = e ? { ...e } : blank(id);
    let r = e.file === file && Number.isInteger(e.off) ? readFrom(file, e.off) : null;
    if (!r) { // première lecture, ou fiche reçue d'une autre machine : on repart du transcript entier
      e = { ...blank(id), title: e.title, titleFixed: e.titleFixed, created: e.created };
      r = readFrom(file, 0);
    }
    if (!r.lines.length && e.off === r.off) return;
    const before = e.project;
    digest(e, r.lines);
    e.off = r.off; e.file = file;
    e.project = portable(e.cwd); e.machine = machine();
    if (before && before !== e.project) dirty.add(before);
    save(e);
  }
  const timers = new Map();
  const later = (id, ms = 1500) => { clearTimeout(timers.get(id)); timers.set(id, setTimeout(() => { timers.delete(id); try { capture(id); } catch (e) { console.error('mémoire', e.message); } }, ms)); };
  ctx.on('idle', s => s.claudeSessionId && later(s.claudeSessionId));
  ctx.on('end', s => s.claudeSessionId && later(s.claudeSessionId, 300));
  ctx.on('exit', s => s.claudeSessionId && later(s.claudeSessionId, 300));

  // Contexte injecté par le hook SessionStart (voir hook.js).
  ctx.memoryContext = (s, claudeId) => {
    if (!on() || !s.cwd) return '';
    try { return buildContext([...cache.values()], portable(s.cwd), { exclude: claudeId, dir, isWin: IS_WIN }); } catch { return ''; }
  };

  // Pour lib/sync.js
  ctx.memory = {
    on, list: () => [...cache.values()], shared,
    get: id => cache.get(id),
    // fiche reçue : gardée si plus récente ; l'offset local est oublié (la prochaine capture relit tout)
    put(e) {
      if (!valid(e)) return false;
      const cur = cache.get(e.id);
      if (cur && cur.updated >= e.updated) return false;
      if (cur && cur.project !== e.project) dirty.add(cur.project);
      save({ ...e });
      return true;
    },
  };

  route('GET', /^\/api\/memory$/, async ({ res }) => json(res, 200, {
    enabled: on(), dir, items: [...cache.values()].sort((a, b) => b.updated - a.updated).slice(0, 500)
      .map(e => ({ id: e.id, title: titleOf(e), project: e.project, machine: e.machine, updated: e.updated, first: clip(e.first, 200), last: clip(e.last, 300), prompts: e.prompts.length, files: e.files.length })),
  }));

  // Rattrapage : sessions de l'app déjà utilisées sans fiche (première version, ou mémoire réactivée).
  setTimeout(() => {
    let n = 0;
    for (const s of sessions.values()) if (s.claudeSessionId && !cache.has(s.claudeSessionId)) later(s.claudeSessionId, 3000 + 400 * n++);
  }, 2000).unref?.();
};

module.exports.digest = digest;
module.exports.blank = blank;
module.exports.buildContext = buildContext;
module.exports.renderProject = renderProject;
module.exports.slug = slug;
module.exports.valid = valid;
