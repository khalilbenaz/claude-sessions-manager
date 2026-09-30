'use strict';
// Tests unitaires de lib/sync.js : code de synchro et dossiers portables entre Mac et Windows (#27).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeCode, decodeCode, parseRoots, toPortable, fromPortable } = require('../lib/sync');

test('code de synchro : aller-retour et refus', () => {
  const c = encodeCode('https://sync.example.dev/', 'a'.repeat(32));
  assert.match(c, /^csm1\./);
  assert.deepEqual(decodeCode(c), { url: 'https://sync.example.dev', key: 'a'.repeat(32), code: c });
  assert.equal(decodeCode(''), null);
  assert.equal(decodeCode('csm1.pasdubase64'), null);
  assert.equal(decodeCode(encodeCode('https://x.dev', 'court')), null, 'clé trop courte');
  assert.equal(decodeCode(encodeCode('javascript:alert(1)', 'a'.repeat(32))), null);
});

test('code court : saisie tolérante, serveur du réglage', () => {
  const k = 'ABCD-EFGH-JKMN-PQRS-TVWX';
  assert.deepEqual(decodeCode(k, 'https://s.dev/'), { url: 'https://s.dev', key: 'ABCDEFGHJKMNPQRSTVWX', code: k });
  assert.equal(decodeCode(' abcd efgh jkmn pqrs tvwx ', 'https://s.dev').code, k, 'minuscules et espaces');
  assert.equal(decodeCode('0O1I-L000-0000-0000-0000', 'https://s.dev').key, '00111000000000000000', 'O→0, I/L→1');
  assert.equal(decodeCode('ABCD-EFGH-JKMN-PQRS', 'https://s.dev'), null, 'trop court');
  assert.equal(decodeCode('UUUU-EFGH-JKMN-PQRS-TVWX', 'https://s.dev'), null, 'U hors alphabet');
  assert.equal(decodeCode(k, 'javascript:x'), null, 'serveur invalide');
  assert.equal(decodeCode(k).url, require('../lib/sync').DEFAULT_SERVER);
});

test('dossiers : Mac vers Windows par le dossier personnel', () => {
  const mac = parseRoots('', '/Users/lilou', false);
  const win = parseRoots('', 'C:\\Users\\lilou', true);
  const p = toPortable('/Users/lilou/Projects/app', mac);
  assert.equal(p, '{home}/Projects/app');
  assert.equal(fromPortable(p, win, true), 'C:\\Users\\lilou\\Projects\\app');
  assert.equal(toPortable('C:\\Users\\Lilou\\Projects\\app\\', win), '{home}/Projects/app', 'Windows : casse et barres ignorées');
  assert.equal(fromPortable('{home}', mac, false), '/Users/lilou');
});

test('dossiers : alias déclarés, le plus précis gagne', () => {
  const win = parseRoots('code=D:\\dev\n  pro = C:\\Users\\lilou\\Travail  \nligne invalide', 'C:\\Users\\lilou', true);
  const mac = parseRoots('code=~/dev\npro=~/Travail', '/Users/lilou', false);
  assert.equal(toPortable('D:\\dev\\api', win), '{code}/api');
  assert.equal(toPortable('C:\\Users\\lilou\\Travail\\x', win), '{pro}/x', 'plus long préfixe que {home}');
  assert.equal(fromPortable('{code}/api', mac, false), '/Users/lilou/dev/api');
  assert.equal(fromPortable('{pro}/x', mac, false), '/Users/lilou/Travail/x');
});

test('dossiers : inconnus ici → null', () => {
  const mac = parseRoots('', '/Users/lilou', false);
  assert.equal(fromPortable('{code}/api', mac, false), null, 'alias non déclaré');
  assert.equal(fromPortable('D:/dev/api', mac, false), null, 'chemin Windows sur Mac');
  assert.equal(fromPortable('/opt/x', parseRoots('', 'C:\\Users\\l', true), true), null, 'chemin Mac sur Windows');
  assert.equal(fromPortable('/opt/x', mac, false), '/opt/x', 'chemin absolu local gardé');
});

test('mémoire : base d’un claude-mem trop ancien signalée pour réparation automatique', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-mem-'));
  fs.mkdirSync(path.join(dir, 'claude-mem'), { recursive: true });
  const d = new DatabaseSync(path.join(dir, 'claude-mem', 'claude-mem.db'));
  d.exec('CREATE TABLE sdk_sessions (id INTEGER, memory_session_id TEXT); CREATE TABLE observations (id INTEGER); CREATE TABLE session_summaries (id INTEGER); CREATE TABLE user_prompts (id INTEGER);');
  d.close();
  const memsync = require('../lib/memsync');
  assert.throws(() => memsync.open(dir), e => e.code === 'CLAUDE_MEM_OLD');
  assert.equal(typeof memsync.repair, 'function');
});
