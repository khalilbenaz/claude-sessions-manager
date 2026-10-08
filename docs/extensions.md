# Extensions de Claude Sessions

Une extension est **un seul fichier** `nom.csm.json`. Elle ajoute à l'application :

- des **modèles de session** (proposés dans « Nouvelle session ») ;
- des **prompts** (dans la palette, <kbd>Ctrl</kbd>+<kbd>K</kbd>) ;
- des **types de session** : un affichage dédié, rempli par Claude, et des boutons d'action.

Une extension **n'exécute aucun code** dans l'application : elle décrit, Claude fait. Elle peut donc se partager en privé (un collègue, une équipe) sans risque pour l'app. Pour ajouter une fonctionnalité métier, on crée une extension, sans toucher à l'application.

## Installer

- **Réglages › Extensions › Importer une extension…**, ou glisser le fichier sur cette page. Réimporter un fichier du même `id` le met à jour.
- **Par un plugin Claude Code** : les fichiers `*.csm.json` du dossier `csm/` d'un plugin installé sont chargés automatiquement (pratique pour une équipe : le plugin se met à jour, les extensions suivent). Ils se retirent en désinstallant le plugin.
- Chaque extension se désactive ou se supprime dans la même page.
- **Synchronisation** : avec un code de synchro, une extension importée est installée sur toutes tes machines (chiffrée) ; désactivation et suppression suivent. Une extension fournie par un plugin est copiée sur les machines qui n'ont pas le plugin (celles qui l'ont gardent leur version ; seule la plus récente circule) et retirée quand le plugin est désinstallé. Taille utile pour la synchro : environ 50 Ko de JSON.

## Format

```json
{
  "csm": 1,
  "id": "revue-de-code",
  "name": "Revue de code",
  "version": "1.0.0",
  "description": "…",
  "author": "…",
  "templates": [ … ],
  "prompts": [ … ],
  "sessionTypes": [ … ]
}
```

- `csm` : toujours `1`.
- `id` : minuscules, chiffres et tirets (2 à 40 caractères), unique. Les `id` des modèles, prompts, types et actions suivent la même règle.
- Taille : 256 Ko au plus.

### Modèles (`templates`)

| Champ | Rôle |
|---|---|
| `id`, `name`, `description` | identifiant, nom affiché, description |
| `cwd` | dossier de travail proposé |
| `model` | `opus`, `sonnet`, `haiku`… |
| `mode` | `""`, `default`, `acceptEdits` ou `plan` (jamais `bypassPermissions`) |
| `group` | groupe de la session |
| `worktree` | `true` : worktree git dédié |
| `prompt` | premier message, envoyé dès que Claude est prêt |
| `type` | `id` d'un type de session de la même extension |

### Prompts (`prompts`)

`{ "id", "title", "text", "tags" }` : apparaissent dans la palette, insérés dans la session active.

### Types de session (`sessionTypes`)

| Champ | Rôle |
|---|---|
| `id`, `name` | identifiant, nom |
| `badge`, `color` | étiquette courte et couleur (`#RRGGBB`) affichées en haut de la session |
| `instructions` | consignes ajoutées au prompt système de Claude pour ce type de session |
| `actions` | boutons : `{ "id", "label", "send", "primary", "confirm" }`. Un clic envoie le texte `send` à la session (`confirm` : demande d'abord). |

Une session d'un type a deux vues, **Affichage** et **Terminal** (bouton en haut). L'application donne à Claude le chemin d'un fichier (variable `CSM_VIEW_FILE`) et lui explique le format ci-dessous ; Claude y écrit l'état de l'affichage, qui se met à jour tout seul.

## Affichage écrit par Claude

```json
{
  "title": "…", "subtitle": "…",
  "meta": [{ "label": "État", "value": "Active" }],
  "sections": [
    { "kind": "text", "title": "Résumé", "text": "…" },
    { "kind": "alert", "level": "warn", "text": "…" },
    { "kind": "list", "title": "…", "items": ["…"] },
    { "kind": "kv", "title": "…", "items": [{ "label": "…", "value": "…" }] },
    { "kind": "timeline", "title": "…", "items": [{ "at": "08/10 14:15", "text": "…" }] },
    { "kind": "table", "title": "…", "columns": ["…"], "rows": [["…"]] },
    { "kind": "checklist", "title": "…", "items": [{ "label": "…", "hint": "…", "done": false }] },
    { "kind": "draft", "title": "Message", "text": "texte à relire", "actions": [{ "label": "Envoyer", "send": "Envoie ce message : {draft}" }] }
  ]
}
```

- Tout est affiché **en texte brut** : ni HTML ni Markdown interprétés.
- `draft` : un texte modifiable par l'utilisateur ; ses boutons envoient `send` à la session, `{draft}` étant remplacé par le texte relu.
- Une section d'un `kind` inconnu est ignorée.

## Exemple

[`extensions/revue-de-code.csm.json`](../extensions/revue-de-code.csm.json) : un modèle « Revue de code », un prompt et un type de session avec un tableau des problèmes et deux actions.
