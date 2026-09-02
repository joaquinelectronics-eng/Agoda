# Hace que la compu se despierte sola para tomar cada muestra y despues la deja
# volver a dormirse. Se corre una vez.
#
#   powershell -ExecutionPolicy Bypass -File scripts\despertar.ps1
#
# Anda igual si la SUSPENDES o si la HIBERNAS: el despertador se arma en los dos
# casos. Lo que no despierta es apagada, y ojo que con Inicio rapido "Apagar"
# parece hibernar (tambien escribe el archivo de hibernacion) pero Windows no
# arma ningun despertador. Tiene que ser Hibernar de verdad.

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

# Cuando la maquina se despierta sola y no hay nadie tocandola, Windows la vuelve
# a dormir a los 2 minutos (el "tiempo de espera de suspension desatendida"). La
# muestra tarda mas que eso: sin subirlo, se dormiria a mitad del scrapeo y en el
# registro quedaria una corrida cortada sin explicacion.
Write-Host "Dandole tiempo a la muestra antes de volver a dormirse (10 min)..."
& powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP UNATTENDSLEEP 600
& powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP UNATTENDSLEEP 600
& powercfg /setactive SCHEME_CURRENT
if ($LASTEXITCODE -ne 0) {
  Write-Host "    no pude cambiarlo; proba esta ventana como administrador" -ForegroundColor Yellow
} else {
  Write-Host "    listo: se despierta, toma la muestra y a los 10 min se vuelve a dormir" -ForegroundColor Green
}

# Que hibernar este disponible: si el equipo no lo tiene habilitado, "Hibernar"
# ni siquiera aparece y estarias apagando sin querer.
$estados = (& powercfg /a) -join "`n"
if ($estados -notmatch 'Hiberna') {
  Write-Host "`n! Este equipo no tiene la hibernacion habilitada." -ForegroundColor Yellow
  Write-Host "  Habilitala (como administrador) con:  powercfg /hibernate on"
}

Write-Host "`nDespertadores activos ahora:" -ForegroundColor Cyan
& powercfg /waketimers

Write-Host @"

Listo. De aca en mas:

  - Hiberna o suspende la compu, pero NO la apagues (Inicio -> Apagar -> Hibernar).
  - Se va a despertar a cada hora de 11 a 23, tomar la muestra y volver a dormirse.
  - Ojo con Inicio rapido: "Apagar" parece hibernar pero no deja despertador armado.
    Desde apagada esas horas se pierden.
  - Una notebook con muy poca bateria tampoco se despierta; dejala enchufada.

  Para confirmar que la desperto el, despues de la primera vez:
    powercfg /lastwake     (tiene que decir temporizador / RTC)

  Para ver si esta funcionando:  node bin/agoda.mjs estado
  El registro de cada corrida:   type data\agoda.log
"@ -ForegroundColor Green
