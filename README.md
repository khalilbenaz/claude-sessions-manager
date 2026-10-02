# Claude Sessions

Une seule fenêtre pour piloter plusieurs sessions [Claude Code](https://docs.claude.com/claude-code) au lieu d'une pile d'onglets de terminal. **Windows et macOS · libre (MIT).**

**Site et guide : https://khalilbenaz.github.io/claude-sessions-manager/** · [Guide détaillé en ligne](https://khalilbenaz.github.io/claude-sessions-manager/guide.html) · [Journal des versions](CHANGELOG.md)

## Sommaire

1. [Installation](#1-installation)
2. [Premiers pas](#2-premiers-pas)
3. [L'écran principal](#3-lécran-principal)
4. [Les sessions](#4-les-sessions)
5. [Ranger : groupes, épinglage, couleurs](#5-ranger--groupes-épinglage-couleurs)
6. [Vue partagée](#6-vue-partagée)
7. [Worktrees git : plusieurs Claude sur le même dépôt](#7-worktrees-git--plusieurs-claude-sur-le-même-dépôt)
8. [Panneau Modifications, Chronologie, Consommation](#8-panneau-modifications-chronologie-consommation)
9. [Historique et sessions ouvertes dans un terminal](#9-historique-et-sessions-ouvertes-dans-un-terminal)
10. [Images et fichiers](#10-images-et-fichiers)
11. [Palette, recherche, prompts, file d'attente, envoi groupé](#11-palette-recherche-prompts-file-dattente-envoi-groupé)
12. [Modèles de session](#12-modèles-de-session)
13. [Verrouiller une session par mot de passe](#13-verrouiller-une-session-par-mot-de-passe)
14. [Notifications, zone de notification, arrière-plan](#14-notifications-zone-de-notification-arrière-plan) — et [accès depuis l'app Claude (téléphone)](#14-bis-accès-depuis-lapp-claude-téléphone)
15. [Thème clair / sombre, langue](#15-thème-clair--sombre-langue)
16. [Réglages](#16-réglages) — [mémoire des sessions](#16-ter-mémoire-des-sessions) et [synchroniser les sessions entre machines](#16-bis-synchroniser-les-sessions-entre-machines)
17. [Mises à jour](#17-mises-à-jour)
18. [Raccourcis clavier](#18-raccourcis-clavier)
19. [Données, sécurité, confidentialité](#19-données-sécurité-confidentialité)
20. [Dépannage](#20-dépannage)
21. [Ligne de commande `csm` (sans l'application)](#21-ligne-de-commande-csm-sans-lapplication)
22. [Développement](#22-développement)

---

<a id="installation"></a><a id="application-recommandé"></a>
## 1. Installation

Seul prérequis : **Claude Code** installé (la commande `claude` fonctionne dans un terminal). Node.js n'est pas nécessaire.

| Système | Fichier ([dernière version](https://github.com/khalilbenaz/claude-sessions-manager/releases/latest)) | Installation |
|---|---|---|
| Windows 10 / 11 | `Claude-Sessions-Setup-x.y.z.exe` | double-clic ; installation en un clic, sans droits administrateur |
| Mac Apple Silicon (M1…M4) | `Claude-Sessions-x.y.z-arm64.dmg` | ouvrir, glisser **Claude Sessions** dans Applications |
| Mac Intel | `Claude-Sessions-x.y.z-x64.dmg` | idem |

L'application n'est pas encore signée par un certificat éditeur, donc chaque système prévient au premier lancement :
- **Windows** : « Windows a protégé votre ordinateur » → *Informations complémentaires* → *Exécuter quand même*.
- **macOS** : au premier lancement, macOS bloque l'app (« impossible de vérifier le développeur »). Ouvre **Réglages Système › Confidentialité et sécurité**, descends jusqu'au message sur Claude Sessions et clique **Ouvrir quand même** (puis confirme). Sur les macOS récents, « clic droit › Ouvrir » ne suffit plus. Autre possibilité, dans le Terminal : `xattr -cr "/Applications/Claude Sessions.app"`.

Ensuite, les nouvelles versions s'installent toutes seules sous Windows (§ 17).

## 2. Premiers pas

1. Lance **Claude Sessions**. Au premier lancement, un assistant vérifie que `claude` et `git` sont installés et propose de créer ta première session.
2. **+ Nouvelle** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>) : choisis un **dossier de travail** (*Parcourir…*), éventuellement un nom et un groupe, le modèle (opus par défaut), puis **Lancer**.
3. La session démarre : c'est un vrai Claude Code, avec tes réglages, tes hooks, tes serveurs MCP et tes commandes `/…`. Tu tapes comme dans un terminal.
4. Crée d'autres sessions de la même façon : elles apparaissent dans la barre latérale et tournent **toutes en même temps**.

Tu peux fermer la fenêtre à tout moment : les sessions continuent en arrière-plan et reviennent même après un redémarrage de l'ordinateur.

## 3. L'écran principal

```
┌─ barre latérale ──────┬─ barre de la session active ────────────────────────────────────────┐
│ + Nouvelle            │ ● nom ✎  ⎇ branche  dossier  état   ▢◫⊟⊞  ± Modifications  ↗ Ouvrir │
│ Rechercher…   Ctrl+K  │                                    Joindre  Relancer  ⋯  Fermer     │
│ ─ ÉPINGLÉES ─     1   ├──────────────────────────────────────────────────┬──────────────────┤
│ ● session A           │                                                  │ panneau latéral  │
│ ─ PROJET X ─      2   │   terminal de la session (ou 2 / 4 panneaux)     │  Modifications   │
│ ● session B           │                                                  │  Chronologie     │
│ ● session C           │                                                  │  Consommation    │
│ ─ SANS GROUPE ─   1   │                                                  │                  │
│ ● session D (verrou)  │                                                  │                  │
│ Dans un terminal (2)  │                                                  │                  │
│ Historique   ⚙   ⇤    │                                                  │                  │
└───────────────────────┴──────────────────────────────────────────────────┴──────────────────┘
```

- **Barre latérale** : tes sessions, rangées par groupe, avec leur état en direct. En bas : l'historique des conversations, les réglages (⚙) et le mode compact (⇤).
- **Barre de la session active** : nom (✎ renommer), branche si c'est un worktree, dossier, état ; à droite la disposition (1, 2 ou 4 panneaux), le panneau Modifications, « Ouvrir dans… », joindre un fichier (📎), relancer, le menu **⋯** (toutes les actions de la session) et Fermer.
- **Clic droit** partout : menu adapté (session, terminal, champ de saisie, historique, icône de la zone de notification).

### États d'une session

| Pastille | État | Signification |
|---|---|---|
| 🟠 orange (clignote) | travaille | Claude répond ou utilise un outil |
| 🔴 rouge (pulse) | attend une réponse | Claude a besoin de toi (question, permission) : notification et son |
| 🟢 vert | prêt | Claude a fini (« terminé » tant que tu n'as pas regardé la session) |
| ⚪ cercle | arrêtée | le processus est arrêté ; « Reprendre » relance la conversation |

Après <kbd>Ctrl</kbd>+<kbd>C</kbd> ou <kbd>Échap</kbd> pendant une réponse, la session repasse à « prêt (interrompu) ». Une session **rouge** le reste tant que Claude attend vraiment (permission, question) : l'afficher ne suffit pas, il faut lui répondre.

L'état vient directement de Claude Code (des hooks sont ajoutés à chaque session) : il est exact même fenêtre fermée.

<a id="fonctionnement"></a><a id="persistance"></a>
## 4. Les sessions

| Action | Où | Effet |
|---|---|---|
| **Nouvelle** | + Nouvelle, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>, palette | dossier, nom, groupe, modèle, mode, worktree, premier prompt, arguments |
| **Renommer** | ✎, double-clic sur le nom, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> | le nom est aussi écrit dans la conversation Claude (historique, `claude --resume`) |
| **Relancer / Reprendre** | bouton ou ⋯ | relance Claude dans la **même conversation** (`--resume`) |
| **Arrêter** | ⋯ › Arrêter | arrête le processus ; la session reste dans la liste |
| **Fermer** | Fermer, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>W</kbd> | arrête et retire la session ; la conversation reste dans l'Historique |
| **Changer de session** | clic, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>9</kbd>, <kbd>↑</kbd>/<kbd>↓</kbd> | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> : prochaine session qui t'attend |
| **Réordonner** | glisser-déposer dans la liste | ordre mémorisé |
| **Ouvrir dans…** | ↗ Ouvrir, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd> | le dossier dans ton éditeur (VS Code, Cursor, Windsurf, Zed, IntelliJ, Sublime ou commande personnalisée), l'Explorateur / le Finder, un terminal |

**Persistance** : chaque session ouverte (dossier, nom, modèle, groupe, ordre, conversation) est mémorisée. Après un redémarrage de l'ordinateur ou de l'app, toutes celles qui tournaient sont relancées dans leur conversation. Seules celles que tu as arrêtées ou fermées restent arrêtées.

## 5. Ranger : groupes, épinglage, couleurs

Un **groupe** est une étiquette libre qui sert à **ranger tes sessions par projet dans la barre latérale** — par exemple « Wafacash », « Perso », « Client X ». Il n'a aucun effet sur le fonctionnement des sessions : c'est de l'organisation visuelle.

- **Créer un groupe** : bouton **🗂** en bas de la barre latérale (ou palette › Nouveau groupe). Un groupe créé ainsi reste affiché **même vide**, avec une zone « Glisse une session ici ».
- **Déplacer une session** : **glisse-la sur le titre d'un groupe** (ou sur une session de ce groupe), ou clic droit / ⋯ › **Déplacer vers le groupe…** (liste des groupes, *Nouveau groupe…*, *Sans groupe*). À la création : champ *Groupe* dans « Nouvelle session ».
- **Gérer un groupe** : au survol de son titre, **✎ renommer** (ou double-clic sur le nom ; ses sessions suivent) et **✕ supprimer** (ses sessions passent dans « Sans groupe », rien n'est fermé). Aussi par clic droit sur le titre (*Nouvelle session dans ce groupe*, *Renommer le groupe…*, *Supprimer le groupe*) et par la palette (*Renommer le groupe « … »*, *Supprimer le groupe « … »*). Renommer vers un groupe existant fusionne les deux.
- **Affichage** : chaque groupe a un en-tête (nom + nombre de sessions) ; **clic sur l'en-tête = replier / déplier**. Les sessions sans groupe sont sous « Sans groupe ».
- **Épingler** (⋯ › Épingler en haut) : la session passe dans « Épinglées », tout en haut, quel que soit son groupe.
- **Couleur** : liseré à gauche de la session pour la repérer d'un coup d'œil.
- Un **modèle de session** peut fixer le groupe (§ 12).

## 6. Vue partagée

Pour **suivre plusieurs sessions en même temps** : boutons de disposition dans la barre (▢ une, ◫ deux colonnes, ⊟ deux lignes, ⊞ grille 2×2) ou palette.

- **Placer une session** : glisse-la depuis la barre latérale sur un panneau, ou clique-la (elle va dans le panneau actif, surligné en orange).
- **Changer de panneau** : clic dans le panneau ou <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> ; ✕ en haut d'un panneau le vide.
- Chaque terminal garde sa propre taille ; la disposition est mémorisée.
- **Mode focus** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>) : masque la barre latérale.

## 7. Worktrees git : plusieurs Claude sur le même dépôt

Deux sessions qui modifient le même dépôt au même moment se marchent dessus. Un **worktree git** donne à une session **son propre dossier et sa propre branche**, à côté du dépôt principal, sans y toucher.

1. « Nouvelle session » dans un dépôt git → cocher **Travailler dans un worktree git dédié**. Une branche est proposée (`csm/<nom>`), modifiable.
2. La session travaille dans `<dépôt>.worktrees/<branche>` ; son badge **⎇ branche** apparaît dans la liste et la barre.
3. Travail prêt : panneau **Modifications** → commit, puis **Fusionner dans `<branche de base>`**.
4. En fermant la session : **garder** le worktree (y revenir plus tard), **fusionner puis supprimer**, ou **supprimer** (abandonner la branche).

La fusion est refusée s'il reste des modifications non commitées, si le dépôt principal n'est pas sur la branche de base, ou en cas de conflit (la fusion est alors annulée proprement).

## 8. Panneau Modifications, Chronologie, Consommation

Bouton **± Modifications** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd>) ou ⋯ : panneau latéral à trois onglets pour la session active.

- **Modifications** : fichiers modifiés dans le dossier de la session (git) avec leur état (M modifié, N nouveau, S supprimé). Clic = **diff coloré** ; ↺ = annuler un fichier ; **commit** avec « Proposer un message » et « Committer tout ». Rafraîchi quand Claude a fini un tour.
- **Chronologie** : les actions de Claude (📖 lus, ✏️ modifiés, ▶ commandes, 🔎 recherches…) avec l'heure.
- **Consommation** : tokens d'entrée / sortie et **coût estimé** de la session, puis de toutes les sessions sur 5 h, aujourd'hui et 7 jours ; graphique par jour ; sessions les plus coûteuses. Estimation aux tarifs API publics, indicative (inclus dans un abonnement Claude).
- **Barre d'état des quotas** : sous l'invite de chaque session, CSM affiche tes quotas d'abonnement et l'heure de leur réinitialisation, le contexte utilisé et le modèle : `5h 20% ↻ 13:21 (2h09) · 7j 90% ↻ jeu 18:44 (2j7h) · ctx 42% · Opus 5.5`. Seulement si tu n'as pas déjà ta propre barre d'état Claude Code (`statusLine` dans `~/.claude/settings.json`) ; désactivable dans Réglages › Général.

**Exporter une conversation** : ⋯ › Exporter → Markdown (fichier ou presse-papiers) ou impression / PDF.

## 9. Historique et sessions ouvertes dans un terminal

- **Historique** (🕘, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd>) : toutes tes conversations Claude Code de cet ordinateur (titre, dossier, branche, dernier message), filtrables. Clic = reprendre la conversation dans une nouvelle session, dans son dossier. Clic droit : renommer, copier le chemin ou l'identifiant.
- **Dans un terminal** (bas de la barre latérale) : les sessions Claude lancées dans des terminaux apparaissent toutes seules. Clic → **Déplacer** (la session s'arrête dans le terminal et reprend ici, même conversation) ou **Copier** (le terminal continue, une copie s'ouvre ici). **Tout ramener** les déplace toutes.

## 10. Images et fichiers

Comme dans un terminal, Claude reçoit images et fichiers :
- **glisser-déposer** un fichier sur le terminal ;
- **coller** une capture d'écran (<kbd>Ctrl</kbd>+<kbd>V</kbd> / <kbd>⌘</kbd>+<kbd>V</kbd>) ;
- bouton **📎**, ou clic droit › Joindre un fichier… / Coller.

Le fichier est copié dans un dossier temporaire et son chemin collé dans ta ligne de saisie : Claude affiche `[Image #1]` et l'envoie avec ton message. Les copies sont effacées après 7 jours.

## 11. Palette, recherche, prompts, file d'attente, envoi groupé

- **Palette de commandes** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>) : quelques lettres pour aller à une session, reprendre une conversation, lancer un modèle, insérer un prompt ou exécuter une action (disposition, thème, réglages, diagnostic, verrouillage…). Les actions récentes remontent en tête.
- **Rechercher dans les sessions** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Maj</kbd>+<kbd>F</kbd>) : un texte dans le contenu de tous les terminaux ouverts ; clic = y aller.
- **Bibliothèque de prompts** (⋯ › Insérer un prompt…, palette, Réglages › Prompts) : tes demandes réutilisables. Elle démarre avec 8 prompts prêts à l'emploi (relire les modifications, écrire les tests, expliquer du code, préparer un commit, corriger un bug, proposer un plan, documenter, résumer), modifiables et supprimables ; **+ Nouveau** pour ajouter les tiens. **Insérer** les place dans la ligne de saisie (tu relis, puis Entrée) ; **Envoyer** les soumet. Variables : `{dossier}`, `{branche}`, `{nom}`, `{selection}` (texte sélectionné dans le terminal).
- **File d'attente** (⋯ › File d'attente…, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Q</kbd>) : des prompts envoyés **un par un, automatiquement, chaque fois que Claude a fini** le précédent — « implémente », puis « ajoute les tests », puis « relis ». Le badge ⏳ indique le nombre en attente.
- **Envoi groupé** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd>) : le même prompt à plusieurs sessions cochées, tout de suite ou en file d'attente si elles travaillent.

## 12. Modèles de session

Un **modèle** mémorise une session type : dossier, nom, groupe, modèle Claude, mode, worktree, arguments et **premier prompt** (envoyé dès que la session est prête).

- **Créer** : sur une session existante, ⋯ ou clic droit › **Enregistrer comme modèle…** (reprend son dossier, son groupe, son modèle et son mode) ; ou remplis « Nouvelle session » puis **Enregistrer comme modèle**. La liste est vide tant que tu n'en as pas créé.
- **Utiliser** : liste *Modèle de session* en haut de « Nouvelle session », ou palette › « Lancer le modèle : … ».
- **Gérer** : Réglages › Modèles de session (lancer, renommer, supprimer).

## 13. Verrouiller une session par mot de passe

Pour masquer une session sensible (écran partagé, poste laissé ouvert) : ⋯ ou clic droit › **Verrouiller par mot de passe…** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd>), avec un indice facultatif. *(Depuis la version 3.2.)*

- La session **continue de tourner**, mais son contenu est masqué et la saisie bloquée : un écran 🔒 demande le mot de passe. Dans la liste, 🔒 = verrouillée, 🔓 = déverrouillée dans cette fenêtre.
- Le verrou est **appliqué par le serveur** : une fenêtre non déverrouillée ne reçoit ni l'affichage de la session ni son historique d'affichage, et les actions sensibles (modifications, export, chronologie, consommation, file d'attente, fermeture) sont refusées ; son titre est masqué dans l'Historique.
- Déverrouiller ne vaut que pour **la fenêtre** où tu as tapé le mot de passe. Le verrou revient quand la fenêtre est réduite ou masquée, après une inactivité (Réglages › Sécurité), au redémarrage de l'app, ou tout de suite avec ⋯ › **Verrouiller maintenant**.
- ⋯ › **Changer le mot de passe…** / **Retirer le mot de passe…**
- Mot de passe haché (scrypt), essais limités. **Il ne peut pas être récupéré** : si tu l'oublies, ferme la session (la conversation reste dans les fichiers de Claude Code).
- Limite : le verrou protège ce qu'affiche l'application ; les conversations enregistrées par Claude Code (`~/.claude/projects`) restent des fichiers non chiffrés sur ton disque.

## 14. Notifications, zone de notification, arrière-plan

- **Notifications système** quand une session attend ta réponse ou a fini (seulement si tu ne la regardes pas), avec un **son** au choix. **Ne pas déranger** coupe tout ; ⋯ › Couper les alertes le fait pour une seule session.
- **Rappels** si une session attend depuis X minutes ou travaille depuis plus de Y minutes (Réglages › Notifications).
- **Pastille** sur l'icône de l'app (Dock / barre des tâches) avec le nombre de sessions en attente. Sur Mac, l'app n'étant pas signée par Apple, macOS refuse ses notifications natives : elle passe alors par une notification système simple (sans ouverture de la session au clic) et un point rouge sur l'icône du Dock.
- **Zone de notification** (Windows, près de l'horloge) / **barre de menus** (macOS) : **réduire ou fermer la fenêtre l'y envoie**, les sessions continuent. Clic sur l'icône = afficher / masquer ; **clic droit** = la **liste des sessions et leur état** (🟠 travaille, 🔴 attend, 🟢 prête ; clic pour y aller), nouvelle session, historique, réglages, lancer au démarrage, redémarrer le serveur, quitter. Un **point rouge** sur l'icône signale une session qui t'attend. Windows 11 : si l'icône est cachée, elle est sous la flèche **^** (glisse-la dans la zone visible).
- **Quitter** : « Quitter (les sessions continuent) » ferme l'app ; « Quitter et arrêter toutes les sessions » arrête aussi le serveur (elles reviendront au prochain lancement).
- **Lancement au démarrage** de l'ordinateur : activé au premier lancement, réglable dans le menu de l'icône.

### 14 bis. Accès depuis l'app Claude (téléphone)

Claude Code sait rendre une session locale pilotable depuis l'**app Claude** (iOS / Android, onglet **Code**) et depuis **claude.ai/code** : c'est la fonction **Remote Control** de Claude Code, que Claude Sessions active pour toi.

- **Pour une nouvelle session** : coche **📱 Accessible depuis l'app Claude** dans « Nouvelle session ».
- **Pour une session ouverte** : ⋯ › **📱 Accès depuis l'app Claude** (ou palette). La conversation continue, sans relancer ; même menu pour désactiver.
- **Pour toutes les nouvelles sessions** : Réglages › Général › *Rendre les nouvelles sessions accessibles depuis l'app Claude*.
- La session apparaît dans l'app Claude sous le **nom qu'elle a dans Claude Sessions** (pastille verte quand elle est en ligne) ; le badge **📱** la repère dans la liste. Après un redémarrage, elle se reconnecte toute seule.
- **Prérequis** : abonnement Claude **Pro, Max, Team ou Enterprise**, connecté dans Claude Code avec `/login` (une clé API ne suffit pas). En Team / Enterprise, l'administrateur doit autoriser Remote Control.
- **Sécurité** : connexion sortante chiffrée via Anthropic, **aucun port ouvert** sur ton PC ; le code et les fichiers restent chez toi. Le transcript de la session est stocké par Anthropic pour la synchronisation ([détails](https://code.claude.com/docs/en/remote-control)).

## 15. Thème clair / sombre, langue

- **Thème** : **Système** (par défaut) suit automatiquement le mode clair ou sombre de Windows / macOS, y compris quand il change en cours de journée ; ou forcer **Clair** / **Sombre** (Réglages › Général, ou palette › « Thème »). Le terminal suit le thème. Astuce : Claude Code a ses propres couleurs (sombres par défaut) ; en thème clair, tape `/theme` dans une session et choisis un thème clair de Claude Code.
- **Langue** : français ou anglais, automatiquement selon la langue du système, ou forcée dans Réglages › Général.

## 16. Réglages

⚙ en bas de la barre latérale, ou <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>,</kbd>.

| Onglet | Contenu |
|---|---|
| **Général** | thème (système, clair, sombre), langue, modèle et mode par défaut, worktree proposé par défaut, éditeur pour « Ouvrir dans », barre d'état des quotas, mémoire des sessions (§ 16 ter), mises à jour automatiques, barre latérale compacte, réduire / fermer dans la zone de notification |
| **Terminal** | taille et police du texte |
| **Notifications** | notifications système, son (coupé par défaut, avec test), ne pas déranger, rappels d'attente et de longue exécution |
| **Sécurité** | reverrouiller quand la fenêtre est masquée, après une inactivité |
| **Modèles de session** | lancer, renommer, supprimer |
| **Prompts** | ouvrir la bibliothèque de prompts |
| **Synchronisation** | créer ou saisir un code de synchro, le copier, fréquence (5, 10, 30 ou 60 min), état ; Avancé : nom de machine, correspondance des dossiers, serveur (§ 16 bis) |
| **Diagnostic** | versions, `claude` et `git` trouvés ou non, hooks, dossiers, dernières lignes du journal ; **Copier le rapport** pour une issue |
| **Journaux** | le journal du serveur, filtrable |
| **À propos** | version, rechercher des mises à jour |

### 16 ter. Mémoire des sessions

Claude repart de zéro à chaque session. **La mémoire des sessions** lui rappelle ce qui a déjà été fait. Le moteur se choisit dans Réglages › Général › *Mémoire des sessions* :

- **Mémoire de Claude Sessions** (par défaut) : décrite ci-dessous, sans plugin. claude-mem est alors désactivé pour les sessions de l'app.
- **claude-mem** : le plugin [claude-mem](https://github.com/thedotmack/claude-mem) est **installé automatiquement** s'il manque (`claude plugin marketplace add thedotmack/claude-mem`, puis `claude plugin install claude-mem@thedotmack`). L'état de l'installation s'affiche sous le choix.
- **Les deux**, ou **Aucune**.

Le choix ne concerne que les sessions lancées par l'app : il passe par `enabledPlugins` dans leur fichier `--settings`. Un `claude` lancé dans un terminal garde les réglages de `~/.claude/settings.json`.

- **Ce qui est retenu** : pour chaque session lancée par l'app, une fiche avec son titre, ses demandes, la fin de chaque réponse de Claude (« où on en est »), les fichiers modifiés, la branche git et la machine. La fiche est mise à jour à la fin de chaque tour : seule la suite du transcript est lue. Les sorties d'outils, les sous-agents et les messages système sont ignorés.
- **Ce que Claude reçoit au démarrage** : un résumé des 6 sessions les plus récentes **du même dossier**, toutes machines confondues (première demande, dernières demandes, où on en est, fichiers modifiés), puis la liste des autres dossiers récents. C'est environ 9 000 caractères au plus. La session en cours n'est jamais incluse. Claude est invité à vérifier dans le code avant de s'y fier.
- **Mémoire complète, lisible et cherchable** : `memory/projects/<dossier>.md` dans les données de l'app contient un fichier Markdown par dossier, avec toutes les demandes et réponses de chaque session. Le chemin est donné à Claude, qui peut le lire ou y chercher (`grep`) s'il a besoin de plus de détails. Les fiches brutes sont dans `memory/sessions/<id>.json`.
- **Partagée entre les machines** : si la synchronisation est active (§ 16 bis), option *Mémoire des sessions*, cochée par défaut. Les fiches partent chiffrées de bout en bout, et celles des autres machines sont ajoutées ici. Une session du Mac donne donc son contexte à la session suivante du PC dans le même projet, puisque les dossiers sont traduits comme pour les sessions. Si une fiche a changé des deux côtés, la plus récente gagne.
- **Sessions concernées** : celles lancées par Claude Sessions. Au premier lancement, les sessions de l'app existantes sont rattrapées. Un `claude` lancé dans un terminal n'est ni lu ni modifié. Une case décochée arrête la capture et l'injection ; les fiches déjà écrites restent sur le disque, et on peut supprimer le dossier `memory` pour les effacer.
- **API locale** : `GET /api/memory` liste les fiches.
- **Après un compactage**, le contexte n'est pas redonné : le résumé du compactage le contient déjà.

#### Compactage automatique

Réglages › Général › *Compactage automatique* fixe la fenêtre à partir de laquelle Claude Code compacte la conversation des sessions de l'app. Par défaut, c'est **la fenêtre complète du modèle**, par exemple 1 million de tokens avec Opus 1M. Les autres choix sont vers 400 000 tokens, vers 200 000 tokens, ou *Réglage de Claude Code* (rien n'est imposé).

Si une session compacte toutes les quelques minutes, la cause est souvent `CLAUDE_CODE_AUTO_COMPACT_WINDOW` réglé trop bas, par exemple 128000 dans `env` de `~/.claude/settings.json`. Claude compacte alors vers 95 000 tokens, même sur un modèle 1M. Le choix par défaut remplace cette valeur pour les sessions de l'app. Pour le terminal, retirer la ligne de `~/.claude/settings.json`.

<a id="16-bis-synchroniser-la-liste-entre-machines"></a>

### 16 bis. Synchroniser les sessions entre machines

Retrouver sur le PC les sessions créées sur le Mac, et inversement : **nom, dossier, modèle et options, groupe, épinglage, couleur, accès téléphone**, et **leur conversation** (historique et contexte), pour continuer sur une machine ce qui a été commencé sur l'autre.

- **Quoi synchroniser** (Réglages › Synchronisation › *À synchroniser*) : la liste des sessions (toujours), et au choix **les conversations**, **la liste des groupes** (groupes vides compris, dans l'ordre ; déplacer une session d'un groupe à l'autre sur une machine la déplace aussi sur les autres) et **les modèles de session** (chiffrés, dossier traduit comme pour les sessions). À la première synchro, les groupes des deux machines sont réunis. Une option décochée n'envoie ni n'applique rien ; recochée, tout ce qui a changé entre-temps est rattrapé.
- **Mémoire des sessions** (option *Mémoire des sessions*, cochée par défaut) : les résumés de chaque session (§ 16 ter) partent chiffrés, et ceux des autres machines sont donnés à Claude au démarrage des sessions du même dossier. Cette option est indépendante de claude-mem.
- **Mémoire claude-mem** (option *Mémoire claude-mem des sessions de l'app*, cochée par défaut, si le moteur de mémoire choisi est *claude-mem* ou *Les deux*) : les sessions lancées par Claude Sessions ont **leur propre mémoire claude-mem** (dossier `claude-mem` des données de l'app, worker sur son propre port). Ses observations, résumés et prompts partent chiffrés dans l'espace de synchro, et ceux des autres machines sont chargés ici : une machine qui saisit le code **récupère toute la mémoire à sa première synchro**, avant même sa première session. **Le terminal du système est séparé** : `claude` lancé dans Terminal, iTerm ou PowerShell garde sa mémoire locale (`~/.claude-mem`), jamais lue, envoyée ni modifiée. Limites : ajout seulement (un souvenir effacé sur une machine ne l'est pas ailleurs) ; la recherche sémantique (Chroma) ne voit les souvenirs reçus qu'après sa réindexation, la recherche plein texte tout de suite.
- **Tout est chiffré de bout en bout** : sessions, groupes, modèles et conversations sont chiffrés sur ta machine (AES-256-GCM, clé dérivée de ton code) avant l'envoi. Le code ne quitte jamais tes machines : le serveur ne reçoit qu'une clé d'accès dérivée (il n'en garde que l'empreinte) et ne peut ni lire ni modifier ce qu'il stocke. Seuls le modèle, le mode (hors bypassPermissions) et l'effort d'une session passent d'une machine à l'autre : aucun autre argument de `claude` n'est repris.

- **Désactivée par défaut.** Rien n'est synchronisé tant qu'aucun **code de synchro** n'est actif. Chaque code est un espace isolé : sans ton code, personne ne voit tes sessions, et tu ne vois pas les leurs.
- **Première machine** : Réglages › Synchronisation › **Créer un code**. L'app tire un code (`XXXX-XXXX-XXXX-XXXX-XXXX`), enregistre sur le serveur l'empreinte de la clé d'accès qui en dérive, et l'affiche en clair avec un bouton **Copier**. La synchro démarre tout de suite.
- **Autres machines** : Réglages › Synchronisation › **J'ai déjà un code**, colle le code puis **Activer** (majuscules, espaces et tirets indifférents). Donne un **nom de machine** parlant (« PC bureau », « Mac ») dans **Avancé**.
- Une session venue d'une autre machine apparaît **arrêtée**, avec un badge **⇄ machine**. **Reprendre** continue sa conversation dans le dossier correspondant de cette machine (la dernière version est récupérée juste avant). Une conversation est envoyée dès qu'elle change (au plus toutes les 2 minutes pendant que Claude travaille) ; si elle a été modifiée des deux côtés, la plus récente gagne. Une session ouverte ici n'est jamais écrasée. Limite : 40 Mo par conversation (compressée).
- **Dossiers** : le dossier personnel est traduit tout seul (`/Users/moi/Projets/app` ↔ `C:\Users\moi\Projets\app`). Pour d'autres emplacements, déclare des alias identiques sur chaque machine (Avancé), une ligne par alias : `code=D:\dev` sur le PC, `code=~/dev` sur le Mac. Si le dossier n'existe pas ici, la session s'ouvre dans le dossier personnel (une note l'indique).
- **Fréquence** (Réglages › Synchronisation › *Synchroniser automatiquement*) : **toutes les 5, 10 ou 30 minutes ou toutes les heures** (5 min par défaut). Ce que tu changes sur une machine part **tout de suite** ; l'intervalle règle quand les autres machines vont le chercher. **Synchroniser maintenant** force une synchro immédiate.
- Renommer, regrouper ou supprimer une session se propage aux autres machines à leur synchro suivante (selon leur fréquence) ; en cas de modifications simultanées, la plus récente gagne. Une session supprimée ailleurs mais **en cours ici** n'est pas arrêtée.
- **Ne partage ton code qu'avec tes propres machines** : il donne accès à tes sessions et à leurs conversations. **Désactiver** l'efface de cette machine.

**Serveur de synchro** : par défaut, l'app utilise le serveur public du projet (Worker Cloudflare + base D1). Il ne voit jamais le code ni le contenu en clair, et limite la création d'espaces et la place occupée. **Code créé avant la 3.8** : il avait été tiré par le serveur ; il continue de fonctionner (rattaché automatiquement à la nouvelle clé d'accès), mais pour un chiffrement de bout en bout strict, crée un nouveau code (Désactiver, puis Créer un code) et saisis-le sur tes autres machines. Tu peux héberger le tien (gratuit) avec [`sync-worker/`](sync-worker), puis mettre son adresse dans Réglages › Synchronisation › Avancé › **Serveur** :

```bash
cd sync-worker
npx wrangler d1 create csm-sync          # puis mets son database_id dans wrangler.toml
npx wrangler d1 execute csm-sync --remote --file schema.sql
npx wrangler deploy                       # affiche l'adresse https://csm-sync.<toi>.workers.dev
```

Chaque code a son propre espace. Le serveur refuse tout code qu'il n'a pas créé et ne stocke que les champs listés plus haut.

## 17. Mises à jour

- **Windows** : l'app vérifie les nouvelles versions (au lancement puis toutes les 30 minutes, même fenêtre cachée), les télécharge en arrière-plan et affiche un bandeau **Redémarrer pour mettre à jour** (aussi dans le menu de l'icône). Le serveur est relancé avec le nouveau code et **tes sessions reviennent toutes seules**.
- **macOS** : même principe. L'app télécharge le `.dmg` de ton processeur (Apple Silicon ou Intel), vérifie son empreinte (sha512 de `latest-mac.yml`), prépare la nouvelle version puis affiche **Redémarrer pour mettre à jour** : l'app se ferme, est remplacée dans son dossier (mot de passe administrateur demandé seulement si ce dossier ne t'appartient pas) et se relance avec tes sessions. En cas d'échec, elle revient au lien vers la page de téléchargement.
- **Installation et redémarrage automatiques** (Windows et macOS, activés par défaut) : une fois la version prête, l'app l'installe et redémarre **toute seule** dès que la fenêtre est réduite ou cachée en arrière-plan (elle revient alors cachée, sans te déranger) ou que l'ordinateur est inactif depuis 5 minutes, et jamais pendant qu'une session travaille ; les sessions reviennent. Tu peux aussi cliquer **Redémarrer pour mettre à jour** sans attendre. Réglages › Général › décocher **Installer la mise à jour et redémarrer tout seul** pour garder la main. Sur macOS, si le dossier de l'app demande un mot de passe administrateur, l'installation reste manuelle. Le journal `update.log` (dossier de données de l'app) indique chaque étape et pourquoi une installation attend (fenêtre au premier plan, session au travail…).
- Réglages › À propos › **Rechercher des mises à jour** pour vérifier tout de suite.
- Bandeau jaune **« le serveur tourne une ancienne version »** : clique **Redémarrer le serveur** ; les fonctions récentes (dépôt d'images, verrouillage…) en dépendent.

<a id="raccourcis"></a><a id="raccourcis-ctrlalt"></a><a id="raccourcis-ctrlalt--sur-mac--ctrloption"></a>
## 18. Raccourcis clavier

| Raccourci | Action |
|---|---|
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> | palette de commandes |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>,</kbd> | réglages |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Maj</kbd>+<kbd>F</kbd> | rechercher dans toutes les sessions |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> | nouvelle session |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> | historique |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>9</kbd> / <kbd>↑</kbd> <kbd>↓</kbd> | changer de session (touche physique : marche en AZERTY) |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>←</kbd> <kbd>→</kbd> | changer de panneau (vue partagée) |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> | prochaine session qui attend une réponse |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd> | panneau Modifications |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd> | ouvrir le dossier dans l'éditeur |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Q</kbd> | file d'attente de la session |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> | envoyer à plusieurs sessions |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd> | verrouiller la session |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> | mode focus |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> / <kbd>W</kbd> | renommer / fermer la session |

Sur Mac, <kbd>Ctrl</kbd>+<kbd>Alt</kbd> = <kbd>Ctrl</kbd>+<kbd>Option</kbd>. Dans le terminal — Windows : <kbd>Ctrl</kbd>+<kbd>C</kbd> avec sélection copie, <kbd>Ctrl</kbd>+<kbd>V</kbd> colle, <kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> zoome. macOS : <kbd>⌘</kbd>+<kbd>C</kbd>/<kbd>V</kbd>/<kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> ; <kbd>Ctrl</kbd>+<kbd>C</kbd> et <kbd>Ctrl</kbd>+<kbd>V</kbd> restent à Claude.

## 19. Données, sécurité, confidentialité

- **Tout reste sur ta machine.** Le serveur de l'app écoute uniquement sur `127.0.0.1` (inaccessible depuis le réseau), exige un jeton aléatoire et vérifie l'en-tête Host. Aucune télémétrie : seules tes sessions Claude Code parlent à l'API d'Anthropic, comme d'habitude. Seule exception, si tu l'actives : la synchronisation (§ 16 bis) envoie la liste des sessions (noms, dossiers, groupes, options) et, sauf si tu le désactives, leurs conversations chiffrées de bout en bout, au serveur de synchro (celui du projet ou le tien). [Politique de confidentialité](https://khalilbenaz.github.io/claude-sessions-manager/privacy.html).
- **Fenêtre isolée** : pas d'accès système depuis la page, navigation limitée au serveur local, liens externes ouverts dans ton navigateur, permissions limitées aux notifications et au presse-papiers, aucun script extérieur (CSP).
- **Données de l'app** : `%APPDATA%\claude-sessions` (Windows), `~/Library/Application Support/claude-sessions` (macOS) — sessions, réglages, modèles, prompts, jeton, journal. Désinstaller l'app ne les supprime pas.
- **Mémoire des sessions** : `memory/` dans les données de l'app (§ 16 ter). Elle reste locale, sauf si la synchro et son option *Mémoire des sessions* sont actives ; elle est alors envoyée chiffrée.
- **Conversations** : ce sont celles de Claude Code, dans `~/.claude/projects` ; l'app les lit (historique, consommation, export) et n'y écrit que le nom d'une session renommée, ou la conversation reçue d'une autre machine quand la synchro est active (envoyée chiffrée, voir § 16 bis).

## 20. Dépannage

| Problème | Solution |
|---|---|
| Glisser une image affiche « Échec : route », ou une fonction récente n'apparaît pas | le serveur tourne un ancien code : bandeau jaune **Redémarrer le serveur** (ou menu de l'icône › Redémarrer le serveur). Les sessions reviennent. |
| « Claude Code introuvable » / la session s'arrête aussitôt | vérifier `claude --version` dans un terminal ; Réglages › Diagnostic indique le chemin utilisé. Sur Mac : lancer une fois `open -a "Claude Sessions"` depuis le Terminal. |
| Worktrees / Modifications indisponibles | `git` n'est pas installé (Diagnostic l'indique). |
| L'icône n'apparaît pas près de l'horloge (Windows 11) | elle est sous la flèche **^** ; glisse-la dans la zone visible. |
| macOS : l'app ne s'ouvre pas (« développeur non vérifié », « endommagée ») | Réglages Système › Confidentialité et sécurité › **Ouvrir quand même** ; ou `xattr -cr "/Applications/Claude Sessions.app"` puis relancer. |
| Mot de passe de verrouillage oublié | non récupérable : fermer la session ; la conversation reste dans les fichiers de Claude Code. |
| Autre souci | Réglages › Diagnostic › **Copier le rapport**, puis [ouvrir une issue](https://github.com/khalilbenaz/claude-sessions-manager/issues). |

<a id="installation-en-ligne-de-commande-sans-application"></a><a id="commandes"></a><a id="options"></a>
## 21. Ligne de commande `csm` (sans l'application)

Pour utiliser Claude Sessions dans un navigateur, sans l'application de bureau (prérequis : [Node.js](https://nodejs.org) 18+) :

```sh
git clone https://github.com/khalilbenaz/claude-sessions-manager.git ~/claude-sessions-manager
cd ~/claude-sessions-manager
npm ci && npm install -g .   # commande « csm »
csm install                  # démarrage automatique + raccourci (tâche planifiée / LaunchAgent)
csm                          # ouvre la fenêtre
```

Autres commandes : `csm stop` (les sessions reviendront au prochain démarrage), `csm restart`, `csm status`, `csm log`, `csm where`, `csm uninstall`. Mise à jour : `git pull && npm ci && csm restart`. Variables : `CSM_PORT` (défaut 7890 ; un autre port = instance séparée avec ses propres données), `CSM_DATA`, `CSM_CLAUDE`.

> `npm install -g github:…` n'est pas fiable sous Windows (bug npm avec node-pty) : passer par le clone.

<a id="développement"></a>
## 22. Développement

```sh
npm ci
npm test            # serveur de bout en bout (faux claude, profil temporaire, aucun appel API)
npm run test:app    # application Electron (Playwright, fenêtre invisible)
npm run app         # lancer l'app en développement (CSM_PORT=7891 pour une instance séparée)
npm run dist:win    # installeur Windows → dist/   (npm run dist:mac sur un Mac)
```

Architecture : `server.js` (serveur local, un pseudo-terminal node-pty par session, hooks Claude Code pour l'état) + modules `lib/` (git, verrouillage, réglages, consommation, outils, file d'attente) ; interface `public/` (xterm.js) ; application `electron/`. Un tag `v*` lance les tests puis construit et publie les installeurs Windows et macOS (`.github/workflows/release.yml`).

## Licence

[MIT](LICENSE) — logiciel libre. Projet indépendant, non affilié à Anthropic ; « Claude » et « Claude Code » sont des marques d'Anthropic.

## Code signing policy

Windows builds are intended to be signed through the [SignPath Foundation](https://signpath.org) free code signing program for open-source projects (application pending).

- Builds are produced only by the public GitHub Actions workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) from tagged commits of this repository; no locally built binary is ever signed.
- Committers and reviewers: [@khalilbenaz](https://github.com/khalilbenaz)
- Approvers (release signing): [@khalilbenaz](https://github.com/khalilbenaz)

## Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. Full policy: https://khalilbenaz.github.io/claude-sessions-manager/privacy.html

Claude Sessions runs a server bound to `127.0.0.1` only (not reachable from the network) and stores its data locally (`%APPDATA%\claude-sessions`, `~/Library/Application Support/claude-sessions`). It collects no telemetry. Network traffic comes only from the Claude Code sessions the user starts, which talk to Anthropic's API as Claude Code normally does.
