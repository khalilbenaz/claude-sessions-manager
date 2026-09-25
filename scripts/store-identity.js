'use strict';
// Injecte l'identité du paquet Microsoft Store (Partner Center › Produit › Identité du produit) avant la construction.
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'package.json');
const p = JSON.parse(fs.readFileSync(f, 'utf8'));
const { APPX_IDENTITY_NAME, APPX_PUBLISHER, APPX_PUBLISHER_DISPLAY_NAME } = process.env;
if (!APPX_IDENTITY_NAME || !APPX_PUBLISHER || !APPX_PUBLISHER_DISPLAY_NAME) { console.error('identifiants Store manquants'); process.exit(1); }
Object.assign(p.build.appx, { identityName: APPX_IDENTITY_NAME, publisher: APPX_PUBLISHER, publisherDisplayName: APPX_PUBLISHER_DISPLAY_NAME });
fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n');
console.log('identité Store :', APPX_IDENTITY_NAME);
