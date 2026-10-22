# Agoda

Seguimiento de precios de Agoda para departamentos en Buenos Aires. El usuario
escribe en castellano rioplatense; las respuestas van igual.

## Publicar: siempre en GitHub Pages

Toda pagina que se genere para el usuario se publica en
https://joaquinelectronics-eng.github.io/Agoda/ (pedido explicito del usuario).

1. Generar el HTML en `sitio/index.html`, con las fotos por URL (sin
   `--fotos incrustadas`): en el navegador cargan de los CDN y el archivo
   queda en ~1 MB en vez de 17.
2. Commitear y pushear `sitio/index.html`. El push a `sitio/**` dispara
   `publicar.yml`, que solo sube la carpeta a Pages.
3. Confirmar que el run de `publicar` termino bien y que la URL sirve lo nuevo.

Ejemplo, dos noches sueltas en solapas:

    node bin/agoda.mjs buscar "Buenos Aires" --moneda USD --paginas todas --noche 2026-10-31 --noches 1
    node bin/agoda.mjs buscar "Buenos Aires" --moneda USD --paginas todas --noche 2026-10-30 --noches 1 \
      --pestanas 2026-10-31 --html sitio/index.html

Ojo: `reporte --noche` y `--pestanas FECHA` eligen la busqueda solo por fecha de
entrada, sin mirar `--noches`. Si hay dos busquedas con la misma entrada y
distinta cantidad de noches, pasar los ids (`--busqueda ID --pestanas ID`;
los ids salen de `node bin/agoda.mjs buscas`).

Si ademas se manda el archivo por el chat, esa copia si con
`--fotos incrustadas --fotos-ancho 200`: el visor del chat bloquea imagenes
externas.

## Pileta

`scrapear` hace una pasada extra con los filtros de Agoda "Piscina"
(HotelFacilities 93) y "Piscina privada" (RoomAmenities 50) y marca
`pileta` = 1/0 en cada alojamiento (NULL si la pasada fallo). Agoda no dice si
es climatizada. La pagina tiene el tilde "con pileta".

## Estado

Recoleccion automatica prendida de nuevo el 20/10 (estuvo apagada del 24/9 al
20/10). Muestrea los horizontes de siempre mas `NOCHES_FIJAS` (hoy 30 y 31 de
octubre) en `recolectar.yml` y `muestra.yml`; mientras queden noches fijas por
delante, la pagina publicada es de esas. Para apagar: crear `datos/PARAR`.
