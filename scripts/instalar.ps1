# Deja el seguimiento de precios andando solo en esta computadora (Windows).
# Se corre una vez. Despues no hay que tocar nada.
#
#   powershell -ExecutionPolicy Bypass -File scripts\instalar.ps1

$ErrorActionPreference = 'Stop'
Write-Host "Instalando el seguimiento de precios de Agoda..." -ForegroundColor Cyan
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz

function Paso($n, $texto) { Write-Host "`n==> $n  $texto" -ForegroundColor Cyan }

# --- 0. Node ---------------------------------------------------------------
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host "Falta Node.js. Bajalo de https://nodejs.org (version 22 o mas nueva)," -ForegroundColor Red
  Write-Host "instalalo, cerra esta ventana y volve a correr este script." -ForegroundColor Red
  exit 1
}
$version = (& node -e "console.log(process.versions.node.split('.')[0])")
if ([int]$version -lt 22) {
  Write-Host "Tenes Node $version y hacen falta 22 o mas. Actualizalo desde https://nodejs.org" -ForegroundColor Red
  exit 1
}

Paso "1/5" "Dependencias (esto tarda unos minutos)"
npm install --silent
if ($LASTEXITCODE -ne 0) { Write-Host "Fallo npm install" -ForegroundColor Red; exit 1 }

# Ojo: en PowerShell un comando externo que falla NO lanza excepcion, asi que
# un try/catch aca daria siempre por bueno el navegador y nunca lo bajaria.
# Hay que mirar el codigo de salida.
Write-Host "    Buscando el navegador..."
& node -e "require('playwright-core').chromium.executablePath()" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "    No esta; bajandolo (~150 MB, puede tardar varios minutos)"
  npx --yes playwright install chromium
  if ($LASTEXITCODE -ne 0) { Write-Host "Fallo la descarga del navegador" -ForegroundColor Red; exit 1 }
} else {
  Write-Host "    Ya estaba"
}

Paso "2/5" "Recuperando las muestras ya guardadas"
& node bin/agoda.mjs sincronizar

# --- 3. Los dos comandos que va a correr el programador --------------------
Paso "3/5" "Preparando las tareas"
$filtros = '--moneda USD --tipo depto,casa --zona nunez,belgrano,palermo,recoleta --paginas todas --silencioso --serie datos'

# El Programador de tareas de Windows se lleva mal con las comillas, asi que
# cada tarea llama a un .cmd en vez de a una linea larga.
$tareas = @(
  @{ nombre = 'agoda-hoy';     archivo = 'muestra-hoy.cmd';     extra = '--noche hoy';        html = 'reportes\hoy.html' },
  @{ nombre = 'agoda-viernes'; archivo = 'muestra-viernes.cmd'; extra = '--noche 2026-09-04'; html = 'reportes\viernes.html' }
)

foreach ($t in $tareas) {
  $ruta = Join-Path $raiz "scripts\$($t.archivo)"
  @"
@echo off
cd /d "$raiz"
set AGODA_TZ=America/Argentina/Buenos_Aires
"$node" bin\agoda.mjs buscar "Buenos Aires" $filtros $($t.extra) --html "$($t.html)" >> data\agoda.log 2>&1
"@ | Set-Content -Path $ruta -Encoding ASCII
  Write-Host "    $ruta"
}

Paso "4/5" "Registrando en el Programador de tareas (11 a 23, cada hora)"
foreach ($t in $tareas) {
  $ruta = Join-Path $raiz "scripts\$($t.archivo)"
  # /ri 60 /du 12:00 desde las 11:00 => corre 11, 12, ... 23
  schtasks /create /tn $t.nombre /tr "`"$ruta`"" /sc DAILY /st 11:00 /ri 60 /du 12:00 /f | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "    No pude registrar $($t.nombre)" -ForegroundColor Red }
  else { Write-Host "    $($t.nombre): todos los dias, cada hora de 11 a 23" -ForegroundColor Green }
}

Paso "5/5" "Primera muestra, para verificar que anda"
$env:AGODA_TZ = 'America/Argentina/Buenos_Aires'
& node bin/agoda.mjs buscar "Buenos Aires" --moneda USD --paginas todas --silencioso --serie datos --html reportes\hoy.html

Write-Host @"

Listo. De aca en mas se actualiza solo, cada hora de 11 a 23.

  La pagina:     $raiz\reportes\hoy.html
  Como va:       node bin/agoda.mjs estado
  Ver las tareas: schtasks /query /tn agoda-hoy
  Para pararlo:  schtasks /delete /tn agoda-hoy /f
                 schtasks /delete /tn agoda-viernes /f

La computadora tiene que estar prendida en esa franja. Si esta apagada o
suspendida a una hora, esa muestra se pierde y sigue con la siguiente.
"@ -ForegroundColor Green
