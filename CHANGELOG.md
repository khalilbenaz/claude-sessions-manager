# Journal des versions

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; versions [SemVer](https://semver.org/lang/fr/).

## [3.36.1] — 2026-10-09
### Corrigé
- Tests : les jetons d'accès ne touchent plus au trousseau ni aux variables du compte (build Windows).

## [3.36.0] — 2026-10-09
### Ajouté
- **Jetons d'accès des extensions** : une extension déclare les secrets dont ses outils ont besoin (`secrets` : nom, explication, lien, variable d'environnement, entrée du trousseau). Au démarrage, s'il manque, une fenêtre **Accès à configurer** le demande avec le lien **Obtenir le jeton** ; il est rangé dans le trousseau macOS, une variable de l'utilisateur sous Windows, ou un fichier 0600 sous Linux, jamais renvoyé à l'interface. Voir docs/extensions.md.
### Corrigé
- Réglages › Synchronisation : le code masqué n'affiche plus « … » (les points tiennent dans la case) ; affiché, il n'est plus coupé.

## [3.35.2] — 2026-10-08
### Corrigé
- « Claude is waiting for your input » (rappel de Claude Code après une minute d'inactivité) ne fait plus passer la session en « attend une réponse » ni n'apparaît dans le centre d'attention : la session reste prête.
- Usage de Claude : boutons de période (« 7 jours », « 30 jours ») tronqués ; la ligne du titre passe à la ligne en fenêtre étroite.

## [3.35.1] — 2026-10-08
### Corrigé
- **Heure affichée une heure trop tard sous Windows** (Maroc passé à GMT, données de fuseaux d'Electron plus anciennes) : l'app suit maintenant le décalage de Windows, comme déjà sur macOS.
- Bouton de la barre latérale compacte : la flèche s'inverse quand la barre est réduite, et son libellé dit « Déplier » / « Réduire ».

## [3.35.0] — 2026-10-08
### Ajouté
- **Usage de Claude** : période Jour / 7 jours / 30 jours ; quota 5 h avec heures, prévision hachurée et seuil de pause ; **quota 7 jours avec sa propre prévision** (historique conservé) ; tâches planifiées avec « Ajouter » et leur cible ; vue **toutes les machines** (agrégats chiffrés via la synchro, option « Usage de Claude », jamais de conversation).
- **Palette** : résultats par sections (Sessions, Actions, Prompts, Modèles, Conversations), terme surligné, préfixes `>` (commandes) et `/` (prompts), **Ctrl/⌘+Entrée** ouvre une session dans un panneau, « Synchroniser maintenant », dossier et machine d'origine de chaque session.
- **Réglages › Synchronisation** : carte d'en-tête (code masqué, Afficher / Copier, Synchroniser maintenant, état), options en interrupteurs, machines en cartes avec « Ajouter une machine ».
- **Espace de travail** : chemin complet sous le nom de la session et état en pastille ; « Synchronisé · machine » sur la ligne des boutons ; recherche « Rechercher, agir… » avec Ctrl K ; rappel de file d'attente.
- **Vue partagée** : bandeau d'aide masquable, numéro des sessions, boutons **Oui / Toujours / Non** dans le panneau qui demande une autorisation.
- **Nouvelle session** : premier message visible, case « Verrouiller par mot de passe », raccourci affiché, « Dépôt git détecté · branche … » sous le dossier, bouton « Lancer la session ».
- **Centre d'attention** : commande demandée isolée dans un bloc, « Voir les modifications » pour un résultat à relire.
### Corrigé
- Document d'usage synchronisé : recalculé aussitôt si la machine est renommée.
## [3.34.1] — 2026-10-08
### Corrigé
- « Erreur JavaScript dans le processus principal : EPIPE » à la vérification des mises à jour (sortie standard fermée).
- « Création impossible : Terminal is not defined » : une fenêtre chargée pendant le redémarrage du serveur (mise à jour) se recharge seule ; **F5** recharge la fenêtre.
- Quota de la barre latérale et de l'usage différent de celui de la console : la valeur ancienne d'une session inactive n'écrase plus la plus récente ; dernière valeur toujours transmise, relevée toutes les 10 s.
- Notifications « Ta connexion à Claude expire… » envoyées par les instances de test (développement) : plus aucune notification système depuis une instance de test.
- Nouvelle session : modèles sur une ligne, quatre par rangée, sans défilement.

## [3.34.0] — 2026-10-08
### Ajouté
- **Extensions par lien** : Réglages › Extensions accepte un lien GitHub (fichier, dossier, dépôt entier : `.csm.json` à la racine, dans `csm/` ou `extensions/`), un gist ou une adresse https. Dépôt privé via la CLI GitHub connectée (jeton envoyé seulement à l'API GitHub, sans redirection). **Mettre à jour** réimporte depuis le même lien.
- **Modèles nombreux** (Nouvelle session) : filtres par provenance (Tous, Mes modèles, chaque extension) et recherche, cartes compactes ; plus de liste à faire défiler.
### Corrigé
- Réglages › Extensions n'affichait aucune extension installée (identifiant en double avec la liste des sessions ouvertes dans un terminal).
- **Noms des sessions entre machines** : la liste des sessions (noms, groupes, épinglage…) est relevée toutes les 30 s au lieu d'attendre la synchro complète ; un nom reçu est aussi écrit dans la conversation (`claude --resume`). Une session fantôme créée par une ancienne version à partir d'un document de synchro est retirée.
- **Quotas absents de la barre latérale** avec une barre d'état personnelle : l'app relève désormais les quotas puis affiche la barre d'état de l'utilisateur telle quelle (`statusline.js --relay`).
### Modifié
- **Site refait** dans le style Atelier (clair / sombre, polices intégrées, icônes dessinées) avec de vraies captures : nouveautés 3.33, vue partagée, centre d'attention, usage de Claude, extensions, modèles, synchro (conversations, groupes, modèles, extensions, plugins). Captures régénérables par `node test/site-shots.js` (instance isolée, contenu de démonstration).

## [3.33.1] — 2026-10-08
### Modifié
- Icônes dessinées (traits, couleur du thème) à la place des emoji : recherche, historique, nouveau groupe, réglages, barre compacte, renommer, modifications, ouvrir, joindre, plus d'actions, dispositions, actions des groupes. Libellés accessibles (lecteurs d'écran) sur les boutons-icônes.

## [3.33.0] — 2026-10-08
### Ajouté
- **Usage de Claude** (refonte, étape 4) : <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>U</kbd>, palette ou clic sur les quotas de la barre latérale. Sessions actives, demandes à traiter, temps de travail de Claude du jour (dont « sans toi », via la file d'attente), coût estimé jour / 7 jours ; quota 5 h avec historique et prévision de la limite ; prochaines tâches planifiées ; détail par session.

## [3.32.0] — 2026-10-08
### Ajouté
- **Centre d'attention** (refonte, étape 3) : bouton « À traiter N » dans la barre du haut, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd>, palette. Autorisations de toutes les sessions avec leur contexte (Autoriser, Toujours pour ce projet, Refuser), commandes risquées signalées en premier, « Autoriser les lectures seules » ; questions avec réponse directe ; tâches terminées à relire.

## [3.31.0] — 2026-10-08
### Modifié
- **Nouvelle session** (refonte, étape 2) : modèles présentés en cartes (« Partir d'un modèle », ceux des extensions marqués de leur nom), modèle Claude en boutons (Opus, Sonnet, Haiku, Défaut).
### Ajouté
- **Vue partagée** : barre « Envoyer à N panneaux » sous la grille, pour envoyer un même message à toutes les sessions affichées (mis en file si une session travaille).

## [3.30.0] — 2026-10-08
### Modifié
- **Nouvelle interface « Atelier »** (1re étape de la refonte) : graphite et argile en sombre, ivoire en clair, contraste vérifié ; polices IBM Plex Sans et JetBrains Mono intégrées (licence OFL, aucune connexion) ; barre latérale, en-tête de session (état en pastille), fenêtres, palette, réglages et terminal redessinés.
### Ajouté
- Bas de la barre latérale : quotas **5 h** et **7 jours** (barres, pourcentage, heure de réinitialisation) et état de la synchro.
### Corrigé
- Réglages : les cases à cocher ne prennent plus la hauteur d'un champ de saisie (options moins espacées).
- Terminaux réajustés quand la police arrive après leur ouverture, et quand la fenêtre redevient visible.

## [3.29.0] — 2026-10-08
### Modifié
- Une extension fournie par un plugin ne voyage plus seule : elle n'arrive qu'**avec son plugin** (dont elle utilise les skills et agents), installé par la synchro des plugins. Les copies reçues seules (3.27) sont retirées ; celles publiées par une machine encore en 3.27 sont ignorées.

## [3.28.0] — 2026-10-08
### Ajouté
- Synchro des **plugins Claude Code** : les machines d'un espace ont les mêmes plugins (marketplaces GitHub). Plugin reçu : validation dans Réglages › Synchronisation (« Plugins à valider ») si « Me demander… » est coché, sinon installation automatique. Une machine qui n'a pas un plugin ne le fait jamais retirer ailleurs ; une désinstallation réelle est propagée et toujours proposée, jamais appliquée seule. Marketplaces locaux jamais partagés.
### Corrigé
- Réglages ouverts directement sur la page Extensions (palette, lien) : la liste se charge (avant : seulement après un clic sur l'onglet).

## [3.27.0] — 2026-10-08
### Ajouté
- Synchro des **extensions fournies par un plugin** : copiées sur les machines qui n'ont pas le plugin (« reçue de *machine* (plugin *nom*) ») ; une machine qui a le plugin garde sa version ; seule la version la plus haute circule (pas d'aller-retour entre deux versions) ; copie retirée quand le plugin est désinstallé à la source, et gardée en réserve si le plugin local est désinstallé.

## [3.26.0] — 2026-10-08
### Ajouté
- Synchro des **extensions** importées : installées sur toutes les machines de l'espace (chiffrées), désactivation et suppression comprises ; « reçue de *machine* » dans Réglages › Extensions. Option dans Réglages › Synchronisation. Les extensions des plugins restent propres à chaque machine.
- Synchro du **type de session** (affichage dédié d'une extension) avec la session.
### Corrigé
- File d'attente : la limite des 5 h affichée par Claude est prise en compte même quand la fin du tour arrive avant ce message (machine chargée).
- Extensions d'un plugin : visibles dès l'installation du plugin (plus d'attente).

## [3.25.0] — 2026-10-08
### Ajouté
- **Extensions** : un fichier `.csm.json` ajoute des modèles de session, des prompts et des types de session (affichage dédié rempli par Claude : résumé, tableaux, chronologie, cases à cocher, brouillon à relire ; boutons d'action qui envoient une demande à la session). Purement déclaratif, rien n'est exécuté dans l'app. Import dans Réglages › Extensions (ou glisser-déposer), activation, suppression ; un plugin Claude Code peut en fournir (dossier `csm/`). Format : docs/extensions.md ; exemple : extensions/revue-de-code.csm.json.

## [3.24.0] — 2026-10-08
### Ajouté
- Pastille avec le **nombre** de sessions en attente sur l'icône : overlay de la barre des tâches Windows (avant : un point) et icône du Dock sur macOS quand la pastille native est masquée (app non signée).
- Réglages › Notifications › **Tester la notification** : en montre une et indique par quel moyen elle passe (native ou repli macOS) et quoi régler si rien ne s'affiche.
### Corrigé
- Notifications : passent par l'app sur Windows aussi (clic = fenêtre au premier plan sur la session), plus par l'API du navigateur intégré.
- macOS : la mise à jour ne demande plus le mot de passe à chaque version. App modifiable : remplacée sur place sans mot de passe ; installée par un autre compte : mot de passe demandé une seule fois, puis l'app est attribuée à l'utilisateur.
- README : exemple de groupe neutre.

## [3.23.0] — 2026-10-07
### Modifié
- **Place sur le serveur de synchro : 1 Go par espace** (au lieu de 200 Mo).
- Réglages › Synchronisation › Machines : la barre s'intitule « Place sur le serveur de synchro » et détaille ce qui l'occupe (conversations, configuration de Claude, claude-mem, mémoire intégrée, avec le nombre d'éléments) ; unités cohérentes avec la limite (« 94 Mo sur 1 Go » au lieu de « 94,2 Mo sur 209,7 Mo »).

## [3.22.2] — 2026-10-06
### Corrigé
- **Réglages lus au démarrage par Claude Code** (langue des réponses, mémoire, compactage, barre d'état) : les sessions déjà ouvertes gardaient l'ancien réglage (par exemple « always answer in English » après avoir choisi Français). Après un changement, l'app propose maintenant de les relancer dans leur conversation : tout de suite si elles sont au repos, à la fin de leur tour sinon.

## [3.22.1] — 2026-10-06
### Corrigé
- **Langue des réponses** : avec l'interface en « Automatique », les sessions recevaient « always answer in English » sur un Mac en français (Node lancé par l'app ne connaît pas la langue du système et répond en-US). La langue vient maintenant de l'app (langues préférées du système), sinon des réglages de macOS / Windows, sinon de LANG ; inconnue, rien n'est imposé. Relancer les sessions déjà ouvertes pour qu'elles la prennent.

## [3.22.0] — 2026-10-05
### Ajouté
- **Langue des réponses de Claude** : les sessions lancées par l'app répondent toujours dans la langue de l'interface (français par défaut pour une app en français), via le réglage `language` de Claude Code. Réglages › Général : autre langue, ou garder le réglage de Claude Code. Le `claude` du terminal n'est pas modifié.

## [3.21.1] — 2026-10-05
### Modifié
- Aperçu des images jointes : propre à chaque session et affiché seulement sur la session active (plus sur les autres panneaux de la vue partagée) ; il ne montre que les images du message en cours et disparaît à l'envoi (avant : les 8 dernières, estompées, restaient affichées).

## [3.21.0] — 2026-10-05
### Ajouté
- **Connexion à Claude qui expire** (« Your login expires in 3 days · run /login to renew ») : bandeau 🔑 quelques jours avant l'expiration (5 par défaut) et notification quotidienne ; **Renouveler** lance la connexion depuis l'app (`claude auth login` en arrière-plan), le navigateur s'ouvre sur la page de Claude, et le code éventuel se colle dans l'app. Seule la date d'expiration est lue, jamais les jetons. Réglages › Général : activer, nombre de jours.
### Corrigé
- Tests : lien de dépôt créé en jonction sous Windows (sans droits admin).

## [3.20.0] — 2026-10-04
### Ajouté
- **Aperçu des images jointes** : miniatures en haut à droite du terminal (encadrées pour le message en cours, estompées une fois envoyées, les 8 dernières) ; clic = l'image en grand avec son nom ; ✕ pour les masquer. Lues sur la machine, rien de plus n'est envoyé.

## [3.19.3] — 2026-10-03
### Corrigé
- **Fenêtre noire** sous forte charge (mémoire saturée) : quand macOS ou Windows tue l'affichage ou le GPU, la fenêtre est recréée automatiquement (de même si elle reste figée plus de 20 s), sans toucher au serveur ni aux sessions. <kbd>Cmd</kbd>+<kbd>R</kbd> et le nouveau « Recharger la fenêtre » du menu de l'icône la recréent aussi quand la page est morte.

## [3.19.2] — 2026-10-02
### Corrigé
- Menu clic droit (terminal, session) : il ne déborde plus en bas d'une fenêtre basse ; il reste dans la fenêtre et défile (molette ou flèches) jusqu'au dernier élément.

## [3.19.1] — 2026-10-02
### Corrigé
- **Thème clair** : le code et les diffs de Claude Code (couleurs prévues pour un fond sombre, y compris en RVB) restent lisibles : le terminal ajuste tout texte trop proche du fond (contraste minimal 4,5:1). Panneau Modifications : couleurs des lignes ajoutées / supprimées et du texte adaptées au thème clair ; barres de défilement aussi.
- Réglages › Synchronisation : le bouton s'appelle « Changer de code (couper l'accès d'une machine)… ».

## [3.19.0] — 2026-10-02
### Ajouté
- **Écran Mémoire** (Réglages › Mémoire) : recherche plein texte et filtres (dossier, machine) dans la mémoire intégrée, les notes de Claude Code et claude-mem (lecture seule). Une fiche se renomme, reçoit une note **« À retenir »** (donnée à Claude en premier au démarrage dans ce dossier), perd une demande ou une réponse fausse (elle ne revient pas), ou s'**oublie** (plus jamais donnée ni recréée) ; les corrections suivent la synchro. Les notes de Claude Code se modifient ou se suppriment (copie gardée 30 jours).
- **Machines de la synchro** (Réglages › Synchronisation › Machines) : liste des machines de l'espace (nom, système, version, mémoire, dernière synchro), place occupée sur le serveur, **Retirer** une machine de la liste, **Changer de code…** (nouvel espace, données de cette machine renvoyées, ancien espace effacé du serveur : l'ancien code est refusé).
- Worker : `GET /usage` (place occupée) et `DELETE /space` (effacement complet d'un espace), testés.
### Corrigé
- Mémoire intégrée : un dossier atteint par un lien symbolique (par exemple `/var` → `/private/var` sur macOS) est reconnu comme le même projet.
- Tests : ne joignent plus jamais le serveur de synchro public.

## [3.18.0] — 2026-10-02
### Ajouté
- **La file d'attente suit le quota** : près de la limite des 5 h (seuil réglable, 95 % par défaut, lu par la barre d'état de l'app) ou au message « 5-hour limit reached ∙ resets … » de Claude Code, la file se met en pause (badge ⏸) et repart seule à la réinitialisation ; les sessions coupées par la limite reçoivent « continue ». Réglages › Général.
- **Demandes programmées** (Réglages › Programmées) : un prompt dans une session, ou un modèle de session lancé, à heure fixe, une fois ou certains jours ; passe par la file d'attente si la session est occupée ; échéance manquée de moins de 2 h rattrapée.
- **Fichiers de ~/.claude reçus : validation, journal, restauration.** Règles, skills, agents et commandes reçus attendent ton accord (case cochée par défaut) ; chaque changement reçu est noté avec sa machine d'origine, **Restaurer** remet la version d'avant ; copies effacées après 30 jours.
- **Worker testé et déployé automatiquement** : `sync-worker/` a ses tests (`npm test`, D1 et R2 locaux) et un workflow GitHub Actions qui les lance et déploie au tag (secret `CLOUDFLARE_API_TOKEN`).
### Sécurité
- Synchro de ~/.claude : plus aucune écriture à travers un lien symbolique, hors de ~/.claude (chemin réel vérifié) ni dans un dossier caché ; bit exécutable non synchronisé ; taille et décompression bornées à la réception.
- Choix de mémoire reçu d'une autre machine : claude-mem n'est plus installé sans accord (proposition dans Réglages) ; le choix n'est publié qu'après un choix fait sur la machine.
- Worker : place occupée comptée par le serveur à chaque morceau (plus la taille annoncée par l'app), au plus 200 morceaux en attente par espace, ménage nocturne par lots et recalcul de la place ; ancienne création de code par le serveur (applis < 3.8) retirée.
### Corrigé
- Synchro de ~/.claude : un fichier devenu trop gros, illisible ou un dossier momentanément inaccessible n'est plus pris pour supprimé (ni propagé) ; suppressions massives bloquées avec avertissement ; une copie par remplacement (la version d'origine n'est plus écrasée), rien remplacé si la copie échoue ; envoi refusé par le serveur (autre machine plus rapide) repris au cycle suivant, aussi pour la mémoire intégrée ; dossier de configuration avec « / » final (Windows) ; préfixe du dossier personnel comparé exactement ; fichiers temporaires ignorés.
- Une conversation introuvable n'empêche plus la synchro des suivantes ; « Reprendre » relit toujours la liste du serveur.
- Nouvelle installation : le partage de la mémoire ne se recoche plus au 2ᵉ démarrage ; une mémoire désactivée (3.13-3.14) reste désactivée.
- Réglages ouverts : les choix changés par une autre machine s'affichent ; installation de claude-mem en échec retentée toutes les 30 min.
- Worker : pagination des sessions au-delà de 1 000 lignes modifiées ; plafond de lignes par espace exact.

## [3.17.0] — 2026-10-02
### Modifié
- **Serveur de synchro** : les conversations chiffrées sont stockées dans **Cloudflare R2** (10 Go gratuits) au lieu de la base D1 (500 Mo), qui ne garde plus que les métadonnées. La place occupée est tenue dans un compteur : plus aucune requête ne relit toutes les lignes. Les morceaux envoyés mais jamais validés sont effacés chaque nuit. Espaces existants migrés, rien à faire dans l'app.
- **Moins de lectures** : la liste du serveur est lue une seule fois par synchronisation (au lieu de 4 : conversations, claude-mem, mémoire intégrée, configuration de Claude).
- Héberger son propre serveur : créer aussi le bucket R2 (`npx wrangler r2 bucket create csm-sync-chunks`).

## [3.16.1] — 2026-10-02
### Ajouté
- Réglages › À propos : bouton **Redémarrer pour mettre à jour** dès qu'une nouvelle version est prête, à côté de *Rechercher des mises à jour*.

## [3.16.0] — 2026-10-02
### Ajouté
- **Le choix de la mémoire est synchronisé** : passer de la mémoire intégrée à claude-mem (ou l'inverse) sur une machine fait passer toutes les machines du même espace, et claude-mem s'y installe au besoin. Une machine qui rejoint l'espace prend le choix déjà partagé. Chiffré, avec la case *Mémoire des sessions*.

## [3.15.0] — 2026-10-02
### Modifié
- **Mémoire des sessions : un seul choix, clair.** Réglages › Général › *Mémoire des sessions : laquelle utiliser ?* propose deux options expliquées : **Mémoire intégrée** (recommandé, rien à installer) ou **claude-mem** (installé automatiquement). Les choix « Les deux » et « Aucune » disparaissent : « Les deux » devient claude-mem, « Aucune » devient la mémoire intégrée.
- **Synchro** : une seule case *Mémoire des sessions* partage la mémoire choisie, au lieu de deux cases (mémoire intégrée, claude-mem).
- La case *Mémoire de Claude* de la configuration de Claude s'appelle maintenant *Notes de Claude Code*, pour ne plus la confondre avec la mémoire des sessions.

## [3.14.0] — 2026-10-02
### Ajouté
- **Synchro de la configuration de Claude** entre les machines (Réglages › Synchronisation › *Configuration de Claude*). Elle couvre :
  - les règles : `~/.claude/CLAUDE.md`, les `.md` qu'il importe et `~/.claude/rules` ;
  - les skills : `~/.claude/skills` ;
  - les agents et commandes : `~/.claude/agents` et `~/.claude/commands` ;
  - la mémoire de Claude : les dossiers `memory/` de `~/.claude/projects`, avec les chemins traduits d'une machine à l'autre.

  Les fichiers sont chiffrés. Les créations, modifications et suppressions suivent, et la version la plus récente gagne. Un fichier remplacé ou supprimé est d'abord sauvegardé dans `claude-sync-backup`. Chaque catégorie a sa case.

## [3.13.0] — 2026-10-02
### Ajouté
- **Choix du moteur de mémoire** (Réglages › Général › *Mémoire des sessions*). Quatre choix : mémoire de Claude Sessions (par défaut), claude-mem, les deux, ou aucune.
  - claude-mem est **installé automatiquement** quand il est choisi et absent. L'état de l'installation s'affiche dans Réglages.
  - Il est activé ou coupé pour les sessions de l'app seulement, via `enabledPlugins` dans leur fichier `--settings`. Le terminal n'est pas touché.
- **Compactage automatique** (Réglages › Général). Par défaut, les sessions de l'app compactent à **la fenêtre complète du modèle**. Autres choix : vers 400 000 tokens, vers 200 000 tokens, ou le réglage de Claude Code.
- À propos : « Créé par Khalil », avec un lien vers son profil LinkedIn.
### Corrigé
- **Compactage en boucle** : `CLAUDE_CODE_AUTO_COMPACT_WINDOW` réglé bas dans `~/.claude/settings.json` (128000 par exemple) faisait compacter vers 95 000 tokens, toutes les quelques minutes, même avec Opus 1M. Il est maintenant remplacé pour les sessions de l'app.
- Après un compactage, la mémoire des sessions n'est plus réinjectée : le résumé la contient déjà.
### Modifié
- L'ancienne case *Mémoire des sessions* est migrée vers le nouveau choix : cochée devient la mémoire de Claude Sessions, décochée devient *Aucune*.
- Avec la mémoire de Claude Sessions (le choix par défaut), claude-mem n'est plus chargé dans les sessions de l'app. Pour le garder, choisir *Les deux*.

## [3.12.0] — 2026-10-02
### Ajouté
- **Mémoire des sessions, sans claude-mem** (Réglages › Général, activée par défaut).
  - Chaque session lancée par l'app est résumée au fil de l'eau : demandes, fin des réponses de Claude, fichiers modifiés, branche et machine.
  - Au démarrage d'une session, Claude reçoit (hook `SessionStart`) les 6 sessions les plus récentes du même dossier, puis la liste des autres dossiers récents.
  - La mémoire complète est gardée en Markdown, un fichier par dossier (`memory/projects/`), que Claude peut lire et fouiller.
  - Aucun plugin ni appel d'API : seule la suite du transcript est lue à la fin de chaque tour.
- **Mémoire partagée entre machines** (Réglages › Synchronisation › *Mémoire des sessions*, cochée par défaut).
  - Les résumés sont chiffrés de bout en bout, comme les conversations.
  - Une session commencée sur le Mac donne son contexte à la suivante sur le PC, dans le même projet.
  - Si un résumé a changé des deux côtés, la version la plus récente gagne.
- `GET /api/memory` : liste des fiches mémoire.

## [3.11.1] — 2026-09-30
### Corrigé
- **Mise à jour automatique jamais déclenchée sur une app laissée ouverte** : les nouvelles versions n'étaient cherchées qu'au lancement puis toutes les 6 h (ou au retour sur la fenêtre après 1 h), donc une version sortie pendant que l'app tournait en arrière-plan n'était ni téléchargée ni installée. Vérification désormais toutes les 30 minutes, fenêtre cachée comprise.

### Ajouté
- Journal `update.log` dans le dossier de données : étapes de la mise à jour et raison de l'attente d'une installation automatique.

## [3.11.0] — 2026-09-30
### Ajouté
- **Fréquence de synchronisation réglable** (Réglages › Synchronisation › *Synchroniser automatiquement*) : toutes les 5, 10, 30 minutes ou toutes les heures (5 min par défaut). Les changements faits sur la machine partent toujours tout de suite ; « Synchroniser maintenant » force une synchro. Le nouvel intervalle s'applique sans redémarrer.

### Modifié
- La synchro automatique passe de toutes les 30 secondes à toutes les 5 minutes par défaut (moins de trafic, moins de réveils).

## [3.10.0] — 2026-09-30
### Ajouté
- Mises à jour (Windows et macOS) : installation et redémarrage automatiques. Une version prête s'installe seule dès que la fenêtre est réduite ou cachée en arrière-plan (l'app revient alors cachée) ou que l'ordinateur est inactif depuis 5 min, jamais pendant qu'une session travaille ; les sessions sont restaurées. Réglage « Installer la mise à jour et redémarrer tout seul » (activé par défaut). Sur macOS, reste manuel si le remplacement de l'app demande un mot de passe administrateur.

## [3.9.1] — 2026-09-30
### Corrigé
- Mémoire synchronisée : « version de claude-mem trop ancienne » se répare tout seul. Quand la base de mémoire de l'app a été créée par un claude-mem trop ancien, l'app met claude-mem à jour (commande claude plugin update), relance sa mémoire avec la nouvelle version, qui migre la base, puis reprend la synchro (au plus une tentative toutes les 6 h ; étapes affichées dans Réglages › Synchronisation). La version de claude-mem réellement installée est utilisée en priorité.

## [3.9.0] — 2026-09-29
### Ajouté
- Groupes : boutons ✎ (renommer) et ✕ (supprimer) au survol de l'en-tête, double-clic sur le nom pour renommer, commandes de la palette « Renommer / Supprimer le groupe ». Renommer vers un groupe existant fusionne.
- Synchro de la mémoire claude-mem (option cochée par défaut) : les sessions de l'app ont leur propre base claude-mem, dont observations, résumés et prompts sont envoyés chiffrés et chargés sur chaque machine de l'espace — une machine qui saisit le code récupère toute la mémoire à sa première synchro. Le `claude` du terminal système garde sa mémoire locale, jamais touchée.
### Corrigé
- macOS : la mise à jour automatique fonctionne enfin — téléchargement du .dmg de l'architecture, empreinte sha512 vérifiée, remplacement de l'app et relance au redémarrage (repli sur le lien de téléchargement en cas d'échec).

## [3.8.0] — 2026-09-29
### Sécurité (audit complet)
- Synchro : le code ne quitte plus les machines. Il est tiré localement ; le serveur ne reçoit qu'une clé d'accès dérivée (HKDF) dont il ne garde que l'empreinte, et ne peut donc plus déchiffrer. Les anciens espaces sont rattachés automatiquement ; créer un nouveau code est recommandé pour un chiffrement strict.
- Synchro : les sessions (nom, dossier, arguments…) sont chiffrées et authentifiées ; les arguments repris d'une autre machine sont limités au modèle, au mode (hors bypassPermissions) et à l'effort (un serveur ou un tiers ne peut plus faire exécuter de commande via --settings, --dangerously-skip-permissions…). Couleur, groupe et nom validés.
- Synchro : chiffrement lié à l'élément (session, version, date) : un serveur ne peut plus échanger deux conversations ni en remettre une ancienne ; identifiant de conversation vérifié avant d'en faire un nom de fichier. HTTPS exigé (sauf serveur local).
- Serveur de synchro : limites par adresse (/64 en IPv6), par espace (5000 lignes, 200 Mo) et au total.
- Verrouillage : l'identifiant de conversation d'une session verrouillée n'est plus exposé, et --resume / --continue dans les arguments d'une nouvelle session sont refusés comme « Reprendre ». Essais de mot de passe limités aussi par HTTP (5 puis attente croissante).
- Les sessions ne reçoivent plus le jeton complet de l'API : un jeton dédié n'ouvre que la route des hooks (tout ce que Claude exécute en héritait).
- Fichiers de données (jeton, réglages, sessions, état de synchro) créés en lecture/écriture pour l'utilisateur seul.
### Ajouté
- Synchro : liste des groupes (vides compris, dans l'ordre, réunie à la première synchro) et modèles de session (chiffrés) ; le déplacement d'une session entre groupes suit sur les autres machines. Choix de ce qui est synchronisé : conversations, groupes, modèles (Réglages › Synchronisation › À synchroniser).

## [3.7.0] — 2026-09-29
### Ajouté
- Groupes : bouton 🗂 « Nouveau groupe » (barre latérale, palette) ; un groupe créé reste visible vide. Glisser une session sur le titre d'un groupe (ou sur une session de ce groupe) l'y déplace ; menu « Déplacer vers le groupe… » ; clic droit sur un groupe : nouvelle session dedans, renommer (les sessions suivent), supprimer.

## [3.6.0] — 2026-09-29
### Ajouté
- Barre d'état des quotas dans chaque session : 5 h / 7 j avec l'heure et le délai de réinitialisation, contexte utilisé, modèle (`5h 20% ↻ 13:21 (2h09) · 7j 90% ↻ jeu 18:44 (2j7h)`). Fournie seulement si tu n'as pas ta propre `statusLine` Claude Code ; réglage dans Réglages › Général.

## [3.5.1] — 2026-09-29
### Modifié
- Terminal : plus de barre de défilement (inutile : la molette fait défiler, et en plein écran c'est Claude qui défile).

## [3.5.0] — 2026-09-29
### Ajouté
- Synchro : les **conversations** suivent maintenant les sessions d'une machine à l'autre (historique et contexte). « Reprendre » sur le PC continue la conversation commencée sur le Mac, et inversement. Chiffrées de bout en bout (AES-256-GCM, clé dérivée du code de synchro) : le serveur ne peut pas les lire. Réglage « Synchroniser aussi les conversations » (activé par défaut). Nécessite la mise à jour du serveur de synchro (sync-worker, nouvelles tables D1).
### Corrigé
- Terminal : avec Claude Code en plein écran (`"tui": "fullscreen"`), la barre de défilement de xterm restait figée (c'est Claude qui fait défiler) ; elle est masquée dans ce mode.

## [3.4.4] — 2026-09-29
### Corrigé
- Barre du haut : elle reste sur une seule ligne. Le titre, le dossier et le message se tronquent (…) en premier ; quand la fenêtre est étroite, le message puis le dossier sont masqués ; les boutons restent toujours visibles.

## [3.4.3] — 2026-09-29
### Corrigé
- macOS : les sessions ne démarrent plus en « env: node: No such file or directory » (code 127) quand l'app est lancée avec un PATH minimal (shell de connexion trop lent au démarrage). Le serveur complète le PATH avec les emplacements usuels de node/claude (fnm, nvm, volta, Homebrew…) et le dossier réel de claude ; délai du shell de connexion porté à 10 s.
- Fenêtre « Nouvelle session » : plus de défilement horizontal, les listes déroulantes restent dans leur colonne.
- Barre du haut : les boutons passent à la ligne quand la fenêtre est étroite au lieu d'être rognés.

## [3.4.2] — 2026-09-28
### Corrigé
- L'heure affichée (dernière synchro, etc.) suit le fuseau du système même quand les données de fuseaux embarquées par Electron sont périmées (ex. Maroc passé à GMT le 20/09/2026 : l'app affichait GMT+1).

## [3.4.1] — 2026-09-28

### Modifié
- **Code de synchro créé en un clic** : Réglages › Synchronisation › **Créer un code** demande au serveur un code court (`XXXX-XXXX-XXXX-XXXX-XXXX`), l'enregistre en base (empreinte seulement) et l'affiche en clair avec **Copier**. Sur une autre machine, **J'ai déjà un code** puis **Activer**. Plus besoin de configurer le serveur à la main ; les codes créés avant restent valables. Le serveur limite la création de codes et refuse tout code inconnu (#27).

## [3.4.0] — 2026-09-28

### Ajouté
- **Synchronisation de la liste des sessions entre machines** (PC ↔ Mac) : nom, dossier, modèle et options, groupe, épinglage, couleur, accès téléphone. Les conversations restent locales. Désactivée par défaut ; s'active en collant un **code de synchro** (Réglages › Synchronisation). Chaque code est un espace isolé sur un serveur Cloudflare (Worker + D1, dans `sync-worker/`) qui n'accepte que les clés autorisées. Une session venue d'ailleurs apparaît arrêtée avec un badge ⇄ ; « Reprendre » ouvre une nouvelle conversation dans le dossier traduit (dossier personnel automatique, alias pour les autres). La modification la plus récente gagne ; les suppressions se propagent (#27).

### Modifié
- **Son des notifications coupé par défaut**, y compris sur les installations existantes (une fois ; il se rallume dans Réglages › Notifications).

## [3.3.3] — 2026-09-25

### Corrigé (tests manuels sur Mac, #1)
- **État après Ctrl+C / Échap** : la session repasse à « prêt (interrompu) » (Claude Code n'appelle aucun hook dans ce cas) (#32).
- **Session en attente de permission** : l'afficher ne la marque plus « prête » ; le rouge reste tant que Claude attend (#32).
- **macOS sans signature Apple** : notifications par AppleScript et point rouge sur l'icône du Dock (le centre de notifications refuse les apps non signées) ; un seul rebond du Dock par attente ; Cmd+W garde l'icône dans le Dock ; couleur du point rouge de la barre de menus (#33).
- **Déplacer / Copier depuis un terminal** : la conversation garde son modèle (lu dans le transcript) au lieu de repasser en opus.
- Palette : « Aucun résultat » n'est plus écrasé sur deux lignes.

## [3.3.2] — 2026-09-25

### Modifié
- Délais plus larges : hooks de Claude (15 s), démarrage du serveur par l'app (30 s), arrêt du serveur avant redémarrage / mise à jour (15 s) — évite une session bloquée sur « démarrage » ou un faux « le serveur ne démarre pas » sur une machine chargée.
- Guide : astuce `/theme` pour les couleurs de Claude Code en thème clair ; fiche et captures du Microsoft Store (`store-assets/`).

## [3.3.1] — 2026-09-25

### Corrigé (retours des tests sur Mac, #1)
- **Premier lancement sur macOS récent** : procédure mise à jour (Réglages Système › Confidentialité et sécurité › *Ouvrir quand même*, ou `xattr -cr`) ; « clic droit › Ouvrir » ne suffit plus.
- **Menus macOS** entièrement traduits (Édition, Fenêtre étaient en anglais), selon la langue du système ; ajout de Réglages… (⌘,) dans Fichier.
- **Chemins de `claude` et `node` avec fnm** : les dossiers temporaires par shell (`fnm_multishells`) sont remplacés par leur emplacement réel.

### Préparé
- Paquet Microsoft Store (nom réservé : « Claude Sessions Manager ») — voir STORE.md (#29).

## [3.3.0] — 2026-09-25

### Ajouté
- **Accès depuis l'app Claude (téléphone) et claude.ai/code** grâce à la fonction Remote Control de Claude Code : case dans « Nouvelle session », bascule pour une session ouverte (⋯, palette, sans relancer), réglage pour toutes les nouvelles sessions, badge 📱 ; la session garde son nom dans l'app Claude et se reconnecte après un redémarrage (#28).

### Corrigé
- « + Nouvelle » : un nom, un groupe, un mode, un premier prompt ou des arguments saisis juste après l'ouverture de la fenêtre pouvaient être effacés (le clic était pris pour un modèle de session).

## [3.2.2] — 2026-09-25

### Ajouté
- **Bibliothèque de prompts pré-remplie** au premier lancement : 8 prompts prêts à l'emploi (relire, tests, expliquer, commit, bug, plan, documenter, résumer), modifiables.
- **Enregistrer une session comme modèle** (⋯, clic droit, palette) : reprend son dossier, son groupe, son modèle et son mode.
- Écrans vides explicatifs (modèles) avec bouton pour créer directement ; la liste « Modèle de session » est toujours visible dans « Nouvelle session ».

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
