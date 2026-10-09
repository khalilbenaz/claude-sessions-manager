# Extensions de Claude Sessions

Une extension est **un seul fichier** `nom.csm.json`. Elle ajoute à l'application :

- des **modèles de session** (proposés dans « Nouvelle session ») ;
- des **prompts** (dans la palette, <kbd>Ctrl</kbd>+<kbd>K</kbd>) ;
- des **types de session** : un affichage dédié, rempli par Claude, et des boutons d'action.

Une extension **n'exécute aucun code** dans l'application : elle décrit, Claude fait. Elle peut donc se partager en privé (un collègue, une équipe) sans risque pour l'app. Pour ajouter une fonctionnalité métier, on crée une extension, sans toucher à l'application.

## Installer

- **Réglages › Extensions › Importer un fichier…**, ou glisser le fichier sur cette page, ou coller un **lien** : fichier GitHub, dossier, dépôt (ses `.csm.json` à la racine, dans `csm/` ou `extensions/`), gist ou adresse https. Dépôt privé : CLI GitHub connectée (`gh auth login`). **Mettre à jour** réimporte depuis le même lien. Réimporter un fichier du même `id` le met à jour.
- **Par un plugin Claude Code** : les fichiers `*.csm.json` du dossier `csm/` d'un plugin installé sont chargés automatiquement (pratique pour une équipe : le plugin se met à jour, les extensions suivent). Ils se retirent en désinstallant le plugin.
- Chaque extension se désactive ou se supprime dans la même page.
- **Synchronisation** : avec un code de synchro, une extension importée est installée sur toutes tes machines (chiffrée) ; désactivation et suppression suivent. Une extension fournie par un plugin ne voyage qu'avec son plugin : la synchro des plugins propose de l'installer sur les autres machines, l'extension arrive avec lui. Taille utile pour la synchro : environ 50 Ko de JSON.

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
  "sessionTypes": [ … ],
  "secrets": [ … ]
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

## Secrets (jetons d'accès)

Une extension dont les outils ont besoin d'un jeton (API, dépôt privé…) le déclare ; au démarrage, l'app le demande s'il manque, avec le lien pour l'obtenir, et le range **là où les outils le lisent**. La valeur n'est jamais renvoyée à l'interface, ni écrite dans l'extension ou les données synchronisées.

```json
"secrets": [
  {
    "id": "jeton-api",
    "name": "Jeton de l'API",
    "description": "Lecture seule suffit. Échéance conseillée : 90 jours.",
    "url": "https://exemple.com/parametres/jetons",
    "env": "EXEMPLE_TOKEN",
    "keychain": "exemple-token",
    "alsoEnv": ["EXEMPLE_TOKEN_RO"],
    "alsoKeychain": ["exemple-token-ro"]
  }
]
```

- **Où il est rangé** : macOS, le trousseau (service `keychain`) ; Windows, la variable d'environnement `env` de ton compte (donnée aussi aux sessions lancées ensuite) ; Linux, ou sans `keychain`, un fichier `secrets.env` (droits 0600) des données de l'app, chargé dans l'environnement des sessions.
- **Déjà configuré** si `env` (ou un `alsoEnv`) est défini, ou si le trousseau contient `keychain` (ou un `alsoKeychain`).
- **Ne plus demander** masque la demande ; l'extension désactivée, plus rien n'est demandé.
- `url` : https seulement. Au plus 10 secrets par extension.
