'use strict';
// Tests de lib/tz.js : l'heure affichée suit le fuseau du système, même si celui d'Electron est périmé.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseOffset, fixZone } = require('../lib/tz');

test('fuseau : lecture du décalage système (+HHMM)', () => {
  assert.equal(parseOffset('+0000\n'), 0);
  assert.equal(parseOffset('+0100'), 60);
  assert.equal(parseOffset('-0330'), -210);
  assert.equal(parseOffset('n/a'), null);
});

test('fuseau : correction seulement si Electron et le système divergent', () => {
  // Casablanca : le système dit GMT, les données d'Electron disent GMT+1.
  assert.equal(fixZone(0, 60), 'Etc/GMT');
  assert.equal(fixZone(60, 0), 'Etc/GMT-1'); // signe inversé dans les noms Etc
  assert.equal(fixZone(-300, -240), 'Etc/GMT+5');
  assert.equal(fixZone(60, 60), null);        // d'accord : rien à faire
  assert.equal(fixZone(330, 300), null);      // demi-heure : pas de zone Etc, on laisse
  assert.equal(fixZone(null, 60), null);
});
