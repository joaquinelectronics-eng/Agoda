# Registra (o rehace) la tarea horaria en el Programador de tareas de Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\tarea.ps1
#
# Por que no se usa schtasks.exe: al pasarle el path entre comillas, PowerShell
# vuelve a citar el argumento y schtasks termina guardando la accion sin comillas.
# Con un usuario como "acer nitro" eso deja la tarea intentando ejecutar
# C:\Users\acer y fallando con 0x80070002 (no se encuentra el archivo) a cada
# hora, sin dejar rastro en el registro. Register-ScheduledTask recibe el
# programa como un campo aparte y no tiene ese problema.

param(
  [string]$Noche = '2026-09-04',
  [int]$Desde = 11,
  [int]$Hasta = 23,
  [string]$Tarea = 'agoda'
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host "Falta Node.js." -ForegroundColor Red; exit 1 }

# --- El comando de cada hora ------------------------------------------------
# Las dos noches, una atras de la otra; la de hoy va segunda y arma la pagina con
# las dos solapas, asi queda todo en un archivo y de la misma hora.
$filtros = '--moneda USD --tipo depto,casa --zona nunez,belgrano,palermo,recoleta --paginas todas --silencioso --serie datos'
$cmd = Join-Path $raiz 'scripts\muestra.cmd'
@"
@echo off
cd /d "$raiz"
set AGODA_TZ=America/Argentina/Buenos_Aires
"$node" bin\agoda.mjs buscar "Buenos Aires" $filtros --noche $Noche >> data\agoda.log 2>&1
"$node" bin\agoda.mjs buscar "Buenos Aires" $filtros --noche hoy --pestanas $Noche --html "reportes\hoy.html" >> data\agoda.log 2>&1
"@ | Set-Content -Path $cmd -Encoding ASCII
Write-Host "Comando:  $cmd"

# --- La tarea ---------------------------------------------------------------
$hora = Get-Date -Hour $Desde -Minute 0 -Second 0
$accion = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $raiz

# Un disparador diario no tiene repeticion propia: se le copia la de uno "una
# vez" que repite cada hora durante la franja.
$disparador = New-ScheduledTaskTrigger -Daily -At $hora
$disparador.Repetition = (New-ScheduledTaskTrigger -Once -At $hora `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration (New-TimeSpan -Hours ($Hasta - $Desde))).Repetition

$ajustes = New-ScheduledTaskSettingsSet `
  -WakeToRun `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

# Las versiones viejas dejaban dos tareas separadas.
foreach ($v in @('agoda-hoy', 'agoda-viernes')) {
  Unregister-ScheduledTask -TaskName $v -Confirm:$false -ErrorAction SilentlyContinue
}
foreach ($v in @('muestra-hoy.cmd', 'muestra-viernes.cmd')) {
  Remove-Item -Path (Join-Path $raiz "scripts\$v") -ErrorAction SilentlyContinue
}

Register-ScheduledTask -TaskName $Tarea -Action $accion -Trigger $disparador `
  -Settings $ajustes -Description "Muestra de precios de Agoda, cada hora" -Force | Out-Null

Write-Host "Tarea '$Tarea': todos los dias, cada hora de ${Desde}:00 a ${Hasta}:00" -ForegroundColor Green

# --- Verificacion: que la accion quedo bien ---------------------------------
$a = (Get-ScheduledTask -TaskName $Tarea).Actions[0]
Write-Host "`n  Ejecuta:    $($a.Execute)"
if ($a.Arguments) { Write-Host "  Argumentos: $($a.Arguments)" }
if (-not (Test-Path $a.Execute)) {
  Write-Host "  ! Ese archivo no existe: la tarea va a fallar con 0x80070002" -ForegroundColor Red
  exit 1
}
Write-Host "  El archivo existe." -ForegroundColor Green

Write-Host @"

Probala ahora mismo (tarda unos minutos):

  Start-ScheduledTask -TaskName $Tarea
  Get-ScheduledTaskInfo -TaskName $Tarea    # LastTaskResult 0 = salio bien
  type data\agoda.log                       # una linea por noche

"@ -ForegroundColor Cyan
