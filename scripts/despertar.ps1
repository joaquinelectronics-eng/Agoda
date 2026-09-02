# Hace que la compu se despierte sola para tomar cada muestra y despues la deja
# volver a dormirse. Se corre una vez.
#
#   powershell -ExecutionPolicy Bypass -File scripts\despertar.ps1
#
# Ojo: esto anda si SUSPENDES la maquina (o hiberna). Si la apagas del todo no
# hay forma de que se despierte sola.

$ErrorActionPreference = 'Stop'
$tarea = 'agoda'

Write-Host "Configurando la tarea '$tarea' para que despierte la maquina..." -ForegroundColor Cyan

$t = Get-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue
if (-not $t) {
  Write-Host @"
No encontre la tarea "$tarea".

Primero dejala instalada con:
  powershell -ExecutionPolicy Bypass -File scripts\instalar.ps1
"@ -ForegroundColor Red
  exit 1
}

$t.Settings.WakeToRun = $true
# Si a una hora la maquina estaba apagada, que tome esa muestra al volver en vez
# de esperar a la hora siguiente.
$t.Settings.StartWhenAvailable = $true
# Por defecto Windows no corre tareas con bateria, y una notebook desenchufada
# se saltearia todas las muestras sin decir nada.
$t.Settings.DisallowStartIfOnBatteries = $false
$t.Settings.StopIfGoingOnBatteries = $false
Set-ScheduledTask -InputObject $t | Out-Null
Write-Host "    tarea lista" -ForegroundColor Green

# No alcanza con la tarea: el plan de energia tiene que permitir los
# despertadores, o Windows los ignora en silencio.
Write-Host "Permitiendo los temporizadores de reactivacion en el plan de energia..."
& powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
& powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
& powercfg /setactive SCHEME_CURRENT
if ($LASTEXITCODE -ne 0) {
  Write-Host "    no pude tocar el plan de energia; proba esta ventana como administrador" -ForegroundColor Yellow
} else {
  Write-Host "    plan de energia listo" -ForegroundColor Green
}

Write-Host "`nDespertadores activos ahora:" -ForegroundColor Cyan
& powercfg /waketimers

Write-Host @"

Listo. De aca en mas:

  - Suspende la compu en vez de apagarla (Inicio -> Apagar -> Suspender).
  - Se va a despertar a cada hora de 11 a 23, tomar la muestra y volver a dormirse.
  - Si la apagas del todo, esas horas se pierden: desde apagada no se despierta.
  - Una notebook con muy poca bateria tampoco se despierta; dejala enchufada.

  Para ver si esta funcionando:  node bin/agoda.mjs estado
  El registro de cada corrida:   type data\agoda.log
"@ -ForegroundColor Green
