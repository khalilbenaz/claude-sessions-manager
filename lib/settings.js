'use strict';
// Réglages (#6), modèles de session (#14), bibliothèque de prompts (#16), groupes (#13).
// Stockés côté serveur : partagés entre la fenêtre de l'app et un navigateur.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  theme: 'system',          // system (suit Windows / macOS) | light | dark
  lang: 'auto',             // auto | fr | en
  replyLanguage: 'app',     // langue des réponses de Claude : app (= langue de l'interface) | fr | en | es | ar | de | it | pt | claude (réglage de Claude Code)
  fontSize: 14,
  fontFamily: '',
  defaultModel: 'opus',
  defaultMode: '',
  editor: 'auto',           // auto | code | cursor | windsurf | zed | idea | subl | custom
  editorCommand: '',
  notifications: true,
  sound: 'off',             // off | soft | bell (coupé par défaut depuis 3.4.0)
  dnd: false,               // ne pas déranger
  longRunMinutes: 0,        // alerte si une session travaille plus de N min (0 = jamais)
  waitingMinutes: 10,       // rappel si une session attend depuis N min (0 = jamais)
  autoUpdate: true,
  autoRestart: true,        // installer la mise à jour prête et redémarrer seul, fenêtre cachée ou ordinateur inactif, aucune session au travail
  worktreeDefault: false,
  compactSidebar: false,
  lockOnHide: true,         // reverrouiller les sessions protégées quand la fenêtre est masquée
  autoLockMinutes: 0,       // reverrouiller après N minutes d'inactivité (0 = jamais)
  remoteAll: false,         // accès depuis l'app Claude (Remote Control) pour toutes les nouvelles sessions
  minimizeToTray: true,     // « réduire » = masquer dans la zone de notification / barre de menus
  closeToTray: true,        // « fermer » = masquer (sinon quitte l'app ; les sessions continuent dans tous les cas)
  layout: '1',              // 1 | 2c | 2r | 4
  onboarded: false,
  soundOffMigrated: true,   // marqueur de la migration 3.4.0 (son coupé une fois)
  syncCode: '',             // code de synchro (#27) : vide = synchronisation désactivée
  syncMachine: '',          // nom de cette machine vu par les autres (vide = nom d'hôte)
  syncRoots: '',            // racines de dossiers « alias=chemin », une par ligne
  syncServer: '',           // serveur de synchro (vide = serveur par défaut, voir lib/sync.js)
  groupList: '',            // groupes créés à la main, un par ligne (visibles même vides)
  statusLine: true,        // barre d'état de CSM dans Claude Code (quotas + reset), si l'utilisateur n'a pas la sienne
  syncTranscripts: true,    // synchroniser aussi les conversations (chiffrées de bout en bout)
  syncGroups: true,         // synchroniser la liste des groupes (vides compris)
  syncTemplates: true,      // synchroniser les modèles de session
  syncUsage: true,          // publier l'usage de Claude de cette machine (agrégats chiffrés, vue « toutes les machines »)
  syncPlugins: true,        // plugins Claude Code : les mêmes sur toutes les machines synchronisées
  syncExtensions: true,     // synchroniser les extensions importées (installées sur les autres machines)
  authReminder: true,       // prévenir avant l'expiration de la connexion de Claude Code et proposer de la renouveler
  authWarnDays: 5,          // prévenir N jours avant (Claude Code prévient à 3 jours)
  nativeMemory: true,       // ancien réglage (≤ 3.12) : remplacé par memoryEngine, lu une fois pour la migration
  memoryEngine: 'native',   // mémoire des sessions : native (lib/memory.js) | claude-mem (installé au besoin) | off (désactivée avant la 3.15)
  memoryEngineChosenAt: 0,  // date du dernier choix fait ici (seul un choix explicite est partagé par la synchro)
  autoCompactWindow: 'model', // compactage automatique : model (fenêtre complète du modèle) | claude (réglage de Claude Code) | 200000 | 400000
  syncSessionMemory: true,  // partager la mémoire choisie (native ou claude-mem) entre les machines, chiffrée
  syncClaudeRules: true,    // partager ~/.claude/CLAUDE.md (et les .md qu'il importe, ~/.claude/rules)
  syncClaudeSkills: true,   // partager ~/.claude/skills
  syncClaudeAgents: true,   // partager ~/.claude/agents et ~/.claude/commands
  syncClaudeMemory: true,   // partager la mémoire automatique de Claude (~/.claude/projects/<dossier>/memory)
  claudeSyncReview: true,   // règles, skills, agents et commandes reçus : attendre une validation avant de les écrire
  syncMinutes: 5,           // synchronisation automatique toutes les N minutes (5, 10, 30 ou 60)
  queueQuotaPause: true,    // file d'attente en pause près de la limite des 5 h, reprise à la réinitialisation
  queueQuotaThreshold: 95,  // seuil (% du quota 5 h) de la pause
  queueResumeAfterLimit: true, // à la réinitialisation, envoyer « continue » aux sessions coupées par la limite
};
const MAXLEN = { syncRoots: 4000, groupList: 4000 };
const TYPES = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, typeof v]));
const ENUMS = {
  theme: ['dark', 'light', 'system'], lang: ['auto', 'fr', 'en'], replyLanguage: ['app', 'fr', 'en', 'es', 'ar', 'de', 'it', 'pt', 'claude'], sound: ['off', 'soft', 'bell'],
  layout: ['1', '2c', '2r', '4'], editor: ['auto', 'code', 'cursor', 'windsurf', 'zed', 'idea', 'subl', 'custom'],
  defaultMode: ['', 'acceptEdits', 'plan', 'bypassPermissions'], syncMinutes: [5, 10, 30, 60],
  memoryEngine: ['native', 'claude-mem', 'off'], queueQuotaThreshold: [80, 90, 95, 99], autoCompactWindow: ['model', 'claude', '200000', '400000'],
};

// Prompts proposés au premier lancement.
const STARTER_PROMPTS = [
  { id: 'relire', title: 'Relire les modifications', tags: 'revue', text: 'Relis toutes les modifications en cours dans ce dépôt (git diff). Signale les bugs, les cas oubliés, les problèmes de sécurité et de lisibilité, par ordre de gravité, avec le fichier et la ligne. Ne modifie rien.' },
  { id: 'tests', title: 'Écrire les tests', tags: 'tests', text: 'Écris des tests pour le code modifié récemment : cas nominal, cas limites et erreurs. Utilise le framework de test déjà présent dans le projet, lance les tests et corrige jusqu’à ce qu’ils passent.' },
  { id: 'expliquer', title: 'Expliquer ce code', tags: 'compréhension', text: 'Explique simplement ce que fait ce code, comment les morceaux s’articulent et les points délicats :\n\n{selection}' },
  { id: 'commit', title: 'Préparer un commit', tags: 'git', text: 'Regarde les modifications en cours, regroupe-les logiquement et propose un message de commit clair (titre court + explication du pourquoi). Ne committe pas sans mon accord.' },
  { id: 'bug', title: 'Corriger un bug', tags: 'bug', text: 'Voici un bug : [décris le symptôme]. Trouve la cause racine (reproduis d’abord), corrige-la avec le changement le plus petit possible et ajoute un test qui échouait avant le correctif.' },
  { id: 'plan', title: 'Proposer un plan avant de coder', tags: 'plan', text: 'Avant d’écrire du code, propose un plan : fichiers à toucher, étapes, risques et questions ouvertes. Attends ma validation.' },
  { id: 'doc', title: 'Documenter', tags: 'doc', text: 'Mets à jour la documentation (README, commentaires utiles) pour refléter les dernières modifications de {dossier}. Reste concis.' },
  { id: 'resume', title: 'Résumer où on en est', tags: 'suivi', text: 'Résume en quelques lignes ce qui a été fait dans cette session, ce qui reste à faire et les points à vérifier.' },
];

function load(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } }
function save(file, v) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
const str = (v, n = 200) => String(v ?? '').slice(0, n);

module.exports = function (ctx) {
  const { route, json, readBody, sessions, publicView, persist, broadcast, DATA } = ctx;
  const F = { settings: path.join(DATA, 'settings.json'), templates: path.join(DATA, 'templates.json'), prompts: path.join(DATA, 'prompts.json') };

  const get = () => ({ ...DEFAULTS, ...load(F.settings, {}) });
  // Nouvelle installation : les migrations ci-dessous ne la concernent pas (sinon elles s'appliqueraient au
  // 2e démarrage, une fois le fichier créé, et rétabliraient par exemple le partage de la mémoire).
  if (!fs.existsSync(F.settings)) save(F.settings, { soundOffMigrated: true, memoryChoiceMigrated: true });
  // 3.4.0 : le son de notification est coupé une fois pour toutes les installations existantes
  // (il reste réactivable dans Réglages › Notifications).
  { const cur = load(F.settings, null); if (cur && !cur.soundOffMigrated) { cur.sound = 'off'; cur.soundOffMigrated = true; save(F.settings, cur); } }
  // 3.13.0 : « mémoire native » décochée = aucune mémoire choisie dans l'app (claude-mem reste au choix)
  { const cur = load(F.settings, null); if (cur && !cur.memoryEngine) { cur.memoryEngine = cur.nativeMemory === false ? 'off' : 'native'; save(F.settings, cur); } }
  // 3.15.0 : une seule mémoire au choix (native ou claude-mem) et une seule case pour la partager.
  {
    const cur = load(F.settings, null);
    if (cur && !cur.memoryChoiceMigrated) {
      if (cur.memoryEngine === 'both') cur.memoryEngine = 'claude-mem';
      else if (!['claude-mem', 'off'].includes(cur.memoryEngine)) cur.memoryEngine = 'native'; // « Aucune » reste désactivée
      cur.syncSessionMemory = (cur.memoryEngine === 'claude-mem' ? cur.syncMemory : cur.syncNativeMemory) !== false;
      cur.memoryChoiceMigrated = true;
      save(F.settings, cur);
    }
  }
  ctx.getSettings = get;
  // Réglages modifiés par la synchro (lib/sync) : même effet qu'un PUT, sans renvoi vers la synchro.
  ctx.patchSettings = patch => { const cur = { ...get(), ...patch }; save(F.settings, cur); broadcast({ t: 'settings', settings: cur }); };

  route('GET', /^\/api\/settings$/, async ({ res }) => json(res, 200, get()));
  route('PUT', /^\/api\/settings$/, async ({ req, res }) => {
    const b = await readBody(req);
    const cur = get();
    for (const [k, v] of Object.entries(b || {})) {
      if (!(k in DEFAULTS) || typeof v !== TYPES[k]) continue;
      if (ENUMS[k] && !ENUMS[k].includes(v)) continue;
      cur[k] = typeof v === 'string' ? str(v, MAXLEN[k] || 400) : typeof v === 'number' ? Math.max(0, Math.min(10000, v)) : v;
    }
    save(F.settings, cur);
    broadcast({ t: 'settings', settings: cur });
    if ('memoryEngine' in (b || {})) { cur.memoryEngineChosenAt = Date.now(); save(F.settings, cur); ctx.memoryEngineChanged?.(); }
    if (['groupList', 'syncGroups', 'syncTemplates', 'syncUsage', 'syncExtensions', 'syncPlugins', 'syncTranscripts', 'syncSessionMemory', 'syncClaudeRules', 'syncClaudeSkills', 'syncClaudeAgents', 'syncClaudeMemory', 'syncMinutes', 'memoryEngine'].some(k => k in (b || {}))) ctx.syncChanged?.();
    json(res, 200, cur);
  });

  // ---------------------------------------------------------------- modèles de session
  const cleanTemplate = t => ({
    id: /^[\w-]{1,40}$/.test(t.id || '') ? t.id : Math.random().toString(36).slice(2, 10),
    name: str(t.name, 80) || 'Modèle', cwd: str(t.cwd, 1000), model: str(t.model, 40), mode: str(t.mode, 40),
    extra: str(t.extra, 500), worktree: !!t.worktree, prompt: str(t.prompt, 8000), group: str(t.group, 60),
  });
  ctx.getTemplates = () => load(F.templates, []);
  ctx.setTemplates = list => { const v = list.slice(0, 200).map(cleanTemplate); save(F.templates, v); broadcast({ t: 'templates', templates: v }); };
  route('GET', /^\/api\/templates$/, async ({ res }) => json(res, 200, load(F.templates, [])));
  route('PUT', /^\/api\/templates$/, async ({ req, res }) => {
    const list = (await readBody(req));
    if (!Array.isArray(list)) return json(res, 400, { error: 'liste attendue' });
    const v = list.slice(0, 200).map(cleanTemplate);
    save(F.templates, v); broadcast({ t: 'templates', templates: v });
    ctx.syncChanged?.();
    json(res, 200, v);
  });

  // ---------------------------------------------------------------- bibliothèque de prompts
  const cleanPrompt = p => ({
    id: /^[\w-]{1,40}$/.test(p.id || '') ? p.id : Math.random().toString(36).slice(2, 10),
    title: str(p.title, 100) || 'Prompt', text: str(p.text, 20000), tags: str(p.tags, 200),
  });
  // Première utilisation : bibliothèque de départ (modifiable ; si l'utilisateur la vide, elle reste vide).
  route('GET', /^\/api\/prompts$/, async ({ res }) => {
    if (!fs.existsSync(F.prompts)) save(F.prompts, STARTER_PROMPTS.map(cleanPrompt));
    json(res, 200, load(F.prompts, []));
  });
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
