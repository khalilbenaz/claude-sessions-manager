# Claude Sessions Manager

Une seule fenêtre pour piloter plusieurs sessions Claude Code au lieu d'une pile d'onglets de terminal.

```
csm install    # une fois : serveur lancé à chaque ouverture de session Windows + raccourci menu Démarrer
csm            # ouvre la fenêtre (démarre le serveur si besoin)
csm stop       # arrête le serveur (les sessions ouvertes reviendront au prochain démarrage)
csm restart | status | log | uninstall
```

## Fonctionnement

- `server.js` (Node, `127.0.0.1:7890`) héberge chaque session `claude` dans un PTY (ConPTY). Les sessions **survivent à la fermeture de la fenêtre** : on rouvre `csm`, tout est là (scrollback 2 Mo/session).
- L'état de chaque session vient de hooks Claude Code injectés via `--settings` (`hook.js`) : **travaille** (orange), **attend une réponse** (rouge, notification Windows), **prêt** (vert), **arrêtée** (cercle).
- Le `session_id` Claude est capté par le hook SessionStart → après un `csm restart` ou un reboot, « Reprendre » relance `claude --resume <id>`.
- **Historique** : toutes les conversations de `~/.claude/projects` (titre, dossier, branche, dernier prompt), filtrables, reprise en un clic dans le bon dossier.
- Sécurité : écoute locale uniquement, contrôle de l'en-tête Host (anti DNS-rebinding), jeton aléatoire (`data/token`) exigé sur l'API et le WebSocket (anti-CSRF).

## Persistance

- Le serveur tourne hors de tout terminal (tâche planifiée, `conhost --headless`) : fermer un terminal ne touche à rien.
- Chaque session ouverte est mémorisée (`data/sessions.json` : dossier, nom, modèle, ordre, id de conversation). Au démarrage du serveur (reboot, crash, `csm restart`), elles sont toutes relancées avec `--resume`. Seules celles arrêtées volontairement (bouton Arrêter, `/exit`) ou fermées restent fermées.
- **Dans un terminal** : les sessions Claude ouvertes dans des terminaux (registre `~/.claude/sessions`) apparaissent en bas de la barre latérale ; « ramener » arrête le processus du terminal et reprend la conversation dans csm.

## Raccourcis (Ctrl+Alt+…)

| Touche | Action |
|---|---|
| N | nouvelle session |
| H | historique |
| 1…9 / ↑ ↓ | changer de session |
| A | aller à la prochaine session qui attend une réponse |
| R | renommer (ou double-clic sur le nom) |
| W | fermer la session |

Dans le terminal : Ctrl+C avec sélection = copier, Ctrl+V = coller, Ctrl+ +/-/0 = zoom. Glisser-déposer pour réordonner.

## Options

- `CSM_PORT` : port (défaut 7890) · `CSM_CLAUDE` : chemin de l'exécutable claude.
