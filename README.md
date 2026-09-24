# Claude Sessions Manager

Une seule fenêtre pour piloter plusieurs sessions Claude Code au lieu d'une pile d'onglets de terminal. **Windows et macOS.**

## Installation

Prérequis : [Node.js](https://nodejs.org) 18+ et [Claude Code](https://docs.claude.com/claude-code) (`claude` dans le PATH).

```sh
git clone https://github.com/khalilbenaz/claude-sessions-manager.git ~/claude-sessions-manager
cd ~/claude-sessions-manager
npm ci && npm install -g .   # commande « csm » globale, liée à ce dossier
csm install                  # une fois : démarrage automatique + raccourci
```

Mise à jour : `cd ~/claude-sessions-manager && git pull && npm ci && csm restart`.

> `npm install -g github:…` directement n'est pas fiable sous Windows (bug npm avec les dépendances à script d'installation comme node-pty) : passer par le clone.

`csm install` ajoute :

| | Démarrage automatique | Raccourci |
|---|---|---|
| **Windows** | tâche planifiée « Claude Sessions Manager » (ouverture de session, sans fenêtre) | menu Démarrer › **Claude Sessions** (épinglable) |
| **macOS** | LaunchAgent `com.claude-sessions.server` (ouverture de session, relancé en cas de crash) | `~/Applications/Claude Sessions.app` (Spotlight, Dock) |

Sur macOS, lancer `csm install` depuis un terminal où `claude` fonctionne : son `PATH` est repris pour le LaunchAgent.

La fenêtre s'ouvre en mode application avec Edge / Chrome / Brave (sinon le navigateur par défaut).

## Commandes

```
csm            ouvre la fenêtre (démarre le serveur si besoin)
csm install    démarrage automatique + raccourci      csm uninstall   les retire (données gardées)
csm stop       arrête le serveur (les sessions ouvertes reviendront au prochain démarrage)
csm restart | status | log | where | --version
```

Données : `%APPDATA%\claude-sessions` (Windows), `~/Library/Application Support/claude-sessions` (macOS).
Variables : `CSM_PORT` (défaut 7890 ; un autre port = instance séparée avec ses propres données), `CSM_DATA`, `CSM_CLAUDE`.

## Fonctionnement

- Le serveur Node (`127.0.0.1:7890`) héberge chaque session `claude` dans un pseudo-terminal (node-pty : ConPTY sous Windows, pty sous macOS). Il tourne hors de tout terminal : fermer un terminal ou la fenêtre ne touche à rien.
- État en direct via des hooks Claude Code injectés par `--settings` (`hook.js`) : **travaille** (orange), **attend une réponse** (rouge + notification), **prêt** (vert), **arrêtée** (cercle).
- **Persistance** : chaque session (dossier, nom, modèle, ordre, id de conversation) est mémorisée. Au démarrage du serveur (redémarrage de l'ordinateur, crash, `csm restart`) toutes les sessions ouvertes sont relancées avec `--resume`. Seules celles arrêtées volontairement (bouton Arrêter, `/exit`) ou fermées restent fermées.
- **Historique** : toutes les conversations de `~/.claude/projects`, filtrables, reprise en un clic dans le bon dossier.
- **Dans un terminal** : les sessions Claude ouvertes dans des terminaux (registre `~/.claude/sessions`) apparaissent en bas de la barre latérale. *Déplacer* arrête la session dans le terminal et la reprend dans csm ; *Copier* laisse le terminal tourner et ouvre une copie (`--fork-session`).
- **Parcourir…** ouvre le sélecteur de dossier natif (Windows : boîte de dialogue système ; macOS : `choose folder`).
- Sécurité : écoute locale uniquement, contrôle de l'en-tête Host (anti DNS-rebinding), jeton aléatoire exigé sur l'API et le WebSocket (anti-CSRF).

## Raccourcis (Ctrl+Alt+… — sur Mac : Ctrl+Option+…)

| Touche | Action |
|---|---|
| N | nouvelle session |
| H | historique |
| 1…9 / ↑ ↓ | changer de session (touche physique : fonctionne en AZERTY) |
| A | aller à la prochaine session qui attend une réponse |
| R | renommer (ou double-clic sur le nom) |
| W | fermer la session |

Dans le terminal — Windows : Ctrl+C avec sélection = copier, Ctrl+V = coller, Ctrl +/−/0 = zoom. macOS : Cmd+C / Cmd+V, Cmd +/−/0 ; Ctrl+C et Ctrl+V restent à Claude. Glisser-déposer pour réordonner.
