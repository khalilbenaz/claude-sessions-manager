# Publier Claude Sessions sur le Microsoft Store

Pourquoi : le Microsoft Store signe lui-même les applications qu'il distribue — plus d'avertissement « Windows a protégé votre ordinateur », installation et mises à jour par le Store. C'est gratuit pour un compte développeur particulier.

## 1. Compte développeur (une fois, ~10 min)

1. Aller sur **https://partner.microsoft.com/dashboard/registration** (Microsoft Partner Center), se connecter avec un compte Microsoft.
2. Type de compte : **Individuel** (gratuit). Renseigner nom, pays (Maroc), coordonnées ; vérification d'identité si demandée.

## 2. Réserver le nom de l'application

1. Partner Center › **Apps et jeux** › **+ Nouveau produit** › **Application MSIX ou PWA**.
2. Nom : **Claude Sessions** (si le nom est pris, en choisir un proche, par ex. « Claude Sessions Manager »).
3. Dans le produit : **Gestion des produits › Identité du produit**. Noter les trois valeurs :

| Partner Center | Secret GitHub à créer |
|---|---|
| `Package/Identity/Name` (ex. `12345KhalilBenazzouz.ClaudeSessions`) | `APPX_IDENTITY_NAME` |
| `Package/Identity/Publisher` (ex. `CN=1A2B3C4D-…`) | `APPX_PUBLISHER` |
| `Package/Properties/PublisherDisplayName` (ex. `Khalil Benazzouz`) | `APPX_PUBLISHER_DISPLAY_NAME` |

## 3. Enregistrer les valeurs dans GitHub

Dépôt › **Settings › Secrets and variables › Actions › New repository secret**, une fois par valeur (noms exacts du tableau). Ou en ligne de commande :

```sh
gh secret set APPX_IDENTITY_NAME -R khalilbenaz/claude-sessions-manager
gh secret set APPX_PUBLISHER -R khalilbenaz/claude-sessions-manager
gh secret set APPX_PUBLISHER_DISPLAY_NAME -R khalilbenaz/claude-sessions-manager
```

Dès lors, chaque version taguée `v*` produit aussi le paquet Store (`Claude-Sessions-x.y.z-store.appx`), dans les artefacts du workflow « Build & release » (onglet Actions › exécution › *store-package*). Il n'est pas joint à la release publique : il n'est installable qu'une fois signé par le Store.

## 4. Première soumission

1. Partner Center › produit › **Démarrer la soumission**.
2. **Tarification et disponibilité** : gratuit, marchés au choix.
3. **Propriétés** : catégorie *Outils de développement* ; déclarer que l'app nécessite *Claude Code* (installé séparément) ; politique de confidentialité : `https://khalilbenaz.github.io/claude-sessions-manager/privacy.html`.
4. **Classification par âge** : questionnaire (pas de contenu sensible).
5. **Packages** : téléverser le fichier `.appx` récupéré à l'étape 3.
6. **Descriptions du Store** : description (reprendre le site), captures d'écran (au moins une, 1366×768 ou plus), mots-clés.
7. **Notes pour la certification** : « Application de bureau (runFullTrust) qui lance l'outil en ligne de commande Claude Code installé par l'utilisateur, dans des terminaux intégrés ; serveur local sur 127.0.0.1 uniquement. »
8. Soumettre. La certification prend en général de quelques heures à 3 jours.

Les mises à jour suivantes : nouvelle soumission avec le nouveau `.appx` (automatisable plus tard avec l'API de soumission du Store).

## Particularités de la version Store

- Les **mises à jour** sont faites par le Store (la vérification intégrée de l'app est désactivée).
- Le **lancement au démarrage de l'ordinateur** n'est pas géré par l'app dans la version Store.
- La version téléchargée sur GitHub (installeur `.exe`) reste disponible et continue de se mettre à jour elle-même.
