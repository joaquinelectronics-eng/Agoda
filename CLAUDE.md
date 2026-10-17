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

## Estado

La recoleccion automatica esta apagada desde el 24/9 (`datos/PARAR`, sin
crons). Las corridas ahora son a pedido. Las conclusiones de las tres semanas
de datos (cuando conviene reservar) se las di al usuario en el chat ese dia.
