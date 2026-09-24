# Claude Sessions Manager

Une seule fenêtre pour piloter plusieurs sessions Claude Code au lieu d'une pile d'onglets de terminal.

```
csm            # démarre le serveur si besoin + ouvre la fenêtre (Edge en mode app)
csm stop       # arrête le serveur et toutes les sessions
csm restart | status | log
```

## Fonctionnement

- `server.js` (Node, `127.0.0.1:7890`) héberge chaque session `claude` dans un PTY (ConPTY). Les sessions **survivent à la fermeture de la fenêtre** : on rouvre `csm`, tout est là (scrollback 2 Mo/session).
- L'état de chaque session vient de hooks Claude Code injectés via `--settings` (`hook.js`) : **travaille** (orange), **attend une réponse** (rouge, notification Windows), **prêt** (vert), **arrêtée** (cercle).
- Le `session_id` Claude est capté par le hook SessionStart → après un `csm restart` ou un reboot, « Reprendre » relance `claude --resume <id>`.
- **Historique** : toutes les conversations de `~/.claude/projects` (titre, dossier, branche, dernier prompt), filtrables, reprise en un clic dans le bon dossier.
- Sécurité : écoute locale uniquement, contrôle de l'en-tête Host (anti DNS-rebinding), jeton aléatoire (`data/token`) exigé sur l'API et le WebSocket (anti-CSRF).

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
