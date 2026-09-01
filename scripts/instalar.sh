#!/usr/bin/env bash
# Deja el seguimiento de precios andando solo en esta maquina.
# Se corre una vez; despues no hay que tocar nada mas.
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"

echo "==> 1/4  Dependencias"
npm install --silent
if ! node -e "require('playwright-core').chromium.executablePath()" >/dev/null 2>&1; then
  npx --yes playwright install chromium
fi

echo "==> 2/4  Recuperando las muestras ya guardadas"
node bin/agoda.mjs sincronizar

echo "==> 3/4  Programando las tareas (11 a 23, cada hora)"
COMUNES=(--moneda USD --tipo depto,casa --zona nunez,belgrano,palermo,recoleta
         --cada 60 --desde-hora 11 --hasta-hora 23 --instalar)
node bin/agoda.mjs programar "Buenos Aires" --nombre hoy "${COMUNES[@]}"
node bin/agoda.mjs programar "Buenos Aires" --nombre viernes --noche 2026-09-04 "${COMUNES[@]}"

echo "==> 4/4  Primera muestra, para verificar que anda"
node bin/agoda.mjs buscar "Buenos Aires" --moneda USD --paginas todas --silencioso \
  --serie datos --html reportes/hoy.html

cat <<FIN

Listo. De acá en más se actualiza solo, cada hora de 11 a 23.

  La página:     $RAIZ/reportes/hoy.html
  Cómo va:       node bin/agoda.mjs estado
  Para pararlo:  node bin/agoda.mjs programar --quitar --todo

En macOS, cron necesita Acceso Total al Disco para tu terminal
(Ajustes -> Privacidad y seguridad -> Acceso total al disco).
FIN
