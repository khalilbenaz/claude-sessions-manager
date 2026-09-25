# Journal des versions

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions [SemVer](https://semver.org/lang/fr/).

## [3.2.1] — 2026-09-25

### Modifié
- **Thème automatique par défaut** : « Système » suit le mode clair / sombre de Windows et macOS en direct (Clair et Sombre restent disponibles) ; la fenêtre s'ouvre directement dans la bonne couleur.
- **Mises à jour** : vérification aussi au retour sur la fenêtre (au plus une fois par heure), en plus du lancement et des 6 h.
- **Documentation** : le README devient un guide complet (22 sections : sessions, groupes, vue partagée, worktrees, verrouillage, notifications, réglages, raccourcis, dépannage…), publié aussi sur le site (`guide.html`, généré depuis le README par `npm run guide`). Les anciens liens du README restent valides (ancres de compatibilité).

## [3.2.0] — 2026-09-25

### Ajouté
- **Verrouiller une session par mot de passe** (menu ⋯, clic droit, palette ou <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd>). Le verrou est appliqué par le serveur : tant qu'une fenêtre n'a pas déverrouillé la session, elle n'en reçoit ni l'affichage ni l'historique, sa saisie est ignorée et les actions sensibles (modifications, export, chronologie, file d'attente, fermeture) sont refusées ; le titre est masqué dans l'historique. Mot de passe haché (scrypt), essais limités, indice facultatif. Reverrouillage automatique quand la fenêtre est réduite ou après une inactivité (Réglages › Sécurité). Le verrou protège l'affichage dans l'application : les transcripts de Claude Code restent des fichiers locaux.
- **Réduire dans la zone de notification** (Windows) / la barre de menus (macOS) au lieu de la barre des tâches ; clic sur l'icône = afficher / masquer ; menu de l'icône avec la liste des sessions et leur état (clic = y aller) ; point rouge sur l'icône quand une session attend ; infobulle avec le nombre de sessions. Réglages « réduire » et « fermer » dans Général.

## [3.1.0] — 2026-09-25

### Travail en parallèle
- **Une session = un worktree git** : option à la création (nouvelle branche dans `<dépôt>.worktrees/`), badge de branche, fermeture avec « garder / fusionner puis supprimer / supprimer » (#10).
- **Vue partagée** : 1, 2 (colonnes ou lignes) ou 4 sessions côte à côte ; glisser une session sur un panneau ; <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> pour changer de panneau (#11).
- **Panneau Modifications** : fichiers modifiés, diff coloré, annuler un fichier, commit (message proposé), fusion du worktree (#12).
- **Groupes, épinglage, couleur** dans la barre latérale (#13) ; **modèles de session** (dossier, modèle, mode, worktree, groupe, premier prompt) (#14).

### Confort et suivi
- **Palette de commandes** <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> : sessions, conversations, modèles, prompts, actions (#5).
- **Interface en anglais** (langue du système ou réglage) (#15).
- **Bibliothèque de prompts** avec variables `{dossier}`, `{branche}`, `{nom}`, `{selection}` (#16) ; **file d'attente** de prompts envoyés quand la session a fini (#17) ; **envoi groupé** à plusieurs sessions (#18).
- **Recherche** dans tous les terminaux ouverts <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>F</kbd> (#19).
- **Consommation** : tokens et coût estimé par session, 5 h / jour / 7 jours, graphique, sessions les plus coûteuses (#20) ; **chronologie** des outils utilisés (#21).
- **Alertes** : son, ne pas déranger, rappel si une session attend, alerte si elle travaille trop longtemps, alertes coupées par session (#22).
- **Export** d'une conversation en Markdown, copie, impression / PDF (#24).
- **Assistant** de premier lancement (#25) ; **mode focus** et **barre latérale compacte** (#26) ; **thème clair**.

### Fondations
- **Mises à jour automatiques** (Windows : téléchargement en arrière-plan, installation au redémarrage ; macOS : notification + lien) (#3).
- **Ouvrir dans** l'éditeur (VS Code, Cursor, Windsurf, Zed, IntelliJ, Sublime ou commande personnalisée), l'Explorateur / le Finder, un terminal (#4).
- **Réglages** partagés entre l'app et le navigateur (#6) ; **Diagnostic** avec rapport à copier (#7) ; **Journaux** filtrables (#23).
- **Tests de bout en bout** avec un faux `claude` (serveur + application Electron via Playwright), exécutés dans la CI avant chaque release (#8).

### Corrigé
- Glisser une image affichait « Échec : route » quand l'app se branchait sur un serveur plus ancien : bandeau « serveur ancien » et redémarrage en un clic, sessions restaurées (#2).
- Une instance de test (autre port) avait le même verrou d'instance unique que l'app installée.

## [3.0.0] — 2026-09-25
- Application de bureau Windows / macOS (Electron) : fenêtre dédiée, icône de barre des tâches / de menus, serveur embarqué, sécurité renforcée (isolation, CSP, permissions), rendu GPU, installeur NSIS et `.dmg`.
- Projet open source (MIT), site GitHub Pages, politique de confidentialité.

## [2.x]
- Paquet npm Windows / macOS et commande `csm` ; renommage des sessions ; images et fichiers (glisser-déposer, coller, Joindre) ; menu clic droit.

## [1.x]
- Plusieurs sessions Claude Code dans une fenêtre, état en direct via hooks, historique, reprise automatique après redémarrage, import des sessions ouvertes dans un terminal.
