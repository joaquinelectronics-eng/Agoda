# agoda-tracker

Baja todas las publicaciones de una búsqueda de Agoda, las filtra y ordena como
vos quieras, y guarda el precio de cada una para ver **cuánto bajó** con el correr
de las horas.

Pensado para el que reserva a último momento: a la tarde los precios se caen, pero
en la web de Agoda eso es difícil de ver.

```
$ agoda buscar "Buenos Aires" --tipo depto --min-nota 8 --min-reviews 50 --moneda USD

Buenos Aires · 2026-08-31 · 1 noche · 2 adulto(s) · USD
1363 disponibles en Agoda · bajamos 206 (2 pagina/s)

   #  precio        nota  tipo         zona           alojamiento
  ──  ──────  ──────────  ───────────  ─────────────  ────────────────────────────────
   1   38,00   9.3 (121)  depto        Almagro        Alohouse
   2   38,15   8.6 (232)  depto        Recoleta       Departamento de Recoleta
   3   39,00  8.1 (1.5k)  depto        Villa Ortúzar  Plaza
   4   41,00   8.6 (172)  depto        San Nicolás    Esmeralda Vista
   5   42,83   8.7 (215)  apart-hotel  San Nicolás    Tribeca Buenos Aires Apart
```

## Qué resuelve

| Problema | Qué hace la herramienta |
| --- | --- |
| El orden por precio de Agoda mezcla destacados y usa el precio **sin impuestos** | Ordena por el precio final con impuestos, sin publicidad en el medio |
| El filtro de precio es un slider grueso | `--max`, `--min`, `--max-total` con números exactos |
| No podés pedir "depto, nota 8+, con al menos 50 opiniones" | `--tipo depto --min-nota 8 --min-reviews 50` |
| No podés filtrar por distancia a un punto | `--cerca -34.6037,-58.3816 --radio 2` |
| No sabés si el precio de hoy es bueno o malo | `agoda seguir` + `agoda bajadas` te muestran la curva |

## Instalación

Necesitás Node 22.5 o más nuevo (usa el SQLite que ya viene con Node).

```bash
git clone <este repo> && cd Agoda
npm install
node node_modules/playwright-core/cli.js install chromium   # solo la primera vez
npm link                          # opcional: deja el comando `agoda` en el PATH
```

Sin `npm link` corrés todo con `node bin/agoda.mjs ...`.

## Dejarlo andando solo (una vez)

```bash
./scripts/instalar.sh                                          # macOS y Linux
powershell -ExecutionPolicy Bypass -File scripts\instalar.ps1   # Windows
```

Instala las dependencias, recupera las muestras ya guardadas en `datos/`, deja el
muestreo horario programado (la noche de hoy y una fecha fija) y toma la primera
muestra para verificar. Después no hay que tocar nada: `reportes/hoy.html` se
regenera solo cada hora, con **una solapa por noche en el mismo archivo**.

En Windows es **una sola tarea** (`agoda`) que muestrea las dos noches una atrás de
la otra y arma la página al final: así las dos solapas quedan en la misma hora y las
corridas no se pisan entre ellas.

Corre en tu máquina, así que **no consume nada de la nube**. Solo necesita que la
compu esté prendida en la franja que sigas.

Para pararlo: `node bin/agoda.mjs programar --quitar --todo`, o en Windows
`schtasks /delete /tn agoda /f`.

### Rehacer solo la tarea (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\tarea.ps1
```

Regenera el comando de cada hora y vuelve a registrar la tarea, sin pasar por la
instalación entera. Al final te muestra qué programa quedó configurado y
verifica que exista.

Usa `Register-ScheduledTask` y no `schtasks.exe` a propósito: al pasarle el path
entre comillas, PowerShell vuelve a citar el argumento y `schtasks` termina
guardando la acción **sin** comillas. Con un usuario como `acer nitro` eso deja
la tarea intentando ejecutar `C:\Users\acer` y fallando con `0x80070002` a cada
hora, sin escribir nada en el registro — se ve sólo en `LastTaskResult`.

### Descartar los que no te gustan

Cada ficha tiene una **cruz** arriba a la derecha. Al tocarla desaparece, y no
vuelve a aparecer en las corridas siguientes.

Se guarda en el navegador con una clave **fija** (`agoda-descartados`), no en la
de los filtros, que lleva las noches adentro y cambia todos los días — guardarlos
ahí los perdería en cada corrida, que es justo lo contrario de lo que se pide.
Probado abriendo el archivo con `file://`, que es como lo abrís vos: el descarte
sobrevive a recargar, o sea a que la tarea reescriba el HTML.

La barra de abajo deja verlos, traer el último de vuelta, y **copiar comando**:

```bash
agoda descartar 415595 987654    # que no aparezcan mas, en cualquier navegador
agoda descartar                  # cuales hay
agoda descartar --quitar 415595  # que vuelva
```

Eso los saca de los datos, no sólo de la vista: quedan en
`data/descartados.json`, que no se versiona porque es una preferencia tuya y el
repo es público. Con `--con-descartados` los ves igual esa vez.

### Que la máquina reporte sola

```powershell
powershell -ExecutionPolicy Bypass -File scripts\tarea.ps1 -Publicar
```

Agrega a la corrida de cada hora un `git pull --rebase` + `commit` + `push` de
`datos/`. Sirve para **mirar desde afuera si la máquina está corriendo**: el
nombre de cada archivo de `datos/<noche>/` es la hora exacta en que se tomó la
muestra, así que la última que haya en el repo dice hasta cuándo llegó.

Antes de agregar el paso hace un `git push --dry-run`. Si no hay credenciales
guardadas te lo dice y no lo agrega, en vez de fallar a cada hora en silencio
adentro del log.

Las muestras quedan públicas, como el resto del repo.

### Que la compu se despierte sola (Windows)

Si no querés tenerla prendida toda la franja:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\despertar.ps1
```

Le pone a la tarea el permiso de **despertar la máquina**, deja que corra con
batería y, si a una hora estaba apagada, que tome esa muestra al volver. También
toca dos cosas del plan de energía:

- **Temporizadores de reactivación**: sin eso Windows ignora el despertador en
  silencio, y la tarea queda perfecta sin dispararse nunca.
- **Suspensión desatendida a 15 minutos**: cuando la máquina se despierta sola y
  nadie la toca, Windows la vuelve a dormir a los 2 minutos. La muestra tarda más
  que eso, así que se dormiría a mitad del scrapeo.

Después hibernála o suspendéla, pero **no la apagues**. Ojo con *Inicio rápido*:
"Apagar" también escribe el archivo de hibernación y parece lo mismo, pero no
deja ningún despertador armado. Desde apagada no se despierta, y eso no lo
arregla ningún ajuste.

### En un servidor, para que no dependa de tu compu

Una tarea local solo corre si la máquina está prendida a esa hora. En un servidor
chico el `cron` dispara al minuto exacto, siempre.

Dos cosas antes de elegir dónde:

- **Agoda cobra distinto según el país de la IP.** Conviene un servidor en
  Sudamérica (São Paulo), y que sea **el único** que junta datos: si mezclás
  muestras tomadas desde IPs de países distintos, un cambio de IP puede parecer
  una baja de precio.
- **2 GB de RAM.** Chromium no entra cómodo en 1 GB; si la máquina tiene menos,
  el instalador te avisa cómo agregarle swap.

En una Ubuntu recién hecha:

```bash
sudo apt-get update && sudo apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

git clone https://github.com/joaquinelectronics-eng/Agoda.git
cd Agoda
./scripts/instalar.sh --web
```

`--web` además deja la página servida por HTTP como servicio de systemd, así la
abrís del celular en `http://<ip>:8080`. Falta abrir ese puerto en el firewall
del proveedor (Oracle: *Security List* de la VCN; AWS: *Security Group*; Vultr y
DigitalOcean vienen abiertos).

El instalador pone la zona horaria de la máquina en la tuya, porque **cron
dispara con la hora del sistema** y un servidor nuevo viene en UTC: sin eso, "de
11 a 23" terminaría siendo de 8 a 20.

```bash
agoda servir reportes --puerto 8080 --clave melon   # pide ?k=melon en la URL
systemctl status agoda-web                          # cómo va el servicio
```

Sin `--clave` la ve cualquiera que sepa la IP y el puerto. Son precios de
hoteles, pero es tu decisión.

**En Windows, nada de `npx`.** Windows trae la ejecución de scripts deshabilitada
y `npx` en PowerShell es un `.ps1`, así que lo bloquea con un `UnauthorizedAccess`.
El navegador se baja invocando el cli de playwright directamente con node:

```powershell
node node_modules\playwright-core\cli.js install chromium
```

Además usa la versión exacta que pide el proyecto, en vez de la última publicada.

## Arranque rápido

```bash
# Deptos para esta noche, hasta 60 mil, con buena nota
agoda buscar "Buenos Aires" --tipo depto --max 60000 --min-nota 8 --min-reviews 30

# Dejarlo mirando toda la tarde y que avise si algo baja 15%
agoda seguir "Buenos Aires" --tipo depto --cada 20 --hasta-hora 21:00 --avisar-si 15

# Ver quién bajó y cuánto
agoda bajadas

# Reporte navegable para elegir tranquilo
agoda reporte --html reportes/hoy.html
```

## Comandos

| Comando | Qué hace |
| --- | --- |
| `agoda buscar <destino>` | Baja las publicaciones, las guarda y las muestra ordenadas |
| `agoda ver` | Muestra la última muestra guardada, sin tocar internet (filtrar es gratis) |
| `agoda bajadas` | Ranking de cuánto bajó cada precio desde que lo seguís |
| `agoda seguir <destino>` | Toma muestras cada X minutos y avisa cuando algo baja |
| `agoda programar <destino>` | Deja el seguimiento corriendo solo, hora a hora |
| `agoda comparar` | Hoy contra la noche anterior, a la misma hora del día |
| `agoda horarios` | A qué hora del día suele convenir reservar |
| `agoda estado` | Si la automatización está corriendo y con qué huecos |
| `agoda historial <id\|nombre>` | La curva de precio de un alojamiento |
| `agoda reporte` | Genera un HTML filtrable y ordenable |
| `agoda buscas` | Lista las búsquedas que venís siguiendo |
| `agoda destinos <texto>` | Resuelve el id de ciudad de Agoda |

`agoda --ayuda` tiene la lista completa de opciones.

### Búsqueda

```
--noche <f>       hoy (por defecto), manana, +3, viernes, 05/09, 2026-09-05
--noches <n>      cuántas noches (1)
--adultos <n>     (2)      --ninos <n> (0)      --habitaciones <n> (1)
--moneda <cod>    ARS por defecto
--paginas <n>     páginas de 100 resultados (3 = los 300 más baratos)
--url <url>       usar una URL de Agoda ya armada, con los filtros que hayas puesto ahí
```

`--paginas` importa: los resultados vienen **ordenados por precio ascendente desde
Agoda**, así que 3 páginas son los 300 alojamientos más baratos de la ciudad.

**Si te interesan barrios caros, usá `--paginas todas`.** Con las 3 páginas por
defecto, Núñez aparece con 0 alojamientos y Belgrano con 1, simplemente porque no
entran entre los 300 más baratos. Con `todas` (para en cuanto no hay más) Buenos
Aires trae 774 alojamientos y esos barrios quedan bien representados:

| | 3 páginas | `--paginas todas` |
| --- | --- | --- |
| Núñez | 0 | 9 |
| Belgrano | 1 | 34 |
| Palermo | 7 | 186 |
| Recoleta | 4 | 75 |

### Filtros

Se aplican sobre lo que ya bajaste, así que probar combinaciones con `agoda ver`
no cuesta ni un pedido más a Agoda.

```
--max / --min <n>       precio por noche
--max-total <n>         tope del total de la estadía
--min-nota <n>          nota mínima            --min-reviews <n>   opiniones mínimas
--min-estrellas <n>     estrellas mínimas
--tipo <lista>          depto, casa, hogar, hotel, hostel, bb, todos (o ids de Agoda)
--zona <lista>          barrios a incluir      --sin-zona <lista>  barrios a excluir
--cerca <lat,lon>       filtra por distancia   --radio <km>        (3)
--cancelacion-gratis    solo cancelación gratis
--texto <t>             el nombre tiene que contener esto
--todos                 incluir también lo que está sin disponibilidad
```

### Orden

`--orden precio` (por defecto), `total`, `nota`, `valor`, `bajada`, `descuento`,
`distancia`, `reviews`, `nombre`.

Dos que vale la pena conocer:

- **`nota`** no usa la nota cruda: la ajusta por cantidad de opiniones (media
  bayesiana), así un 9.9 con 2 reviews no le gana a un 8.9 con 400.
- **`valor`** es cuánta nota ajustada te dan por unidad de precio. Es el orden
  para "lo mejor que puedo conseguir por lo que quiero gastar".

## Bajar el inventario completo

Pedirle a Agoda la página 2, 3, 4… de una lista larga **no** trae la lista larga.
Medido sobre Buenos Aires, 1271 disponibles:

| página | vienen | nuevos | rango de precios |
|--------|--------|--------|------------------|
| 1      | 104    | 104    | 18–50            |
| 3      | 104    | 74     | 48–79            |
| 11     | 104    | 24     | 139–442          |
| 12     | 51     | 10     | 189–1092         |
| 13     | 0      | 0      | —                |

Agoda re-arma el ranking en cada pedido: las páginas se solapan cada vez más y
el listado corta cerca de los 800. Y lo que queda afuera **no son los caros** —
quedan huecos en todo el rango, baratos incluidos.

`--paginas todas` hace otra cosa: barre por **ventanas de precio**, usando el
mismo filtro que Agoda arma con `&priceFrom=&priceTo=`. Cada ventana devuelve
pocos, entra entera y viene ordenada. Si vuelve llena, se parte al medio; si ya
no se puede partir (muchos al mismo precio), recién ahí se pagina adentro.

Antes del barrido hace igual el paginado plano, porque alcanza a los que **no
tienen precio publicado** y que un filtro de precio no puede traer.

El tramo tiene que estar acotado arriba: con el tope abierto (`to: 999999`)
Agoda devuelve la página desordenada, mezclando 18 con 210, y el barrido se
saltea alojamientos.

Resultado sobre la misma búsqueda: **de 790 a 1055 de 1135**, 62 % → 93 %. Tarda
unos 134 segundos en vez de 20.

## Que corra solo, hora a hora

Los precios bajan a medida que se acerca la noche, así que lo que sirve es
muestrear seguido sin tener que acordarse.

```bash
agoda programar "Buenos Aires" --tipo depto,casa --cada 60 --desde-hora 12 --hasta-hora 23
```

Te muestra la línea de crontab lista; con `--instalar` la pone sola, y con
`--quitar` la saca. En Windows te da el comando de `schtasks`. Los filtros y
opciones que pases se arrastran a la tarea, `--pestanas` y `--serie` incluidos.

### Todo en un archivo

Una solapa por búsqueda, en el mismo HTML:

```bash
agoda reporte --pestanas 2026-09-04 --tipo depto,casa --html reportes/agoda.html
```

Los filtros son **únicos y se comparten** entre solapas: los chips salen de la
unión de todas, así que cambiar de noche no te resetea lo que elegiste. La banda
de comparación y el filtro *vs la noche anterior* aparecen solo en las solapas que
tengan con qué comparar. Una solapa que todavía no tenga datos se avisa y se saltea
en vez de tirar la corrida: la muestra ya quedó guardada y lo único que se perdería
es la página.

Las fotos también se comparten — el mismo depto suele estar en varias noches — así
que dos solapas no pesan el doble: en la prueba, 279 fotos únicas para 373 filas.

`--recortar` hace que los filtros **saquen filas del archivo** en vez de solo
dejar los chips marcados. Sin eso el archivo lleva todo y pesa mucho más; con las
fotos incrustadas la diferencia fue de 35 MB a 9 MB.

### Varias búsquedas a la vez

Cada tarea lleva nombre, así que podés seguir la noche de hoy **y** una fecha fija
en paralelo, cada una con su propio reporte:

```bash
# la noche de hoy, se renueva sola todos los días
agoda programar "Buenos Aires" --nombre hoy --tipo depto,casa --cada 60 --instalar

# el viernes 4, fija, hasta que llegue
agoda programar "Buenos Aires" --nombre viernes --noche 2026-09-04 \
  --tipo depto,casa --cada 60 --desde-hora 9 --instalar
```

Instalar una **no pisa la otra**: cada bloque del crontab va marcado con su
nombre, y `--quitar --nombre viernes` saca solo esa. El reporte por defecto pasa a
ser `reportes/<nombre>.html`.

Con fecha fija, la tarea **se apaga sola** cuando la noche pasó: sigue disparando
pero sale sin hacer nada (`nada que hacer: la noche del 2026-09-04 ya paso`), así
que no hace falta acordarse de desinstalarla.

Cada corrida guarda una muestra **y regenera el HTML**, así que `reportes/hoy.html`
siempre está al día. Deja una línea por corrida en `data/agoda.log`:

```
2026-09-01T13:32:11.938Z Buenos Aires 2026-09-01 · 104 alojamientos · 0 bajaron · /home/user/Agoda/reportes/hoy.html
```

La línea que genera es esta, y podés correrla a mano para probar:

```
0 12-23 * * * /usr/bin/node bin/agoda.mjs buscar "Buenos Aires" \
  --tipo depto,casa --paginas todas --noche hoy --silencioso --html reportes/hoy.html \
  >> data/agoda.log 2>&1
```

`--noche hoy` se resuelve en cada corrida, así que sigue la noche en curso sin
tocar nada. En macOS, cron necesita que le des Acceso Total al Disco a tu terminal.

Si preferís no tocar el crontab, `agoda seguir --cada 60` hace lo mismo mientras
tengas la terminal abierta.

### Correrlo sin depender de tu máquina

Si preferís que no dependa de tener la compu prendida, la corrida puede vivir en
un servidor efímero. Ahí la base local no sobrevive, así que cada muestra se
guarda además como un archivo del repo y la base se reconstruye al arrancar:

```bash
export AGODA_TZ=America/Argentina/Buenos_Aires   # sin esto, un servidor en UTC
                                                 # te corre las horas 3 lugares
node bin/agoda.mjs sincronizar                   # rearma la base desde datos/
node bin/agoda.mjs buscar "Buenos Aires" --paginas todas --silencioso --serie datos
git add datos/ && git commit -m "Muestra" && git push
```

Cada muestra es un archivo suelto e inmutable en `datos/<noche>/<momento>.json`,
así que git guarda cada uno una sola vez. Guardar el SQLite entero no serviría:
cada commit dejaría una copia completa de un binario que crece.

`agoda sincronizar` es idempotente, y un archivo ilegible no frena a los demás.

### ¿Está corriendo?

```bash
agoda estado
```

```
  Tarea programada
    ✓ Instalada en el crontab.

  Registro (data/agoda.log)
    37 corridas registradas
    sin errores

  Muestras guardadas
    2026-09-01   12 muestras  ············▪▪▪▪▪▪▪▪▪▪▪▪  12-23h
    2026-08-31   12 muestras  ············▪▪▪▪▪▪▪▪▪▪▪▪  12-23h

  Ultima muestra hace 24 min.
  Hoy: 12 muestras, hueco mas largo 1.0 h, tipico 1.0 h.
```

La barra de 24 casilleros muestra qué horas del día quedaron cubiertas, que es
justo lo que necesita la comparación hora contra hora. Si el hueco más largo es
mucho mayor que el intervalo que pusiste, algo se está salteando.

### Corridas que se pisan

Si una corrida se cuelga o tarda más que el intervalo, la siguiente **se va sin
hacer nada** en vez de abrir un segundo navegador y escribir en la base al mismo
tiempo (`data/agoda.lock`). Un cerrojo de un proceso muerto, o de más de 55
minutos, se pisa solo, así que un cuelgue no traba todo para siempre.

Medido acá: una corrida completa (`--paginas todas`, 786 alojamientos, más
regenerar el HTML) tarda **43 segundos**, no deja procesos de Chromium colgados, y
la base crece del orden de 800 KB por unos pocos miles de precios.

## Comparar contra la noche anterior

Los precios siguen una curva a lo largo del día, así que comparar el de hoy a las
19:00 contra el de ayer al mediodía no dice nada. `comparar` cruza cada
alojamiento **a la misma hora del día**:

```bash
agoda comparar                 # última muestra de hoy vs esa misma hora anoche
agoda comparar --hora 19       # las 19:00 de hoy vs las 19:00 de anoche
agoda comparar --contra 7      # contra la misma noche de la semana pasada
agoda comparar --base hora     # estricto: solo lo que tenga par a la misma hora
```

```
Buenos Aires · 2026-09-01 · 1 noche · 2 adulto(s) · USD
contra la noche del 2026-08-31, cruzando cada uno a las ~19:00

  #    hoy  la noche anterior     dif     %  nota  tipo    zona         alojamiento
  ─  ─────  ─────────────────  ──────  ────  ────  ──────  ───────────  ──────────────────────
  1  22,27              32,60  -10,33  -32%   7.6  hotel   Monserrat    Hotel El Porteno
  2  33,35              46,09  -12,74  -28%   8.5  hostel  Palermo      Malevo Murana Hostel
  3  39,45              51,60  -12,15  -24%   7.6  depto   Monserrat    Apart Buenos Aires Alsina

  81 comparables · 18 mas baratos que anoche · 25 mas caros · 38 igual
  En conjunto, la noche esta -4% respecto de la anterior a la misma hora.
```

### Cuando no hay muestras a la misma hora

Donde no encuentra par a la misma hora, compara contra **el precio más bajo que
tocó ese alojamiento esa noche**, y lo marca aparte:

```
   #    hoy  la noche anterior  referencia      dif     %  tipo   zona         alojamiento
   1  81,20                140  mejor 20:48  -59,20  -42%  depto  San Nicolás  Centro, amplio, luminoso
   2  78,28                112  mejor 20:48  -33,29  -30%  depto  Palermo      Modern Apartments in Palermo
```

Ojo con esto: **ese mejor precio es el piso de toda la noche**, así que la
comparación tira sistemáticamente para arriba — no es lo mismo que comparar hora
contra hora. Por eso va siempre etiquetada: en la tabla la columna `referencia`
dice `mejor`, y en la página el chip dice *vs lo mejor de anoche* con el borde
punteado.

`--base` controla el criterio:

| | |
| --- | --- |
| `--base auto` | por defecto: misma hora donde se puede, mejor precio donde no |
| `--base hora` | solo misma hora; lo que no tenga par queda afuera |
| `--base mejor` | siempre contra el mejor precio de esa noche |

`--tolerancia <min>` afloja el margen de la hora (90 por defecto).

En la página, cada ficha muestra un chip `▼ -13% vs anoche`, la lista tiene su
columna, y hay filtro *solo más baratos que anoche* y orden por esa diferencia.

Para que esto tenga datos hace falta haber muestreado **las dos noches a la misma
hora**, que es exactamente lo que hace `agoda programar`.

## A qué hora conviene reservar

```bash
agoda horarios --tipo depto,casa
```

```
  hora   tipico  promedio  mas barato       │       mas caro      fue el min  muestras  noches
  ─────  ──────  ────────  ─────────────────────────────────────  ──────────  ────────  ──────
  12:00   +8.2%     +8.2%                    │██████████████████                   400      10
  20:00   -1.3%     -1.3%                 ███│                                     400      10
  21:00   -2.6%     -9.4%              ██████│                            64       400      10
  23:00   -4.9%     -4.8%         ███████████│                           241       400      10  ← mejor

  La mejor hora suele ser a las 23:00: -5% respecto de lo que vale el resto del dia.
  ! Los criterios no coinciden:
      tipico   → 23:00 (-5%): la hora mas barata para un alojamiento cualquiera
      promedio → 21:00 (-9%): la hora con mayor descuento promedio, la mueven las bajadas fuertes
      minimos  → 23:00: donde mas seguido cae el precio mas bajo (241 veces)
```

**Cómo se calcula, porque importa.** Promediar precios por hora daría cualquier
cosa: un depto caro muestreado de noche ensuciaría esa hora. Acá cada alojamiento
se compara **consigo mismo**: para cada noche se toma su precio típico (la mediana
de esa noche) y cada observación se mide como porcentaje de eso. Así "-8%"
significa que a esa hora un alojamiento cualquiera suele estar un 8% por debajo de
lo que vale el resto del día, sin que lo desvíen los caros.

### Típico, promedio y mínimos

Son tres preguntas distintas y pueden dar horas distintas:

| columna | qué contesta |
| --- | --- |
| `tipico` | mediana: la hora más barata **para un alojamiento cualquiera** |
| `promedio` | promedio geométrico: la hora con **mayor descuento promedio** |
| `fue el min` | en cuántas series el precio más bajo del día cayó a esa hora |

En el ejemplo de arriba discrepan porque unos pocos deptos rematan fuerte a las
21:00 mientras el resto sigue bajando parejo hasta las 23:00. Si vas a reservar
uno cualquiera, te sirve `tipico`; si estás cazando el remate, `promedio`. Cuando
no coinciden, el comando **te lo dice** en vez de elegir por vos, y `--criterio
mediana|promedio|minimos` fija cuál manda.

**Por qué el promedio es geométrico.** Los ratios de precio son multiplicativos:
un precio que se duplica da 2.0 y uno que se parte al medio da 0.5. Promediados a
la manera común dan 1.25, o sea "+25%", cuando en realidad se cancelan. Promediando
los logaritmos dan 0%, que es lo correcto. Hay un test que fija esto.

**Con pocos datos no opina.** Con menos de 2 noches te dice que no dice nada; con
menos de 4, que lo tomes como indicio; y no saca conclusiones de una hora con
menos de 5 muestras (`--min-muestras`), para que una casualidad de las 3 AM no
gane. Acepta los mismos filtros, así que podés preguntar solo por deptos, o solo
por una zona.

## Seguir los precios

La gracia está acá. Cada muestra queda guardada, así que después podés preguntar
cuánto bajó cada uno:

```bash
agoda seguir "Buenos Aires" --tipo depto --max 60000 \
    --cada 20 --hasta-hora 22:00 --avisar-si 12 --avisar-bajo 40000
```

- `--cada` minutos entre muestras (mínimo 5)
- `--veces` cuántas muestras tomar
- `--hasta-hora hh:mm` cortar a esa hora
- `--avisar-si <pct>` avisar cuando algo baje más de ese porcentaje
- `--avisar-bajo <n>` avisar cuando algo quede por debajo de ese precio
- `--avisar-con "<comando>"` ejecutar algo en cada aviso

En cada muestra te imprime qué bajó, qué subió, qué apareció y qué desapareció.

Para que el aviso te llegue al celular, `--avisar-con` recibe los datos por
variables de entorno (`AGODA_NOMBRE`, `AGODA_PRECIO`, `AGODA_ANTES`, `AGODA_PCT`,
`AGODA_URL`, `AGODA_MONEDA`, `AGODA_CIUDAD`, `AGODA_FECHA`):

```bash
# ejemplo con ntfy.sh
agoda seguir "Buenos Aires" --avisar-si 15 \
  --avisar-con 'curl -s -d "$AGODA_NOMBRE bajo a $AGODA_PRECIO ($AGODA_PCT): $AGODA_URL" ntfy.sh/mi-canal'

# ejemplo en Linux de escritorio
agoda seguir "Buenos Aires" --avisar-si 15 \
  --avisar-con 'notify-send "Bajo de precio" "$AGODA_NOMBRE: $AGODA_PRECIO"'
```

Después:

```
$ agoda bajadas

Buenos Aires · 2026-08-31 · 1 noche · 2 adulto(s) · USD
2 muestras entre 31/08 20:23 y 31/08 20:24

  #  ahora  antes    dif     %  min hist  obs  nota  zona       alojamiento
  ─  ─────  ─────  ─────  ────  ────────  ───  ────  ─────────  ─────────────────────
  1  33,90  37,50  -3,60  -10%     33,90    2   6.8  Almagro    Mitre Suites
  2  37,71  41,64  -3,93   -9%     37,71    2   8.6  Retiro     Up Central Cordoba
  3  33,77  35,61  -1,84   -5%     33,77    2   8.4  Balvanera  Hotel La Perla
```

```bash
agoda bajadas --limite 20          # ranking de bajadas
agoda bajadas --desde 4            # solo lo que pasó en las últimas 4 horas
agoda historial "Alohouse"         # la curva de uno en particular
```

## La página interactiva

```bash
agoda reporte --tipo depto,casa --zona nunez,belgrano,palermo,recoleta --html reportes/hoy.html
```

Un archivo solo, sin dependencias, que abrís en el navegador. Los filtros que le
pasás **no recortan nada**: dejan los chips ya marcados al abrir, y desde la
página los tildás y destildás como quieras.

- **Dos vistas.** *Fichas* con la foto grande (314px), para mirar antes de decidir,
  y *lista* para comparar muchos precios de una. En las fichas el precio final va
  estampado sobre la foto y el recargo oculto como chip arriba a la derecha.
- **Los links abren la ficha de Agoda con tus fechas y tu ocupación** ya cargadas,
  no la página genérica. Cada ficha trae además un botón para copiar el link.
- **Tipo y zona se eligen de a varios.** Chips con la cantidad de cada uno, así
  que podés marcar depto + casa, o Núñez + Belgrano + Palermo + Recoleta.
- **Precio final vs. el que muestra Agoda.** Un botón cambia entre los dos, y el
  orden cambia con él. Debajo de cada precio aparece el otro, para comparar.
- **Columna de recargo oculto**, con barra: se ve de un vistazo cuánto le suma
  Agoda a cada uno arriba del precio que publica.
- Precio máximo, nota mínima, reviews mínimas, cancelación gratis, solo los que
  bajaron, búsqueda por nombre.
- Ordena por cualquier columna, y **se acuerda de tus filtros** la próxima vez que
  abras el archivo.
- Tema claro y oscuro según el sistema.

### Las fotos

Las fotos se piden siempre como miniatura de 120px, no en el tamaño original: una
tabla de 700 filas con las originales son unos 88 MB de descarga, y se ven vacías
mientras cargan. Con miniaturas son 3,7 MB.

```bash
agoda reporte --fotos incrustadas --html reportes/hoy.html
```

`--fotos incrustadas` las mete adentro del HTML como `data:` URI. El archivo queda
autónomo: pesa unos 4 MB pero anda sin internet, y es **la única forma de que se
vean si publicás la página en algún lado que bloquee imágenes de otros dominios**
(bastante común: las fotos de Agoda salen de `agoda.net` y `bstatic.com`).

`--fotos ninguna` deja los recuadros vacíos y el archivo bien liviano.
`--fotos-ancho` cambia el tamaño que se pide (400 por defecto); bajalo a 320 si
incrustás muchas y el archivo te queda pesado.

### Si publicás la página en algún lado

Dos cosas se rompen cuando la página vive dentro de un iframe con sandbox
(páginas publicadas, algunos visores, ciertos intranets):

1. **Las fotos externas quedan bloqueadas por CSP**, sin ningún error visible.
   Se arregla con `--fotos incrustadas`.
2. **Los links pueden quedar bloqueados**, según los permisos del iframe. Medido
   con un click de verdad:

   | permisos del iframe | `<a target="_blank">` | `window.open(…,'noopener')` | `window.open(…)` |
   | --- | --- | --- | --- |
   | `allow-scripts` | bloqueado | bloqueado | bloqueado |
   | `+ allow-popups` | **abre** | bloqueado | abre |

   Dos trampas que costaron un rato: `window.open` con `noopener` en el tercer
   argumento **devuelve `null` aunque haya abierto** (por especificación, corta la
   referencia), así que no sirve ni para detectar si funcionó; y hacerle
   `preventDefault()` al click mata justamente el ancla que sí anda.

   La página se adapta sola según dónde corra. **Suelta** no intercepta nada y el
   ancla abre normal. **Embebida** intenta `window.open` sin `noopener` y, si el
   navegador no deja (el caso `allow-scripts` a secas, donde no abre nada),
   **copia el link al portapapeles y te avisa**; el botón pasa a decir "Copiar
   link" y aparece una nota arriba explicándolo.

El botón **Mis filtros** vuelve a la preselección con la que generaste el archivo.

## El precio final

Agoda muestra en sus tarjetas el precio **sin impuestos** — la tarjeta lo dice con
todas las letras: *"Por noche sin impuestos"*. El recargo va del 0% al 30% según
la propiedad, así que **su orden por precio no sirve para comparar**:

| Alojamiento | Agoda muestra | Precio real |
| --- | --- | --- |
| Noa Noa by Babel | 34,96 | **45,31** (+30%) |
| Departamento de Recoleta | 35,15 | **38,15** (+9%) |

Ordenados como los muestra Agoda, Noa Noa aparece primero. Por precio final, es
más caro. Esta herramienta guarda los dos números (`por_noche` y
`por_noche_sin_imp`) y ordena siempre por el final.

Ojo: puede haber cargos que el alojamiento cobre en el momento y que Agoda no
informe en el listado. El precio final es "todo lo que le pagás a Agoda".

## Usar tu propia URL de Agoda

Si armaste la búsqueda en el sitio (con filtros que la herramienta no cubre), pegá
la URL y se respeta todo:

```bash
agoda buscar --url "https://www.agoda.com/es-ar/search?city=9294&..." --noche hoy --max 50000
```

`--noche`, `--noches`, `--moneda` y demás pisan lo que traiga la URL; el resto de
los parámetros que hayas puesto en Agoda quedan intactos.

## Cómo funciona

1. Abre la página de resultados con Chromium (Playwright) y **captura el pedido
   GraphQL** que hace la propia web de Agoda (`/graphql/search`).
2. Repite ese pedido cambiando solo el paginado y el orden, desde el contexto de
   la misma página, así que usa las cookies y los tokens reales de la sesión.
   Es un pedido por cada 100 alojamientos, con una pausa en el medio.
3. Aplana la respuesta a filas (precio con y sin impuestos, total, tachado, nota,
   opiniones, tipo, barrio, coordenadas, cancelación, cuántas habitaciones quedan).
4. Guarda todo en SQLite: la búsqueda, cada muestra y el precio de cada
   alojamiento en cada muestra.
5. Filtrar, ordenar y comparar pasa siempre sobre la base, sin volver a la red.

```
src/agoda.mjs     URL, resolución de destino, captura y repetición del pedido
src/parse.mjs     JSON de Agoda -> filas planas
src/db.mjs        SQLite: búsquedas, muestras, precios, evolución
src/filtros.mjs   filtros, nota ajustada, orden por valor
src/comparar.mjs  cruce de una noche contra otra a la misma hora
src/horarios.mjs  a que hora del dia conviene reservar
src/cerrojo.mjs   evita que dos corridas programadas se pisen
src/imagenes.mjs  miniaturas y fotos incrustadas
src/salida.mjs    tabla de consola, CSV y reporte HTML
src/comandos.mjs  los comandos del CLI
```

Base de datos en `data/agoda.db` (cambiala con `AGODA_DB`). Si tenés un Chrome
propio, apuntá `AGODA_CHROME` a su ejecutable.

## Cosas a tener en cuenta

- **Los precios de Agoda se mueven solos.** Entre dos muestras separadas por un
  minuto ya podés ver diferencias: cambian por disponibilidad, por moneda y por
  pruebas que hacen ellos. Una bajada chica puede ser ruido; una bajada sostenida
  a lo largo de la tarde es real. Por eso la herramienta guarda mínimo, máximo e
  historial completo, y no solo el último precio.
- **Verificá siempre en el sitio antes de reservar.** Lo que ves acá es lo que
  Agoda mostró en el momento de la muestra.
- Es una herramienta de uso personal, con pocos pedidos y pausas entre ellos. No
  la conviertas en un scraper masivo: además de ser una guarangada, te van a
  terminar bloqueando.
- Si Agoda cambia su API interna, lo primero que se rompe es `src/agoda.mjs`.
  Corré con `AGODA_DEBUG=1` para ver el error completo.

## Tests

```bash
npm test
```

78 tests sobre el parseo (con una respuesta real de Agoda como fixture), los
filtros, el orden, las fechas, las miniaturas, los links, el armado del cron, el
cruce entre noches a la misma hora y el cálculo de bajadas.
