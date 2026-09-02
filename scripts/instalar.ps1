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

Paso "1/4" "Dependencias (esto tarda unos minutos)"
npm install --silent
if ($LASTEXITCODE -ne 0) { Write-Host "Fallo npm install" -ForegroundColor Red; exit 1 }

# Ojo: en PowerShell un comando externo que falla NO lanza excepcion, asi que
# un try/catch aca daria siempre por bueno el navegador y nunca lo bajaria.
# Hay que mirar el codigo de salida.
Write-Host "    Buscando el navegador..."
& node -e "require('playwright-core').chromium.executablePath()" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "    No esta; bajandolo (~150 MB, puede tardar varios minutos)"
  # Ojo: nada de npx. En PowerShell npx es un .ps1 y la politica de scripts que
  # trae Windows de fabrica lo bloquea. El cli de playwright-core se invoca
  # directo con node, y ademas usa la version exacta que pide el proyecto.
  & node node_modules\playwright-core\cli.js install chromium
  if ($LASTEXITCODE -ne 0) { Write-Host "Fallo la descarga del navegador" -ForegroundColor Red; exit 1 }
} else {
  Write-Host "    Ya estaba"
}

Paso "2/4" "Recuperando las muestras ya guardadas"
& node bin/agoda.mjs sincronizar

# --- 3 y 4. El comando de cada hora y la tarea -----------------------------
Paso "3/4" "Preparando y registrando la tarea (11 a 23, cada hora)"
# Todo esto vive en tarea.ps1, que tambien sirve para rehacer la tarea sola sin
# volver a pasar por la instalacion entera.
& (Join-Path $PSScriptRoot 'tarea.ps1')
if ($LASTEXITCODE -ne 0) { Write-Host "No pude registrar la tarea" -ForegroundColor Red; exit 1 }

Paso "4/4" "Primera muestra, para verificar que anda"
$env:AGODA_TZ = 'America/Argentina/Buenos_Aires'
& node bin/agoda.mjs buscar "Buenos Aires" --moneda USD --paginas todas --silencioso --serie datos --pestanas 2026-09-04 --html reportes\hoy.html

# Si la muestra de prueba fallo, la instalacion NO esta lista: decirlo, en vez de
# cerrar con un "Listo" en verde que no es cierto.
if ($LASTEXITCODE -ne 0) {
  Write-Host @"

La instalacion quedo a medias: la tarea quedo registrada pero la muestra de
prueba fallo, asi que cada corrida va a fallar igual. Mira el error de arriba.

Si dice que falta Chromium:   node node_modules\playwright-core\cli.js install chromium
y despues volve a correr este script.
"@ -ForegroundColor Red
  exit 1
}

Write-Host @"

Listo. De aca en mas se actualiza solo, cada hora de 11 a 23.

  La pagina:     $raiz\reportes\hoy.html   (las dos noches, una en cada solapa)
  Como va:       node bin/agoda.mjs estado
  Ver la tarea:  schtasks /query /tn agoda
  Para pararlo:  schtasks /delete /tn agoda /f

Si no queres tener la compu prendida toda la franja, corre ademas:

  powershell -ExecutionPolicy Bypass -File scripts\despertar.ps1

y suspendela en vez de apagarla: se despierta sola a cada hora, toma la muestra
y vuelve a dormirse.

Si la computadora esta apagada a una hora, esa muestra se pierde y sigue con la
siguiente.
"@ -ForegroundColor Green
