'use strict';
// Code Node (serveur, Electron, hooks) : noms non définis seulement — une fonction renommée ou jamais écrite
// (ex. macWritable, 3.24 → 3.46 : l'installation automatique des mises à jour ne partait jamais sur macOS)
// n'échoue qu'à l'exécution, souvent dans un minuteur, sans que les tests passent par là.
// L'interface (public/) partage ses variables globales entre fichiers : pas vérifiée ici.
const globals = require('globals');
module.exports = [{
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
  rules: { 'no-undef': 'error' },
}];
