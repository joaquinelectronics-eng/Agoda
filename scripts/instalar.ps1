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
  # Ojo: nada de npx. En PowerShell npx es un .ps1 y la politica de scripts que
  # trae Windows de fabrica lo bloquea. El cli de playwright-core se invoca
  # directo con node, y ademas usa la version exacta que pide el proyecto.
  & node node_modules\playwright-core\cli.js install chromium
  if ($LASTEXITCODE -ne 0) { Write-Host "Fallo la descarga del navegador" -ForegroundColor Red; exit 1 }
} else {
  Write-Host "    Ya estaba"
}

Paso "2/5" "Recuperando las muestras ya guardadas"
& node bin/agoda.mjs sincronizar

# --- 3. El comando que va a correr el programador --------------------------
Paso "3/5" "Preparando la tarea"
$filtros = '--moneda USD --tipo depto,casa --zona nunez,belgrano,palermo,recoleta --paginas todas --silencioso --serie datos'

# El Programador de tareas de Windows se lleva mal con las comillas, asi que la
# tarea llama a un .cmd en vez de a una linea larga.
#
# Una sola tarea con las dos noches, una atras de la otra: la de hoy va segunda y
# arma la pagina con las dos solapas, asi queda todo en un archivo y con los dos
# precios de la misma hora. Con dos tareas separadas se pisaban entre ellas.
$cmd = Join-Path $raiz 'scripts\muestra.cmd'
@"
@echo off
cd /d "$raiz"
set AGODA_TZ=America/Argentina/Buenos_Aires
"$node" bin\agoda.mjs buscar "Buenos Aires" $filtros --noche 2026-09-04 >> data\agoda.log 2>&1
"$node" bin\agoda.mjs buscar "Buenos Aires" $filtros --noche hoy --pestanas 2026-09-04 --html "reportes\hoy.html" >> data\agoda.log 2>&1
"@ | Set-Content -Path $cmd -Encoding ASCII
Write-Host "    $cmd"

Paso "4/5" "Registrando en el Programador de tareas (11 a 23, cada hora)"
# Las versiones viejas dejaban dos tareas separadas; si estan, sacarlas.
foreach ($viejo in @('agoda-hoy', 'agoda-viernes')) {
  schtasks /query /tn $viejo 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    schtasks /delete /tn $viejo /f | Out-Null
    Write-Host "    saque la tarea vieja $viejo"
  }
}
foreach ($v in @('muestra-hoy.cmd', 'muestra-viernes.cmd')) {
  Remove-Item -Path (Join-Path $raiz "scripts\$v") -ErrorAction SilentlyContinue
}

# /ri 60 /du 12:00 desde las 11:00 => corre 11, 12, ... 23
schtasks /create /tn agoda /tr "`"$cmd`"" /sc DAILY /st 11:00 /ri 60 /du 12:00 /f | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "    No pude registrar la tarea" -ForegroundColor Red; exit 1 }
Write-Host "    agoda: todos los dias, cada hora de 11 a 23" -ForegroundColor Green

Paso "5/5" "Primera muestra, para verificar que anda"
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
