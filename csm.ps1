# csm — Claude Sessions Manager
#   csm            démarre le serveur (si besoin) et ouvre la fenêtre
#   csm install    démarrage auto à l'ouverture de session Windows + raccourci menu Démarrer
#   csm uninstall  retire la tâche planifiée et le raccourci
#   csm stop       arrête le serveur (les sessions ouvertes seront restaurées au prochain démarrage)
#   csm restart | status | log
param([string]$Cmd = 'open')
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Port = if ($env:CSM_PORT) { $env:CSM_PORT } else { 7890 }
$Url = "http://127.0.0.1:$Port/"
$Data = Join-Path $Root 'data'
$PidFile = Join-Path $Data 'server.pid'
$Log = Join-Path $Data 'server.log'
$TaskName = 'Claude Sessions Manager'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Claude Sessions.lnk'

function Test-Up { try { $null = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 1; $true } catch { $false } }

# Lancement sans console, détaché de tout terminal : fermer le terminal ne tue pas le serveur.
function Get-ServerCommand {
  $node = (Get-Command node).Source
  @{ Exe = "$env:WINDIR\System32\conhost.exe"; Args = "--headless `"$node`" `"$Root\server.js`"" }
}

function Wait-Up { for ($i = 0; $i -lt 40; $i++) { if (Test-Up) { return $true }; Start-Sleep -Milliseconds 250 }; $false }

function Start-Server {
  if (Test-Up) { return }
  New-Item -ItemType Directory -Force $Data | Out-Null
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Start-ScheduledTask -TaskName $TaskName   # hors de l'arbre de processus du terminal
  } else {
    $c = Get-ServerCommand
    Start-Process -FilePath $c.Exe -ArgumentList $c.Args -WorkingDirectory $Root -WindowStyle Hidden
  }
  if (-not (Wait-Up)) { throw "Le serveur n'a pas démarré. Voir : csm log" }
}

function Stop-Server {
  if (Test-Path $PidFile) {
    $id = [int](Get-Content $PidFile)
    try { Stop-Process -Id $id -Force -ErrorAction Stop; 'serveur arrêté' } catch { 'serveur déjà arrêté' }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
  } else { 'serveur non démarré' }
}

function Get-Edge {
  @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Open-Window {
  $edge = Get-Edge
  if ($edge) { Start-Process $edge "--app=$Url --window-size=1400,900" } else { Start-Process $Url }
}

function Install-Csm {
  $c = Get-ServerCommand
  $action = New-ScheduledTaskAction -Execute $c.Exe -Argument $c.Args -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  "tâche planifiée « $TaskName » : démarrage à l'ouverture de session"

  $pwsh = (Get-Command pwsh).Source
  $sh = (New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
  $sh.TargetPath = "$env:WINDIR\System32\conhost.exe"
  $sh.Arguments = "--headless `"$pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" open"
  $sh.WorkingDirectory = $Root
  $ico = Join-Path $Root 'public\icon.ico'
  $sh.IconLocation = if (Test-Path $ico) { $ico } elseif ($e = Get-Edge) { "$e,0" } else { '' }
  $sh.Description = 'Claude Sessions Manager'
  $sh.Save()
  "raccourci : menu Démarrer > Claude Sessions (épinglable à la barre des tâches)"
}

function Uninstall-Csm {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item $Shortcut -ErrorAction SilentlyContinue
  'tâche et raccourci supprimés'
}

switch ($Cmd) {
  'open'      { Start-Server; Open-Window }
  'start'     { Start-Server; "serveur prêt : $Url" }
  'stop'      { Stop-Server }
  'restart'   { Stop-Server; Start-Sleep -Milliseconds 500; Start-Server; "serveur prêt : $Url" }
  'status'    { if (Test-Up) { "en ligne : $Url" } else { 'arrêté' } }
  'log'       { Get-Content $Log -Tail 60 -ErrorAction SilentlyContinue }
  'install'   { Install-Csm; Start-Server; "serveur prêt : $Url" }
  'uninstall' { Uninstall-Csm }
  default     { Get-Content $PSCommandPath -TotalCount 6 }
}
