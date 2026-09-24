# Ouvre le sélecteur de dossier natif Windows et écrit le chemin choisi sur stdout (rien si annulé).
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

$dlg = [System.Windows.Forms.FolderBrowserDialog]::new()
$dlg.Description = 'Dossier de travail de la session Claude'
$dlg.UseDescriptionForTitle = $true
$dlg.ShowNewFolderButton = $true
if ($env:CSM_INITIAL -and (Test-Path -LiteralPath $env:CSM_INITIAL)) { $dlg.InitialDirectory = $env:CSM_INITIAL }

# Fenêtre propriétaire invisible au premier plan : sinon le dialogue s'ouvre derrière Edge (serveur sans fenêtre).
$owner = [System.Windows.Forms.Form]::new()
$owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'; $owner.Size = [Drawing.Size]::new(1, 1)
$owner.Show(); $owner.Activate()
try {
  if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.SelectedPath) }
} finally { $owner.Close() }
