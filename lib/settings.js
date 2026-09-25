'use strict';
// Réglages (#6), modèles de session (#14), bibliothèque de prompts (#16), groupes (#13).
// Stockés côté serveur : partagés entre la fenêtre de l'app et un navigateur.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  theme: 'dark',            // dark | light | system
  lang: 'auto',             // auto | fr | en
  fontSize: 14,
  fontFamily: '',
  defaultModel: 'opus',
  defaultMode: '',
  editor: 'auto',           // auto | code | cursor | windsurf | zed | idea | subl | custom
  editorCommand: '',
  notifications: true,
  sound: 'soft',            // off | soft | bell
  dnd: false,               // ne pas déranger
  longRunMinutes: 0,        // alerte si une session travaille plus de N min (0 = jamais)
  waitingMinutes: 10,       // rappel si une session attend depuis N min (0 = jamais)
  autoUpdate: true,
  worktreeDefault: false,
  compactSidebar: false,
  layout: '1',              // 1 | 2c | 2r | 4
  onboarded: false,
};
const TYPES = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, typeof v]));
const ENUMS = {
  theme: ['dark', 'light', 'system'], lang: ['auto', 'fr', 'en'], sound: ['off', 'soft', 'bell'],
  layout: ['1', '2c', '2r', '4'], editor: ['auto', 'code', 'cursor', 'windsurf', 'zed', 'idea', 'subl', 'custom'],
  defaultMode: ['', 'acceptEdits', 'plan', 'bypassPermissions'],
};

function load(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } }
function save(file, v) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, file); }
const str = (v, n = 200) => String(v ?? '').slice(0, n);

module.exports = function (ctx) {
  const { route, json, readBody, sessions, publicView, persist, broadcast, DATA } = ctx;
  const F = { settings: path.join(DATA, 'settings.json'), templates: path.join(DATA, 'templates.json'), prompts: path.join(DATA, 'prompts.json') };

  const get = () => ({ ...DEFAULTS, ...load(F.settings, {}) });
  ctx.getSettings = get;

  route('GET', /^\/api\/settings$/, async ({ res }) => json(res, 200, get()));
  route('PUT', /^\/api\/settings$/, async ({ req, res }) => {
    const b = await readBody(req);
    const cur = get();
    for (const [k, v] of Object.entries(b || {})) {
      if (!(k in DEFAULTS) || typeof v !== TYPES[k]) continue;
      if (ENUMS[k] && !ENUMS[k].includes(v)) continue;
      cur[k] = typeof v === 'string' ? str(v, 400) : typeof v === 'number' ? Math.max(0, Math.min(10000, v)) : v;
    }
    save(F.settings, cur);
    broadcast({ t: 'settings', settings: cur });
    json(res, 200, cur);
  });

  // ---------------------------------------------------------------- modèles de session
  const cleanTemplate = t => ({
    id: /^[\w-]{1,40}$/.test(t.id || '') ? t.id : Math.random().toString(36).slice(2, 10),
    name: str(t.name, 80) || 'Modèle', cwd: str(t.cwd, 1000), model: str(t.model, 40), mode: str(t.mode, 40),
    extra: str(t.extra, 500), worktree: !!t.worktree, prompt: str(t.prompt, 8000), group: str(t.group, 60),
  });
  route('GET', /^\/api\/templates$/, async ({ res }) => json(res, 200, load(F.templates, [])));
  route('PUT', /^\/api\/templates$/, async ({ req, res }) => {
    const list = (await readBody(req));
    if (!Array.isArray(list)) return json(res, 400, { error: 'liste attendue' });
    const v = list.slice(0, 200).map(cleanTemplate);
    save(F.templates, v); broadcast({ t: 'templates', templates: v });
    json(res, 200, v);
  });

  // ---------------------------------------------------------------- bibliothèque de prompts
  const cleanPrompt = p => ({
    id: /^[\w-]{1,40}$/.test(p.id || '') ? p.id : Math.random().toString(36).slice(2, 10),
    title: str(p.title, 100) || 'Prompt', text: str(p.text, 20000), tags: str(p.tags, 200),
  });
  route('GET', /^\/api\/prompts$/, async ({ res }) => json(res, 200, load(F.prompts, [])));
  route('PUT', /^\/api\/prompts$/, async ({ req, res }) => {
    const list = await readBody(req);
    if (!Array.isArray(list)) return json(res, 400, { error: 'liste attendue' });
    const v = list.slice(0, 500).map(cleanPrompt);
    save(F.prompts, v); broadcast({ t: 'prompts', prompts: v });
    json(res, 200, v);
  });

  // ---------------------------------------------------------------- groupes, épinglage, couleur
  route('POST', /^\/api\/sessions\/(\w+)\/meta$/, async ({ req, res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const b = await readBody(req);
    if ('group' in b) s.group = str(b.group, 60).trim() || undefined;
    if ('pinned' in b) s.pinned = !!b.pinned || undefined;
    if ('color' in b) s.color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : undefined;
    if ('alerts' in b) s.alerts = b.alerts && typeof b.alerts === 'object' ? { mute: !!b.alerts.mute } : undefined;
    persist(); broadcast({ t: 'session', s: publicView(s) });
    json(res, 200, publicView(s));
  });
};
module.exports.DEFAULTS = DEFAULTS;
