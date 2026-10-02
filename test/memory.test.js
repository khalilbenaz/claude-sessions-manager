'use strict';
// Tests unitaires de la mémoire des sessions (résumé des transcripts, contexte donné au démarrage).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { digest, blank, buildContext, renderProject, slug, valid } = require('../lib/memory');

const T = n => new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString();
const user = (text, n, extra = {}) => ({ type: 'user', timestamp: T(n), cwd: '/w/app', message: { role: 'user', content: text }, ...extra });
const said = (parts, n) => ({ type: 'assistant', timestamp: T(n), cwd: '/w/app', gitBranch: 'main', message: { role: 'assistant', content: parts } });

test('digest : demandes, réponses, fichiers modifiés, bruit ignoré', () => {
  const e = digest(blank('abcdef12'), [
    user('<command-name>/clear</command-name>', 0),
    user('ajoute un bouton', 1),
    said([{ type: 'text', text: 'je regarde' }, { type: 'tool_use', name: 'Read', input: { file_path: '/w/app/a.js' } }], 2),
    user('', 3, { toolUseResult: {} }),
    said([{ type: 'tool_use', name: 'Edit', input: { file_path: '/w/app/a.js' } }, { type: 'text', text: 'bouton ajouté' }], 4),
    user([{ type: 'text', text: '[Request interrupted by user]' }], 5),
    { type: 'assistant', isSidechain: true, timestamp: T(6), message: { content: [{ type: 'text', text: 'sous-agent' }] } },
    { type: 'ai-title', aiTitle: 'Bouton' },
  ]);
  assert.equal(e.first, 'ajoute un bouton');
  assert.equal(e.prompts.length, 1);
  assert.equal(e.last, 'bouton ajouté');
  assert.deepEqual(e.files, ['/w/app/a.js']);
  assert.deepEqual(e.tools, { Read: 1, Edit: 1 });
  assert.equal(e.title, 'Bouton');
  assert.equal(e.branch, 'main');
  assert.equal(e.updated, Date.parse(T(5)));
  // lecture incrémentale : la réponse précédente passe dans l'historique à la demande suivante
  digest(e, [user('et un test', 7), said([{ type: 'text', text: 'test ajouté' }], 8), { type: 'custom-title', customTitle: 'Mon nom' }, { type: 'ai-title', aiTitle: 'Autre' }]);
  assert.deepEqual(e.answers, ['bouton ajouté']);
  assert.equal(e.last, 'test ajouté');
  assert.equal(e.title, 'Mon nom', 'le nom donné par l’utilisateur l’emporte');
  assert.ok(valid(e));
});

test('buildContext : même dossier d’abord, session courante exclue, autres dossiers listés', () => {
  const mk = (id, project, n, first) => Object.assign(blank(id), { project, updated: Date.parse(T(n)), first, last: 'fait : ' + first, machine: 'mac' });
  const all = [mk('aaaaaa01', '{home}/app', 1, 'ancienne'), mk('aaaaaa02', '{home}/app', 5, 'récente'), mk('aaaaaa03', '{home}/autre', 3, 'ailleurs'), mk('aaaaaa04', '{home}/app', 9, 'courante')];
  const ctx = buildContext(all, '{home}/app', { exclude: 'aaaaaa04', dir: '/d/memory' });
  assert.match(ctx, /^# Mémoire partagée/);
  assert.ok(ctx.indexOf('récente') < ctx.indexOf('ancienne'), 'plus récente en premier');
  assert.doesNotMatch(ctx, /courante/);
  assert.match(ctx, /## Autres dossiers récents\n- \{home\}\/autre : ailleurs/);
  assert.match(ctx, /home_app\.md/);
  assert.equal(buildContext([], '{home}/app'), '');
  assert.match(buildContext(all, '{HOME}/APP', { isWin: true }), /récente/, 'Windows : casse ignorée');
  assert.ok(buildContext(Array.from({ length: 30 }, (_, i) => mk('bbbbbb' + String(i).padStart(2, '0'), '{home}/app', i, 'x'.repeat(600))), '{home}/app').length < 11000, 'taille bornée');
  assert.match(renderProject('{home}/app', all), /Session : aaaaaa02/);
});

test('valid / slug', () => {
  assert.equal(valid({ ...blank('../etc'), updated: 1 }), false);
  assert.equal(valid({ ...blank('abcdef12'), updated: 1, prompts: 'x' }), false);
  assert.equal(slug('{home}/Projects/x y'), 'home_Projects_x_y');
  assert.equal(slug(''), 'sans-dossier');
});
