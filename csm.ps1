# csm — Claude Sessions Manager
#   csm            démarre le serveur (si besoin) et ouvre la fenêtre
#   csm stop       arrête le serveur (et toutes les sessions)
#   csm restart    redémarre le serveur
#   csm status     état du serveur
#   csm log        affiche le journal du serveur
param([string]$Cmd = 'open')
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Port = if ($env:CSM_PORT) { $env:CSM_PORT } else { 7890 }
$Url = "http://127.0.0.1:$Port/"
$PidFile = Join-Path $Root 'data\server.pid'
$Log = Join-Path $Root 'data\server.log'

function Test-Up { try { $null = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 1; $true } catch { $false } }

function Start-Server {
  if (Test-Up) { return }
  New-Item -ItemType Directory -Force (Join-Path $Root 'data') | Out-Null
  $node = (Get-Command node).Source
  Start-Process -FilePath $node -ArgumentList "`"$Root\server.js`"" -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
  for ($i = 0; $i -lt 50 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Up)) { Write-Error "Le serveur n'a pas démarré. Voir $Log.err" }
}

function Stop-Server {
  if (Test-Path $PidFile) {
    $id = [int](Get-Content $PidFile)
    try { Stop-Process -Id $id -Force -ErrorAction Stop; 'serveur arrêté' } catch { 'serveur déjà arrêté' }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
  } else { 'serveur non démarré' }
}

function Open-Window {
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edge) { Start-Process $edge "--app=$Url --window-size=1400,900" } else { Start-Process $Url }
}

switch ($Cmd) {
  'open'    { Start-Server; Open-Window }
  'start'   { Start-Server; "serveur prêt : $Url" }
  'stop'    { Stop-Server }
  'restart' { Stop-Server; Start-Sleep -Milliseconds 400; Start-Server; "serveur prêt : $Url" }
  'status'  { if (Test-Up) { "en ligne : $Url" } else { 'arrêté' } }
  'log'     { Get-Content $Log, "$Log.err" -Tail 60 -ErrorAction SilentlyContinue }
  default   { Get-Content $PSCommandPath -TotalCount 7 }
}
