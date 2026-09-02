#!/usr/bin/env bash
# Deja el seguimiento de precios andando solo en esta maquina.
# Se corre una vez; despues no hay que tocar nada mas.
#
#   ./scripts/instalar.sh          en tu compu
#   ./scripts/instalar.sh --web    en un servidor: ademas deja la pagina servida
#
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"

ZONA="${AGODA_TZ:-America/Argentina/Buenos_Aires}"
NOCHE_FIJA="${AGODA_NOCHE_FIJA:-2026-09-04}"
PUERTO="${AGODA_PUERTO:-8080}"
WEB=no
for arg in "$@"; do
  case "$arg" in
    --web) WEB=si ;;
    *) echo "Opcion que no conozco: $arg" >&2; exit 1 ;;
  esac
done

# En un servidor entras como root; en tu compu, no. Los pasos que tocan el
# sistema (zona horaria, librerias del navegador, systemd) se saltean solos si
# no hay forma de escalar, en vez de reventar la instalacion entera.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else SUDO="no-se-puede"; fi
fi
puede_root() { [ "$SUDO" != "no-se-puede" ]; }

# --- 0. Node ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  cat >&2 <<'FIN'
Falta Node.js (hace falta la 22 o mas nueva).

En Ubuntu/Debian:
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs

Despues volve a correr este script.
FIN
  exit 1
fi
MAYOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$MAYOR" -lt 22 ]; then
  echo "Tenes Node $MAYOR y hacen falta 22 o mas. Actualizalo (ver https://nodejs.org)." >&2
  exit 1
fi

# Chromium no entra comodo en 1 GB. Sin swap, la muestra se muere a mitad de
# camino y en el registro queda un error que no dice "me quede sin memoria".
MEM_MB="$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)"
SWAP_MB="$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' || echo 0)"
if [ "${MEM_MB:-0}" -gt 0 ] && [ "${MEM_MB:-0}" -lt 1800 ] && [ "${SWAP_MB:-0}" -lt 512 ]; then
  echo "! Esta maquina tiene ${MEM_MB} MB de RAM y casi nada de swap: Chromium se"
  echo "  puede quedar sin memoria. Conviene agregarle swap antes:"
  echo "    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile"
  echo "    sudo mkswap /swapfile && sudo swapon /swapfile"
  echo "    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
  echo
fi

# Cron: hay imagenes de servidor que vienen sin el. Mejor darse cuenta ahora que
# a mitad de la instalacion.
if ! command -v crontab >/dev/null 2>&1; then
  if puede_root && command -v apt-get >/dev/null 2>&1; then
    echo "==> 0/6  Instalando cron"
    $SUDO apt-get update -qq && $SUDO apt-get install -y -qq cron
    $SUDO systemctl enable --now cron >/dev/null 2>&1 || true
  else
    echo "Falta cron, que es lo que dispara las muestras a cada hora." >&2
    echo "  En Ubuntu/Debian:  sudo apt-get install -y cron" >&2
    exit 1
  fi
fi

# --- 1. Zona horaria -------------------------------------------------------
# cron dispara con la hora de la maquina, y un servidor recien hecho viene en
# UTC: sin esto, "de 11 a 23" terminaria siendo de 8 a 20 hora de Buenos Aires.
echo "==> 1/6  Zona horaria"
ACTUAL="$(date +%Z)"
if command -v timedatectl >/dev/null 2>&1 && puede_root &&
   $SUDO timedatectl set-timezone "$ZONA" >/dev/null 2>&1; then
  echo "    $ZONA (antes: $ACTUAL)"
else
  # Puede fallar por permisos o porque no hay systemd corriendo (un contenedor).
  echo "    no la pude cambiar; la maquina esta en $ACTUAL"
  echo "    si no es la tuya:  sudo timedatectl set-timezone $ZONA"
fi

echo "==> 2/6  Dependencias"
npm install --silent

if ! node -e "require('playwright-core').chromium.executablePath()" >/dev/null 2>&1; then
  # --with-deps instala tambien las librerias del sistema que pide Chromium. En
  # un servidor pelado no estan, y sin ellas el navegador arranca y se muere.
  if puede_root; then
    $SUDO env "PATH=$PATH" node node_modules/playwright-core/cli.js install --with-deps chromium
  else
    node node_modules/playwright-core/cli.js install chromium
    echo "    ! Sin permisos para instalar las librerias del sistema."
    echo "      Si el navegador no arranca:  sudo node node_modules/playwright-core/cli.js install --with-deps chromium"
  fi
fi

echo "==> 3/6  Recuperando las muestras ya guardadas"
node bin/agoda.mjs sincronizar

echo "==> 4/6  Programando las tareas (11 a 23, cada hora)"
COMUNES=(--moneda USD --tipo depto,casa --zona nunez,belgrano,palermo,recoleta
         --serie datos --cada 60 --desde-hora 11 --hasta-hora 23 --instalar)
# La de hoy lleva la del viernes como solapa: las dos noches en un solo archivo.
AGODA_TZ="$ZONA" node bin/agoda.mjs programar "Buenos Aires" --nombre hoy --pestanas "$NOCHE_FIJA" "${COMUNES[@]}"
AGODA_TZ="$ZONA" node bin/agoda.mjs programar "Buenos Aires" --nombre viernes --noche "$NOCHE_FIJA" "${COMUNES[@]}"

echo "==> 5/6  Primera muestra, para verificar que anda"
AGODA_TZ="$ZONA" node bin/agoda.mjs buscar "Buenos Aires" --moneda USD --paginas todas --silencioso \
  --serie datos --pestanas "$NOCHE_FIJA" --html reportes/hoy.html

echo "==> 6/6  La pagina"
if [ "$WEB" = no ]; then
  echo "    la abris en $RAIZ/reportes/hoy.html"
  echo "    (en un servidor conviene --web, que la deja servida por HTTP)"
elif ! command -v systemctl >/dev/null 2>&1 || ! puede_root; then
  echo "    ! No puedo dejar el servicio andando solo (falta systemd o permisos)."
  echo "      Levantala a mano con:  node bin/agoda.mjs servir --puerto $PUERTO"
else
  NODE="$(command -v node)"
  USUARIO="$(id -un)"
  $SUDO tee /etc/systemd/system/agoda-web.service >/dev/null <<FIN
[Unit]
Description=Pagina de precios de Agoda
After=network.target

[Service]
Type=simple
User=$USUARIO
WorkingDirectory=$RAIZ
ExecStart=$NODE $RAIZ/bin/agoda.mjs servir $RAIZ/reportes --puerto $PUERTO
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
FIN
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now agoda-web.service
  echo "    servicio agoda-web levantado en el puerto $PUERTO"

  # El firewall del sistema. El del proveedor (Oracle, AWS) es aparte.
  if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "^Status: active"; then
    $SUDO ufw allow "$PUERTO"/tcp >/dev/null && echo "    ufw: puerto $PUERTO abierto"
  fi
fi

echo
echo "Listo. De aca en mas se actualiza solo, cada hora de 11 a 23 ($ZONA)."
echo
echo "  Como va:       node bin/agoda.mjs estado"
echo "  Para pararlo:  node bin/agoda.mjs programar --quitar --todo"
if [ "$WEB" = si ]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "  La pagina:     http://${IP:-<la-ip-del-servidor>}:$PUERTO"
  echo "  El servicio:   systemctl status agoda-web"
  echo
  echo "  Si no abre, falta abrir el puerto $PUERTO en el firewall del proveedor"
  echo "  (Oracle: Security List de la VCN; AWS: Security Group)."
else
  echo "  La pagina:     $RAIZ/reportes/hoy.html   (las dos noches, una en cada solapa)"
fi
echo
echo "La maquina tiene que estar prendida en esa franja. Si esta apagada o"
echo "suspendida a una hora, esa muestra se pierde y sigue con la siguiente."
if [ "$(uname)" = "Darwin" ]; then
  echo
  echo "En macOS, cron necesita Acceso Total al Disco para tu terminal"
  echo "(Ajustes -> Privacidad y seguridad -> Acceso total al disco)."
fi
