'use strict';
// Fuseau horaire : Electron embarque ses propres données de fuseaux (ICU), parfois plus
// anciennes que celles du système (ex. Maroc passé à GMT le 20/09/2026, inconnu d'ICU 2025c).
// Si l'heure JS diverge de celle du système (macOS : date, Windows : TimeZoneInfo), on force TZ sur le décalage du système.
// À appeler avant toute utilisation de Date ; TZ est hérité par le renderer et server.js.
const { execFileSync } = require('child_process');

function parseOffset(s) {
  const m = /^([+-])(\d{2})(\d{2})/.exec(String(s).trim());
  if (!m) return null;
  const min = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -min : min;
}

// Décalages en minutes à l'est d'UTC. Renvoie la zone Etc à imposer, ou null.
function fixZone(sysMin, jsMin) {
  if (sysMin == null || jsMin == null || sysMin === jsMin || sysMin % 60) return null;
  const h = sysMin / 60;
  return h === 0 ? 'Etc/GMT' : 'Etc/GMT' + (h > 0 ? '-' : '+') + Math.abs(h); // signes inversés
}

// Décalage du système en minutes à l'est d'UTC (Windows : celui de Windows, pas celui d'ICU).
function systemOffset() {
  if (process.platform === 'win32') {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[int][TimeZoneInfo]::Local.GetUtcOffset([DateTime]::UtcNow).TotalMinutes'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const n = Number(String(out).trim());
    return Number.isFinite(n) ? n : null;
  }
  return parseOffset(execFileSync('/bin/date', ['+%z'], { encoding: 'utf8', timeout: 2000 }));
}

function alignTimezone() {
  if (process.env.TZ) return null;
  try {
    const sys = systemOffset();
    const zone = fixZone(sys, -new Date().getTimezoneOffset());
    if (zone) process.env.TZ = zone;
    return zone;
  } catch { return null; }
}

module.exports = { parseOffset, fixZone, alignTimezone };
