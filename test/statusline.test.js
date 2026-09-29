'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render, fmtReset } = require('../statusline');
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '');

test('barre d’état : quotas avec heure du reset, contexte, modèle', () => {
  const now = new Date(2026, 8, 29, 11, 12);
  const p = {
    model: { display_name: 'Opus 5.5' },
    context_window: { used_percentage: 42.4 },
    rate_limits: {
      seven_day: { used_percentage: 90, resets_at: Math.floor(new Date(2026, 9, 1, 18, 44) / 1000) },
      five_hour: { used_percentage: 20, resets_at: Math.floor(new Date(2026, 8, 29, 13, 21) / 1000) },
    },
  };
  assert.equal(plain(render(p, now)), '5h 20% ↻ 13:21 (2h09) · 7j 90% ↻ jeu 18:44 (2j7h) · ctx 42% · Opus 5.5');
});

test('barre d’état : reset en ISO ou millisecondes, payload vide', () => {
  const now = new Date(2026, 8, 29, 11, 0);
  assert.equal(fmtReset(new Date(2026, 8, 29, 11, 30), now), '11:30 (30m)');
  assert.equal(plain(render({ rate_limits: { five_hour: { used_percentage: 5, resets_at: new Date(2026, 8, 29, 12, 0).toISOString() } } }, now)), '5h 5% ↻ 12:00 (1h00)');
  assert.equal(plain(render({ rate_limits: { five_hour: { used_percentage: 5, resets_at: +new Date(2026, 8, 29, 12, 0) } } }, now)), '5h 5% ↻ 12:00 (1h00)');
  assert.equal(render({}), '');
});
