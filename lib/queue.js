'use strict';
// File d'attente de prompts (#17) : « quand cette session a fini, envoyer ce prompt ».
// Envoi en « collage entre crochets » (bracketed paste) : le texte multiligne arrive d'un bloc dans Claude.
//
// Quota (réglages queueQuotaPause, queueQuotaThreshold, queueResumeAfterLimit) : près de la limite des 5 h
// (barre d'état : event « quota ») ou quand Claude affiche « limite atteinte · reset 15h », la file d'attente
// n'envoie plus rien (s.quotaWait = heure de reprise) ; à la réinitialisation (+1 min) elle repart, et les
// sessions coupées par la limite reçoivent « continue ».

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[@-_]/g;
// messages de Claude Code (en début de ligne, pas une phrase d'une réponse) : « 5-hour limit reached ∙ resets 3pm »,
// « Claude usage limit reached. Your limit will reset at 3pm », « You've hit your limit · resets 7pm (Europe/Paris) »
const LIMIT = /^\s*(?:⎿\s*)?(?:\d+-hour limit reached|Claude (?:AI )?usage limit reached|You['’]ve hit your (?:usage )?limit)/im;
// « resets 3pm », « reset at 15:30 », « resets 7:45 PM (Europe/Paris) » → prochaine occurrence de cette heure
function parseReset(text, now = new Date()) {
  const m = /resets?\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!m) return 0;
  let h = Number(m[1]) % 24; const min = Number(m[2] || 0), ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return 0;
  const d = new Date(now); d.setHours(h, min, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

module.exports = function (ctx) {
  const { route, on, json, readBody, sessions, publicView, persist, broadcast } = ctx;
  const settings = () => ctx.getSettings?.() || {};
  // dernier quota connu (barre d'état), et limite atteinte (texte de Claude) : jusqu'à quand attendre
  const quota = { pct: null, resetAt: 0, at: 0, blockedUntil: 0 };
  ctx.quota = quota;
  // Prévision : rythme moyen (points de %/h) sur la dernière heure de la fenêtre en cours ; limite atteinte avant
  // la réinitialisation ? (null : pas assez de mesures, ou rythme nul)
  function forecast() {
    const h = (quota.hist || []).filter(x => x.resetAt === quota.resetAt && Date.now() - x.t < 3600e3);
    if (h.length < 2 || quota.pct === null) return null;
    const a = h[0], b = h[h.length - 1], dt = (b.t - a.t) / 3600e3;
    if (dt < 0.05) return null;
    const perHour = (b.pct - a.pct) / dt;
    if (perHour <= 0) return { perHour: 0, limitAt: 0 };
    const limitAt = Date.now() + ((100 - quota.pct) / perHour) * 3600e3;
    return { perHour, limitAt: quota.resetAt && limitAt > quota.resetAt ? 0 : limitAt };
  }
  route('GET', /^\/api\/quota$/, async ({ res }) => json(res, 200, {
    five: quota.pct === null ? null : { pct: quota.pct, resetAt: quota.resetAt }, seven: quota.seven || null, at: quota.at,
    forecast: forecast(), pause: { on: settings().queueQuotaPause !== false, threshold: Number(settings().queueQuotaThreshold) || 95 }, hist: (quota.hist || []).filter(x => x.resetAt === quota.resetAt).map(x => ({ t: x.t, pct: x.pct })),
    ...(ctx.quota7?.() || {}), // hist7 et forecast7 (lib/usage.js)
  }));
  const waitUntil = (now = Date.now()) => {
    if (settings().queueQuotaPause === false) return 0;
    if (quota.blockedUntil > now) return quota.blockedUntil;
    const th = Number(settings().queueQuotaThreshold) || 95;
    if (quota.pct !== null && quota.pct >= th && quota.resetAt > now && now - quota.at < 6 * 3600e3) return quota.resetAt;
    return 0;
  };
  let resumeTimer = null;
  function planResume(until) {
    clearTimeout(resumeTimer);
    const margin = Number(process.env.CSM_QUOTA_MARGIN) || 60e3; // reprise 1 min après la réinitialisation
    resumeTimer = setTimeout(resumeAll, Math.max(200, until - Date.now() + margin));
    resumeTimer.unref?.();
  }
  function resumeAll() {
    const until = waitUntil();
    if (until) return planResume(until);
    for (const s of sessions.values()) {
      if (!s.quotaWait && !s.limitHit) continue;
      const cut = s.limitHit;
      delete s.quotaWait; delete s.limitHit;
      broadcast({ t: 'session', s: publicView(s) });
      if (!s.pty || s.status !== 'idle') continue;
      if (s.queue?.length) next(s);
      else if (cut && settings().queueResumeAfterLimit !== false) sendPrompt(s, 'continue');
    }
    persist();
  }
  on('quota', (s, d) => {
    const pct = Number(d.pct), r = Number(d.resetAt);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1000) return;
    quota.pct = pct; quota.resetAt = Number.isFinite(r) && r > 0 ? r : 0; quota.at = Date.now();
    // quota sur 7 jours (barre latérale) ; diffusé au plus toutes les 20 s
    const p7 = Number(d.seven?.pct), r7 = Number(d.seven?.resetAt);
    if (Number.isFinite(p7) && p7 >= 0 && p7 <= 1000) quota.seven = { pct: p7, resetAt: Number.isFinite(r7) && r7 > 0 ? r7 : 0 };
    // historique (6 h) pour la prévision du tableau d'usage
    const hist = quota.hist || (quota.hist = []);
    if (!hist.length || hist[hist.length - 1].pct !== pct || Date.now() - hist[hist.length - 1].t > 5 * 60e3) hist.push({ t: Date.now(), pct, resetAt: quota.resetAt });
    while (hist.length > 400 || (hist.length && Date.now() - hist[0].t > 6 * 3600e3)) hist.shift();
    if (Date.now() - (quota.sentAt || 0) > 20e3) { quota.sentAt = Date.now(); broadcast({ t: 'quota' }); }
    // nouvelle fenêtre de quota (réinitialisation plus tardive que la reprise prévue) : la limite est passée.
    // Une autre session qui affiche encore l'ancienne fenêtre ne lève pas la pause.
    if (quota.blockedUntil && quota.resetAt > quota.blockedUntil + 5 * 60e3) quota.blockedUntil = 0;
    const until = waitUntil();
    if (until) planResume(until); else if ([...sessions.values()].some(x => x.quotaWait)) resumeAll();
  });
  // texte de Claude : « limite atteinte … reset 15h » ; retenu si la session s'arrête juste après (pas une
  // simple mention dans une réponse), et ignoré si la barre d'état indique encore du quota
  const tail = new Map(), seen = new Map();
  on('data', (s, d) => {
    const txt = ((tail.get(s.id) || '') + String(d).replace(ANSI, '')).slice(-600);
    tail.set(s.id, txt);
    const m = LIMIT.exec(txt);
    if (!m) return;
    // la ligne du message doit aussi annoncer la réinitialisation (« resets 3pm », « reset at 3pm »)
    const line = txt.slice(m.index).split(/[\r\n]/).find(l => l.trim()) || '';
    if (!/\bresets?\b/i.test(line)) return;
    seen.set(s.id, { at: Date.now(), until: parseReset(line) });
    tail.set(s.id, '');
    // la fin du tour (hook Stop) peut arriver avant cette ligne (machine chargée) : appliquée tout de suite
    if (s.status === 'idle' && Date.now() - (idleAt.get(s.id) || 0) < 5e3 && !s.quotaWait) pauseForLimit(s);
  });
  const idleAt = new Map();
  function pauseForLimit(s) {
    if (!limitHitNow(s)) return false;
    s.quotaWait = waitUntil() || quota.blockedUntil;
    persist(); broadcast({ t: 'session', s: publicView(s) }); planResume(s.quotaWait);
    return true;
  }
  function limitHitNow(s) {
    const h = seen.get(s.id);
    if (!h || Date.now() - h.at > 15e3) return false;
    seen.delete(s.id);
    quota.blockedUntil = Math.max(quota.blockedUntil, h.until || (quota.resetAt > Date.now() ? quota.resetAt : Date.now() + 30 * 60e3));
    s.limitHit = true;
    return true;
  }
  const clean = q => (Array.isArray(q) ? q : []).slice(0, 50)
    .map(x => ({ id: /^[\w-]{1,40}$/.test(x.id || '') ? x.id : Math.random().toString(36).slice(2, 10), text: String(x.text || '').slice(0, 20000) }))
    .filter(x => x.text.trim());

  function sendPrompt(s, text) {
    if (!s.pty) return false;
    s.pty.write(`\x1b[200~${text}\x1b[201~`);
    setTimeout(() => { if (s.pty) s.pty.write('\r'); }, 150);
    return true;
  }
  ctx.sendPrompt = sendPrompt;

  route('PUT', /^\/api\/sessions\/(\w+)\/queue$/, async ({ req, res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const q = clean(await readBody(req));
    s.queue = q.length ? q : undefined;
    persist(); broadcast({ t: 'session', s: publicView(s) });
    // session déjà prête : on envoie tout de suite le premier
    if (q.length && s.pty && s.status === 'idle') next(s);
    json(res, 200, publicView(s));
  });

  // Envoi direct d'un prompt (bibliothèque, envoi groupé, modèle de session)
  route('POST', /^\/api\/sessions\/(\w+)\/prompt$/, async ({ req, res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const { text, submit } = await readBody(req);
    if (!s.pty) return json(res, 409, { error: 'session arrêtée' });
    const t = String(text || '').slice(0, 20000);
    if (submit === false) s.pty.write(`\x1b[200~${t}\x1b[201~`); else sendPrompt(s, t);
    json(res, 200, { ok: true });
  });

  function next(s) {
    if (!s.queue || !s.queue.length || !s.pty) return;
    const until = waitUntil();
    if (until) { // quota : en pause jusqu'à la réinitialisation
      if (s.quotaWait !== until) { s.quotaWait = until; persist(); broadcast({ t: 'session', s: publicView(s) }); }
      return planResume(until);
    }
    if (s.quotaWait) delete s.quotaWait;
    const [first, ...rest] = s.queue;
    s.queue = rest.length ? rest : undefined;
    persist(); broadcast({ t: 'session', s: publicView(s) });
    s.fromQueue = true; // temps de travail « sans toi » (tableau d'usage, lib/usage.js)
    setTimeout(() => sendPrompt(s, first.text), 600); // laisse Claude afficher son invite
  }
  on('idle', s => {
    idleAt.set(s.id, Date.now());
    if (pauseForLimit(s)) return;
    next(s);
  });
  ctx.parseReset = parseReset;
  // redémarrage pendant une pause : reprise replanifiée, ou pause périmée retirée (la file repart au repos)
  setTimeout(() => {
    const later = Math.max(0, ...[...sessions.values()].map(s => s.quotaWait || 0));
    if (later > Date.now()) { quota.blockedUntil = later; planResume(later); }
    else if ([...sessions.values()].some(s => s.quotaWait)) resumeAll();
  }, 1000).unref?.();
  // session revenue au repos (après une relance) avec une file en attente et sans pause : on la vide
  on('start', s => { if (s.queue?.length && !waitUntil()) setTimeout(() => { if (s.status === 'idle') next(s); }, 2500); });

  // Premier prompt d'un modèle de session : envoyé dès que la session est prête.
  on('start', s => { if (s.initialPrompt) { const t = s.initialPrompt; delete s.initialPrompt; setTimeout(() => sendPrompt(s, t), 1200); } });
};
