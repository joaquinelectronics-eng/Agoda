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
npx playwright install chromium   # solo la primera vez
npm link                          # opcional: deja el comando `agoda` en el PATH
```

Sin `npm link` corrés todo con `node bin/agoda.mjs ...`.

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
pasás **no recortan la tabla**: dejan los chips ya marcados al abrir, y desde la
página los tildás y destildás como quieras.

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

35 tests sobre el parseo (con una respuesta real de Agoda como fixture), los
filtros, el orden, las fechas, las miniaturas y el cálculo de bajadas.
