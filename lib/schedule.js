'use strict';
// Demandes programmées : envoyer un prompt à une session, ou lancer un modèle de session, à une heure donnée
// (une fois, ou certains jours de la semaine). Session occupée ou en pause de quota : le prompt passe par sa
// file d'attente (lib/queue.js), qui l'envoie dès que possible. Rattrapage : une échéance manquée pendant que
// l'app était fermée est lancée au démarrage si elle date de moins de 2 h. Données : DATA/schedules.json.
const fs = require('fs');
const path = require('path');

const MAX = 100, CATCH_UP = 2 * 3600e3;
const MODES = ['', 'default', 'acceptEdits', 'plan', 'bypassPermissions'];

// prochaine échéance (ms) après `from`, ou 0 ; x.days vide = une seule fois (x.date « AAAA-MM-JJ »)
function nextRun(x, from = Date.now()) {
  const [h, m] = String(x.time || '').split(':').map(Number);
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return 0;
  if (!x.days?.length) {
    const d = new Date(`${x.date}T00:00:00`);
    if (isNaN(d)) return 0;
    d.setHours(h, m, 0, 0);
    return d.getTime() > from ? d.getTime() : 0;
  }
  for (let i = 0; i < 8; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0);
    if (d.getTime() > from && x.days.includes(d.getDay())) return d.getTime();
  }
  return 0;
}
// échéance la plus récente déjà passée (pour savoir si elle a été lancée), ou 0
function lastDue(x, now = Date.now()) {
  const [h, m] = String(x.time || '').split(':').map(Number);
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return 0;
  if (!x.days?.length) { const d = new Date(`${x.date}T00:00:00`); if (isNaN(d)) return 0; d.setHours(h, m, 0, 0); return d.getTime() <= now ? d.getTime() : 0; }
  for (let i = 0; i < 8; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(h, m, 0, 0);
    if (d.getTime() <= now && x.days.includes(d.getDay())) return d.getTime();
  }
  return 0;
}

module.exports = function (ctx) {
  const { route, json, readBody, sessions, publicView, persist, broadcast, DATA } = ctx;
  const FILE = path.join(DATA, 'schedules.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
  const save = list => { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 }); fs.renameSync(tmp, FILE); };
  const clean = list => (Array.isArray(list) ? list : []).slice(0, MAX).map(x => ({
    id: /^[\w-]{1,40}$/.test(x?.id || '') ? x.id : Math.random().toString(36).slice(2, 10),
    name: String(x?.name || '').slice(0, 80),
    time: /^\d{2}:\d{2}$/.test(x?.time || '') ? x.time : '09:00',
    days: Array.isArray(x?.days) ? [...new Set(x.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [],
    date: /^\d{4}-\d{2}-\d{2}$/.test(x?.date || '') ? x.date : '',
    target: x?.target === 'template' ? 'template' : 'session',
    session: /^\w{1,40}$/.test(x?.session || '') ? x.session : '',
    template: /^[\w-]{1,40}$/.test(x?.template || '') ? x.template : '',
    text: String(x?.text || '').slice(0, 20000),
    enabled: x?.enabled !== false,
    lastRun: Number(x?.lastRun) || 0, lastResult: String(x?.lastResult || '').slice(0, 200),
  }));
  const view = () => load().map(x => ({ ...x, next: x.enabled ? nextRun(x) : 0 }));

  function run(x) {
    if (x.target === 'template') {
      const t = (ctx.getTemplates?.() || []).find(t => t.id === x.template);
      if (!t) return 'modèle introuvable';
      const args = [/^[\w.[][\w.:[\]-]{0,59}$/.test(t.model || '') && `--model ${t.model}`, MODES.includes(t.mode) && t.mode && `--permission-mode ${t.mode}`, ctx.safeArgs ? ctx.safeArgs(t.extra) : '']
        .filter(Boolean).join(' ');
      const s = ctx.createSession({ cwd: t.cwd, name: x.name || t.name, args, group: t.group || undefined, initialPrompt: [t.prompt, x.text].filter(Boolean).join('\n\n') || undefined });
      return `session « ${s.name} » lancée`;
    }
    const s = sessions.get(x.session);
    if (!s) return 'session introuvable';
    if (!x.text.trim()) return 'prompt vide';
    if (s.pty && s.status === 'idle' && !s.quotaWait && !s.queue?.length && !s.lock) { ctx.sendPrompt(s, x.text); return 'envoyé'; }
    // occupée, arrêtée, verrouillée ou en pause de quota : mis en file d'attente
    s.queue = [...(s.queue || []), { id: Math.random().toString(36).slice(2, 10), text: x.text }].slice(-50);
    persist(); broadcast({ t: 'session', s: publicView(s) });
    return s.pty ? 'mis en file d’attente' : 'mis en file d’attente (session arrêtée)';
  }

  function tick(now = Date.now()) {
    const list = load();
    let changed = false;
    for (const x of list) {
      if (!x.enabled) continue;
      const due = lastDue(x, now);
      if (!due || due <= x.lastRun || now - due > CATCH_UP) continue;
      let r; try { r = run(x); } catch (e) { r = 'échec : ' + e.message; }
      x.lastRun = now; x.lastResult = r; changed = true;
      if (!x.days.length) x.enabled = false; // une seule fois : faite
    }
    if (changed) { save(list); broadcast({ t: 'schedules', list: view() }); }
  }
  ctx.scheduleTick = tick;
  const timer = setInterval(tick, Number(process.env.CSM_SCHEDULE_EVERY) || 30e3);
  timer.unref?.();

  route('GET', /^\/api\/schedules$/, async ({ res }) => json(res, 200, view()));
  route('PUT', /^\/api\/schedules$/, async ({ req, res }) => {
    const prev = new Map(load().map(x => [x.id, x]));
    // une échéance déjà passée au moment de l'enregistrement (nouvelle demande, heure ou jours changés,
    // réactivée) n'est pas lancée tout de suite
    const same = (a, b) => a && a.time === b.time && a.date === b.date && String(a.days) === String(b.days) && a.enabled === b.enabled;
    const list = clean(await readBody(req)).map(x => {
      const p = prev.get(x.id);
      return { ...x, lastRun: Math.max(x.lastRun, p?.lastRun || 0, same(p, x) ? 0 : lastDue(x)) };
    });
    save(list);
    broadcast({ t: 'schedules', list: view() });
    json(res, 200, view());
  });
  route('POST', /^\/api\/schedules\/(\w+)\/run$/, async ({ res, m }) => {
    const list = load(), x = list.find(y => y.id === m[1]);
    if (!x) return json(res, 404, { error: 'inconnue' });
    let r; try { r = run(x); } catch (e) { r = 'échec : ' + e.message; }
    x.lastRun = Date.now(); x.lastResult = r; save(list);
    broadcast({ t: 'schedules', list: view() });
    json(res, 200, { result: r });
  });
};
module.exports.nextRun = nextRun;
module.exports.lastDue = lastDue;
