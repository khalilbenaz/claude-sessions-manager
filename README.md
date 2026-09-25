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
16. [Réglages](#16-réglages)
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

- **Définir le groupe** : champ *Groupe* dans « Nouvelle session » (les groupes existants sont proposés), ou plus tard ⋯ › **Groupe…** (taper `-` pour retirer la session de son groupe).
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
- **Pastille** sur l'icône de l'app (Dock / barre des tâches) avec le nombre de sessions en attente.
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

- **Thème** : **Système** (par défaut) suit automatiquement le mode clair ou sombre de Windows / macOS, y compris quand il change en cours de journée ; ou forcer **Clair** / **Sombre** (Réglages › Général, ou palette › « Thème »). Le terminal suit le thème.
- **Langue** : français ou anglais, automatiquement selon la langue du système, ou forcée dans Réglages › Général.

## 16. Réglages

⚙ en bas de la barre latérale, ou <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>,</kbd>.

| Onglet | Contenu |
|---|---|
| **Général** | thème (système, clair, sombre), langue, modèle et mode par défaut, worktree proposé par défaut, éditeur pour « Ouvrir dans », mises à jour automatiques, barre latérale compacte, réduire / fermer dans la zone de notification |
| **Terminal** | taille et police du texte |
| **Notifications** | notifications système, son (avec test), ne pas déranger, rappels d'attente et de longue exécution |
| **Sécurité** | reverrouiller quand la fenêtre est masquée, après une inactivité |
| **Modèles de session** | lancer, renommer, supprimer |
| **Prompts** | ouvrir la bibliothèque de prompts |
| **Diagnostic** | versions, `claude` et `git` trouvés ou non, hooks, dossiers, dernières lignes du journal ; **Copier le rapport** pour une issue |
| **Journaux** | le journal du serveur, filtrable |
| **À propos** | version, rechercher des mises à jour |

## 17. Mises à jour

- **Windows** : l'app vérifie les nouvelles versions (au lancement, toutes les heures quand la fenêtre est utilisée, et toutes les 6 h), les télécharge en arrière-plan et affiche un bandeau **Redémarrer pour mettre à jour** (aussi dans le menu de l'icône). Le serveur est relancé avec le nouveau code et **tes sessions reviennent toutes seules**.
- **macOS** : l'app te prévient qu'une version est disponible et ouvre la page de téléchargement (la mise à jour automatique demande une app signée par Apple).
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

- **Tout reste sur ta machine.** Le serveur de l'app écoute uniquement sur `127.0.0.1` (inaccessible depuis le réseau), exige un jeton aléatoire et vérifie l'en-tête Host. Aucune télémétrie : seules tes sessions Claude Code parlent à l'API d'Anthropic, comme d'habitude. [Politique de confidentialité](https://khalilbenaz.github.io/claude-sessions-manager/privacy.html).
- **Fenêtre isolée** : pas d'accès système depuis la page, navigation limitée au serveur local, liens externes ouverts dans ton navigateur, permissions limitées aux notifications et au presse-papiers, aucun script extérieur (CSP).
- **Données de l'app** : `%APPDATA%\claude-sessions` (Windows), `~/Library/Application Support/claude-sessions` (macOS) — sessions, réglages, modèles, prompts, jeton, journal. Désinstaller l'app ne les supprime pas.
- **Conversations** : ce sont celles de Claude Code, dans `~/.claude/projects` ; l'app les lit (historique, consommation, export) et n'y écrit que le nom d'une session renommée.

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
