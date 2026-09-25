'use strict';
// Interface bilingue FR / EN (#15). La clé est le texte français : t('Nouvelle session') → « New session » en anglais.
// Les textes statiques de la page (nœuds texte, title, placeholder) sont traduits au chargement.
const EN = {
  // états
  'démarrage': 'starting', 'travaille': 'working', 'attend une réponse': 'waiting for you', 'prêt': 'ready', 'arrêtée': 'stopped', 'terminé': 'done',
  'attend toujours une réponse': 'is still waiting for you', 'travaille depuis longtemps': 'has been working for a long time',
  // barre latérale / barre
  'Sessions': 'Sessions', 'Nouvelle': 'New', '+ Nouvelle': '+ New', 'Rechercher…': 'Search…', 'Dans un terminal': 'In a terminal', 'Tout ramener': 'Bring all',
  'Historique': 'History', 'Épinglées': 'Pinned', 'Sans groupe': 'No group', 'Relancer': 'Restart', 'Reprendre': 'Resume', 'Arrêter': 'Stop', 'Fermer': 'Close',
  'Worktree': 'Worktree', 'base': 'base', 'branche': 'branch', 'Modifications': 'Changes', 'Chronologie': 'Timeline', 'Consommation': 'Usage',
  '↗ Ouvrir': '↗ Open', 'Aucune modification': 'No changes', 'modification': 'change', 'modifications': 'changes',
  '(vide — glisser une session ici)': '(empty — drop a session here)', 'Vider ce panneau': 'Clear this pane',
  'Aucune session': 'No sessions', '+ Nouvelle session': '+ New session', 'Redémarrer le serveur': 'Restart server',
  'nouvelle session': 'new session', 'palette': 'palette', 'historique': 'history', 'naviguer': 'navigate',
  // menus
  'Renommer': 'Rename', 'Ouvrir dans…': 'Open in…', 'Dans l’éditeur': 'In editor', 'Dans le Finder': 'In Finder', 'Dans l’Explorateur': 'In Explorer',
  'File d’attente…': 'Queue…', 'Insérer un prompt…': 'Insert a prompt…', 'Envoyer à plusieurs sessions…': 'Send to several sessions…',
  'Exporter la conversation…': 'Export conversation…', 'Groupe…': 'Group…', 'Désépingler': 'Unpin', 'Épingler en haut': 'Pin to top',
  'Réactiver les alertes': 'Unmute alerts', 'Couper les alertes de cette session': 'Mute alerts for this session',
  'Copier le chemin': 'Copy path', 'Copier l’identifiant de session': 'Copy session ID', 'Copier': 'Copy', 'Coller': 'Paste', 'Couper': 'Cut',
  'Joindre un fichier…': 'Attach a file…', 'Tout sélectionner': 'Select all', 'Effacer l’écran': 'Clear screen',
  'Zoom avant': 'Zoom in', 'Zoom arrière': 'Zoom out', 'Taille normale': 'Actual size', 'Recharger la fenêtre': 'Reload window',
  'Nouvelle session': 'New session', 'Afficher': 'Show', 'Ramener dans csm…': 'Bring into csm…', 'ramener': 'bring',
  // fermeture / worktree
  'Cette session travaille dans le worktree': 'This session works in the worktree', 'Fusionné dans': 'Merged into',
  'Supprimer définitivement le worktree et la branche': 'Permanently delete the worktree and branch',
  "Le processus Claude sera arrêté (la conversation reste reprenable depuis l'historique).": 'The Claude process will be stopped (the conversation can still be resumed from History).',
  'Fermer la session': 'Close session', 'Fermer et garder le worktree': 'Close and keep the worktree',
  'Le dossier et la branche restent : tu pourras y revenir, fusionner plus tard ou les supprimer à la main.': 'The folder and branch stay: you can come back, merge later or delete them manually.',
  'Fusionner puis supprimer': 'Merge then delete', 'Fusionne la branche dans sa branche de base, puis supprime le worktree et la branche. Les modifications doivent être commitées.': 'Merges the branch into its base branch, then deletes the worktree and branch. Changes must be committed.',
  'Supprimer le worktree et la branche': 'Delete the worktree and branch', 'Abandonne tout le travail de cette branche.': 'Discards all work on this branch.',
  // nouvelle session
  'Modèle de session': 'Session template', '— aucun —': '— none —', 'Dossier de travail': 'Working folder', 'Parcourir…': 'Browse…', 'Nom': 'Name', 'Groupe': 'Group',
  '(nom du dossier)': '(folder name)', '(aucun)': '(none)', 'Modèle': 'Model', 'Mode': 'Mode', 'par défaut': 'default', 'défaut Claude Code': 'Claude Code default',
  'Travailler dans un': 'Work in a dedicated', 'worktree git': 'git worktree', 'dédié (nouvelle branche, sans toucher au dépôt principal)': '(new branch, main checkout untouched)',
  'Branche': 'Branch', 'Options avancées': 'Advanced options', 'Premier prompt (envoyé dès que la session est prête)': 'First prompt (sent as soon as the session is ready)',
  'Arguments supplémentaires': 'Extra arguments', 'Enregistrer comme modèle': 'Save as template', 'Annuler': 'Cancel', 'Lancer': 'Launch', 'Valider': 'OK',
  'Dossier': 'Folder', 'Nom du modèle': 'Template name', 'Retrouvable dans « Modèle de session » et la palette (Ctrl+K).': 'Available in “Session template” and the palette (Ctrl+K).',
  'Modèle enregistré': 'Template saved', 'Création impossible': 'Could not create', 'Renommer la session': 'Rename session', 'Renommer la conversation': 'Rename conversation',
  'Le nom est aussi enregistré dans la conversation Claude (historique, claude --resume).': 'The name is also saved in the Claude conversation (history, claude --resume).',
  'Renommage impossible : ': 'Rename failed: ',
  // panneau modifications
  'Chargement…': 'Loading…', 'Le dossier de cette session n’est pas un dépôt git.': 'This session’s folder is not a git repository.', 'Actualiser': 'Refresh',
  'Worktree dédié': 'Dedicated worktree', 'Fusionner dans': 'Merge into', 'indexé': 'staged', 'Annuler les modifications de ce fichier': 'Discard changes to this file',
  'Message du commit': 'Commit message', 'Proposer un message': 'Suggest a message', 'Committer tout': 'Commit all', 'Cliquer un fichier pour voir le diff.': 'Click a file to see its diff.',
  'Aucune modification dans ce dossier.': 'No changes in this folder.', '(fichier binaire ou vide)': '(binary or empty file)', 'Annuler toutes les modifications de': 'Discard all changes to',
  'Le fichier (non suivi) sera supprimé.': 'The (untracked) file will be deleted.', 'Modifie': 'Update', 'ajoute': 'add', 'supprime': 'remove', 'Mise à jour': 'Update',
  'Session': 'Session', 'Commit créé': 'Commit created', 'Fusionner la branche': 'Merge branch', 'dans': 'into',
  // chronologie / consommation
  'Aucune action pour l’instant.': 'No actions yet.', 'Calcul…': 'Computing…', 'Cette session': 'This session', 'Entrée': 'Input', 'Sortie': 'Output', 'Coût estimé': 'Est. cost',
  'Total': 'Total', 'Toutes les sessions': 'All sessions', '5 dernières heures': 'Last 5 hours', 'Aujourd’hui': 'Today', '7 derniers jours': 'Last 7 days',
  'Sessions les plus coûteuses (7 jours)': 'Most expensive sessions (7 days)',
  'Coût estimé aux tarifs API publics, à titre indicatif (inclus dans un abonnement Claude). Entrée = tokens lus, cache compris.': 'Estimated at public API prices, for reference only (included in a Claude subscription). Input = tokens read, cache included.',
  'Enregistrer en Markdown (.md)': 'Save as Markdown (.md)', 'Copier le Markdown': 'Copy Markdown', 'Copié': 'Copied', 'Imprimer / PDF…': 'Print / PDF…',
  'Groupe de la session': 'Session group', 'Groupes existants': 'Existing groups', '« - » pour retirer la session de son groupe.': '“-” removes the session from its group.',
  // réglages
  'Réglages': 'Settings', 'Système (suit Windows / macOS)': 'System (follows Windows / macOS)', 'Général': 'General', 'Terminal': 'Terminal', 'Notifications': 'Notifications', 'Modèles de session': 'Session templates', 'Prompts': 'Prompts',
  'Diagnostic': 'Diagnostics', 'Journaux': 'Logs', 'À propos': 'About', 'Thème': 'Theme', 'Sombre': 'Dark', 'Clair': 'Light', 'Système': 'System', 'Langue': 'Language',
  'Automatique': 'Automatic', 'Modèle par défaut': 'Default model', 'Mode par défaut': 'Default mode', 'Proposer un worktree git par défaut dans un dépôt': 'Offer a git worktree by default in a repository',
  'Éditeur pour « Ouvrir dans »': 'Editor for “Open in”', 'Commande personnalisée': 'Custom command', 'Commande personnalisée…': 'Custom command…',
  'Mises à jour automatiques': 'Automatic updates',
  'Réduire dans la zone de notification (au lieu de la barre des tâches)': 'Minimize to the notification area (instead of the taskbar)',
  "Fermer la fenêtre la garde dans la zone de notification (sinon l'app se ferme ; les sessions continuent)": 'Closing the window keeps the app in the notification area (otherwise the app quits; sessions keep running)', 'Barre latérale compacte': 'Compact sidebar', 'Taille du texte': 'Font size', 'Police': 'Font',
  'Raccourcis :': 'Shortcuts:', 'pour zoomer.': 'to zoom.', 'Notifications système': 'System notifications', 'Son': 'Sound', 'Aucun': 'None', 'Discret': 'Soft', 'Clochette': 'Bell',
  '▶ Tester': '▶ Test', 'Ne pas déranger (ni notification ni son)': 'Do not disturb (no notification, no sound)',
  'Rappel si une session attend depuis (minutes, 0 = jamais)': 'Remind me when a session has been waiting for (minutes, 0 = never)',
  'Alerte si une session travaille depuis plus de (minutes, 0 = jamais)': 'Alert when a session has been working for more than (minutes, 0 = never)',
  'Un modèle mémorise dossier, nom, modèle, mode, worktree, groupe et premier prompt. Créer : « Enregistrer comme modèle » dans la fenêtre Nouvelle session.': 'A template stores folder, name, model, mode, worktree, group and first prompt. Create one with “Save as template” in the New session window.',
  'Snippets réutilisables, insérés dans la session active depuis la palette (': 'Reusable snippets, inserted into the active session from the palette (', ') ou le menu ⋯.': ') or the ⋯ menu.',
  'Ouvrir la bibliothèque de prompts': 'Open the prompt library', 'Copier le rapport': 'Copy report', 'Filtrer les journaux…': 'Filter logs…',
  '— logiciel libre (MIT).': '— free software (MIT).', 'Rechercher des mises à jour': 'Check for updates',
  'Aucun modèle pour l’instant.': 'No templates yet.', 'Supprimer': 'Delete', 'Renommer le modèle': 'Rename template', 'Supprimer le modèle': 'Delete template',
  'serveur': 'server', 'introuvable ou en erreur': 'not found or failing', 'introuvable (worktrees et panneau Modifications indisponibles)': 'not found (worktrees and Changes panel unavailable)',
  'Données': 'Data', 'Code': 'Code', 'actives': 'running', 'mémoire': 'memory', 'en service depuis': 'up for', 'dernières lignes du journal': 'last log lines',
  'Rapport copié — à coller dans une issue GitHub': 'Report copied — paste it into a GitHub issue',
  'Dans le navigateur : mettre à jour avec git pull puis csm restart.': 'In the browser: update with git pull then csm restart.',
  'Redémarrer pour mettre à jour': 'Restart to update', 'Télécharger': 'Download', 'Recherche de mises à jour…': 'Checking for updates…',
  'Version de développement : mises à jour automatiques désactivées.': 'Development build: automatic updates disabled.', 'Claude Sessions est à jour.': 'Claude Sessions is up to date.',
  'Mises à jour automatiques désactivées dans les réglages.': 'Automatic updates are disabled in Settings.', 'Téléchargement de la version {v}… {p}': 'Downloading version {v}… {p}',
  'Version {v} prête : redémarre pour l’installer.': 'Version {v} is ready: restart to install it.', 'Version {v} disponible au téléchargement.': 'Version {v} is available for download.',
  'Échec de la vérification : {e}': 'Update check failed: {e}', 'Réglage non enregistré : ': 'Setting not saved: ',
  // accès depuis l'app Claude
  "📱 Accessible depuis l'": '📱 Accessible from the ', 'app Claude': 'Claude app', '(téléphone) et claude.ai/code — Remote Control de Claude Code': '(phone) and claude.ai/code — Claude Code Remote Control',
  "📱 Rendre les nouvelles sessions accessibles depuis l'app Claude (Remote Control)": 'Make new sessions available in the Claude app (Remote Control)',
  "Remote Control de Claude Code : la session apparaît dans l'app Claude (onglet Code) et sur claude.ai/code. Connexion sortante via Anthropic, aucun port ouvert ; le code reste sur ce PC. Nécessite un abonnement Pro, Max, Team ou Enterprise connecté avec /login (pas une clé API).": 'Claude Code Remote Control: the session shows up in the Claude app (Code tab) and on claude.ai/code. Outbound connection through Anthropic, no open port; your code stays on this computer. Requires a Pro, Max, Team or Enterprise subscription signed in with /login (not an API key).',
  'Session accessible depuis l’app Claude (onglet Code)': 'Session available in the Claude app (Code tab)', 'Accès depuis l’app Claude désactivé': 'Claude app access turned off',
  'Désactiver l’accès depuis l’app Claude': 'Turn off Claude app access', '📱 Accès depuis l’app Claude (téléphone)': '📱 Access from the Claude app (phone)',
  // modèles / prompts
  'Enregistrer comme modèle…': 'Save as template…', 'Enregistrer la session comme modèle': 'Save session as template',
  'Reprend le dossier, le groupe, le modèle et le mode de cette session. Retrouvable dans « Nouvelle session » et la palette (Ctrl+K).': 'Uses this session\u2019s folder, group, model and mode. Available in “New session” and the palette (Ctrl+K).',
  'Un modèle relance en un clic une session type : même dossier, groupe, modèle Claude, mode, worktree et premier prompt.': 'A template relaunches a typical session in one click: same folder, group, Claude model, mode, worktree and first prompt.',
  'Créer depuis la session active': 'Create from active session', 'Nouvelle session…': 'New session…', '— aucun modèle : « Enregistrer comme modèle » en bas —': '— no templates: use “Save as template” below —',
  // verrouillage
  'Session verrouillée. Elle continue de tourner ; son contenu est masqué.': 'Session locked. It keeps running; its content is hidden.',
  'Mot de passe': 'Password', 'Déverrouiller': 'Unlock', 'Indice': 'Hint', 'Mot de passe incorrect': 'Wrong password', 'Session verrouillée': 'Session locked',
  '4 caractères minimum.': 'At least 4 characters.', 'Les deux mots de passe ne correspondent pas.': 'The two passwords do not match.',
  'Changer le mot de passe': 'Change password', 'Verrouiller': 'Lock', 'Retirer le mot de passe': 'Remove password', 'Mot de passe retiré': 'Password removed',
  'Verrouiller par mot de passe…': 'Lock with a password…', 'Verrouiller maintenant': 'Lock now', 'Changer le mot de passe…': 'Change password…', 'Retirer le mot de passe…': 'Remove password…',
  'Mot de passe actuel': 'Current password', 'Confirmer le mot de passe': 'Confirm password', "Indice (facultatif, visible sur l'écran de verrouillage)": 'Hint (optional, shown on the lock screen)',
  "Le contenu de la session est masqué et sa saisie bloquée tant qu'elle n'est pas déverrouillée. Elle continue de tourner. Attention : le mot de passe ne peut pas être récupéré.": 'The session content is hidden and input is blocked until it is unlocked. It keeps running. Note: the password cannot be recovered.',
  'Sécurité': 'Security', 'Reverrouiller les sessions quand la fenêtre est réduite ou masquée': 'Lock sessions again when the window is minimized or hidden',
  'Reverrouiller après une inactivité de (minutes, 0 = jamais)': 'Lock again after inactivity of (minutes, 0 = never)',
  'mot de passe actuel incorrect': 'current password is wrong', 'mot de passe incorrect': 'wrong password', 'session verrouillée': 'session locked',
  // assistant
  'Bienvenue dans Claude Sessions 👋': 'Welcome to Claude Sessions 👋', 'Vérification de l’installation…': 'Checking your setup…',
  'Claude Code introuvable : installe-le (docs.claude.com/claude-code) puis relance l’application.': 'Claude Code not found: install it (docs.claude.com/claude-code) and restart the app.',
  'git introuvable : worktrees et panneau Modifications indisponibles (facultatif).': 'git not found: worktrees and the Changes panel are unavailable (optional).',
  'Fermer la fenêtre ne coupe rien : les sessions continuent et reviennent après un redémarrage.': 'Closing the window stops nothing: sessions keep running and come back after a reboot.',
  'Glisser une session sur un panneau (⊞ en haut) pour en suivre plusieurs à la fois.': 'Drag a session onto a pane (⊞ at the top) to follow several at once.',
  'Coche « worktree git » pour faire travailler plusieurs Claude sur le même dépôt sans conflit.': 'Tick “git worktree” to let several Claudes work on the same repository without conflicts.',
  'Premier dossier de travail': 'First working folder', 'Plus tard': 'Later', 'Créer ma première session': 'Create my first session',
  // palette
  'Historique des conversations': 'Conversation history', 'Rechercher dans toutes les sessions': 'Search all sessions', 'Envoyer à plusieurs sessions': 'Send to several sessions',
  'Bibliothèque de prompts': 'Prompt library', 'Panneau Modifications': 'Changes panel', 'Chronologie de la session': 'Session timeline',
  'Disposition : une session': 'Layout: single', 'Disposition : deux colonnes': 'Layout: two columns', 'Disposition : deux lignes': 'Layout: two rows', 'Disposition : grille 2×2': 'Layout: 2×2 grid',
  'Mode focus (masquer la barre latérale)': 'Focus mode (hide sidebar)', 'Thème : basculer clair / sombre': 'Theme: toggle light / dark',
  'Ouvrir dans l’éditeur': 'Open in editor', 'Ouvrir dans le Finder': 'Open in Finder', 'Ouvrir dans l’Explorateur': 'Open in Explorer', 'Ouvrir un terminal ici': 'Open a terminal here',
  'File d’attente de la session': 'Session queue', 'Exporter la conversation': 'Export conversation', 'Relancer la session': 'Restart session', 'Reprendre la session': 'Resume session',
  'Lancer le modèle': 'Launch template', 'Prompt': 'Prompt', 'session': 'session', 'sessions': 'sessions', 'modèle': 'template', 'prompt': 'prompt', 'action': 'action', 'conversation': 'conversation',
  'Aucun résultat': 'No results', 'Aucun résultat dans les terminaux ouverts.': 'No results in open terminals.', 'Insérer': 'Insert', 'Envoyer': 'Send',
  'Aucun prompt. « + Nouveau » pour en créer un (ex. « Relis les modifications et propose des tests »).': 'No prompts yet. Use “+ New” to create one (e.g. “Review the changes and suggest tests”).',
  'Supprimer ce prompt ?': 'Delete this prompt?', 'Envoyé à': 'Sent to', 'Aucune session active.': 'No running sessions.', 'Monter': 'Move up', 'Retirer': 'Remove', 'File vide.': 'Queue is empty.',
  'Session, conversation, action…': 'Session, conversation, action…', 'Rechercher dans les sessions': 'Search sessions', 'Texte à chercher dans tous les terminaux ouverts…': 'Text to find in all open terminals…',
  'Filtrer…': 'Filter…', '+ Nouveau': '+ New', 'Titre': 'Title', 'Texte': 'Text', 'Étiquettes': 'Tags', 'Enregistrer': 'Save', 'Variables :': 'Variables:',
  'File d’attente —': 'Queue —', 'Chaque prompt est envoyé automatiquement quand la session a fini le précédent.': 'Each prompt is sent automatically when the session has finished the previous one.',
  'Nouveau prompt à mettre en file…': 'New prompt to queue…', 'Ajouter': 'Add', 'Prompt à envoyer…': 'Prompt to send…',
  "Mettre en file d'attente si la session travaille (sinon envoi immédiat)": 'Queue it if the session is busy (otherwise send now)',
  // historique / import / divers
  'Filtrer (titre, dossier, prompt)…': 'Filter (title, folder, prompt)…', 'ouverte': 'open', 'Ramener dans csm': 'Bring into csm',
  'Ta conversation n\'est': 'Your conversation is', 'pas perdue': 'not lost', ': elle reprend dans csm exactement là où elle en est (historique, contexte, dossier).': ': it resumes in csm exactly where it is (history, context, folder).',
  'Déplacer': 'Move', 'Copier': 'Copy', 'La session passe dans csm. Dans le terminal, Claude s\'arrête : tu peux fermer cet onglet.': 'The session moves into csm. In the terminal, Claude stops: you can close that tab.',
  'Le terminal continue normalement. csm ouvre une copie de la conversation, qui évolue ensuite séparément.': 'The terminal keeps going. csm opens a copy of the conversation, which then evolves separately.',
  'Ajouté — il sera envoyé avec ton message': 'Attached — it will be sent with your message', 'Plus d\'actions': 'More actions',
  'Palette de commandes': 'Command palette', 'Connexion au serveur': 'Server connection', 'Fichiers modifiés par la session (Ctrl+Alt+G)': 'Files changed by the session (Ctrl+Alt+G)',
  'Ouvrir le dossier dans…': 'Open the folder in…', 'Relancer / reprendre la conversation': 'Restart / resume the conversation', 'Fermer et retirer de la liste': 'Close and remove from the list',
  'Une session': 'Single', 'Deux colonnes': 'Two columns', 'Deux lignes': 'Two rows', 'Grille 2×2': '2×2 grid', 'Fermer le panneau': 'Close panel',
  'Double-clic pour renommer': 'Double-click to rename', 'Choisir un dossier': 'Choose a folder', 'Prompts en attente': 'Queued prompts',
  'Joindre une image ou un fichier (ou glisser-déposer / coller dans le terminal)': 'Attach an image or file (or drag & drop / paste into the terminal)',
  'Reprendre une ancienne session (Ctrl+Alt+H)': 'Resume a past session (Ctrl+Alt+H)', 'Réglages (Ctrl+,)': 'Settings (Ctrl+,)', 'Nouvelle session (Ctrl+Alt+N)': 'New session (Ctrl+Alt+N)',
  'Ferme ces sessions dans leur terminal et les reprend ici': 'Closes these sessions in their terminal and resumes them here', 'Renommer (Ctrl+Alt+R)': 'Rename (Ctrl+Alt+R)',
};

let LANG = 'fr';
try { LANG = localStorage.getItem('csm.lang') || (/^fr/i.test(navigator.language) ? 'fr' : 'en'); } catch { }
function setLang(pref) {
  const l = pref === 'fr' || pref === 'en' ? pref : (/^fr/i.test(navigator.language) ? 'fr' : 'en');
  if (l !== LANG) { LANG = l; try { localStorage.setItem('csm.lang', l); } catch { } location.reload(); return; }
  try { localStorage.setItem('csm.lang', l); } catch { }
}
function t(s) { return LANG === 'en' ? (EN[s] ?? EN[String(s).trim()] ?? s) : s; }

// Traduction des textes statiques (une fois, au chargement ; les boîtes de dialogue sont dans la page).
function translateDom(root = document.body) {
  if (LANG !== 'en') return;
  document.documentElement.lang = 'en';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const raw = n.nodeValue, k = raw.trim();
    if (k && EN[k] && !n.parentElement.closest('.xterm, pre, code')) n.nodeValue = raw.replace(k, EN[k]);
  }
  for (const el of root.querySelectorAll('[title],[placeholder],[aria-label]')) {
    for (const a of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute(a); if (v && EN[v.trim()]) el.setAttribute(a, EN[v.trim()]); }
  }
  for (const o of root.querySelectorAll('option')) if (EN[o.textContent.trim()]) o.textContent = EN[o.textContent.trim()];
}
document.addEventListener('DOMContentLoaded', () => translateDom());
