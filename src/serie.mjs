// Persistencia de las muestras como archivos del repo.
//
// La base SQLite vive en un contenedor efimero: si se recicla, se pierde todo lo
// juntado. Guardar la base entera en git tampoco sirve, porque cada commit
// guardaria una copia completa de un binario que crece. Entonces cada muestra se
// escribe como un archivo chico e inmutable: git guarda cada uno una sola vez, y
// al arrancar se reconstruye la base a partir de todos.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as DB from './db.mjs';

const CAMPOS = [
  'property_id', 'nombre', 'tipo_id', 'tipo', 'familia', 'estrellas', 'zona', 'ciudad', 'ciudad_id',
  'pais', 'lat', 'lon', 'url', 'imagen', 'nota', 'reviews',
  'por_noche', 'por_noche_sin_imp', 'total', 'tachado', 'moneda', 'disponible', 'cancelacion',
  'habitaciones_libres',
];

// Comprimidas: cada muestra repite el nombre, la foto, las coordenadas y el
// barrio de cada alojamiento, que no cambian nunca. Sin gzip, cuatro muestras
// por hora de dos noches son ~68 MB por dia en el repo; con gzip, ~6.
const nombreArchivo = (tomado) => `${tomado.replace(/[:.]/g, '-')}.json.gz`;

/** Lee una muestra, comprimida o no: las viejas quedaron en .json pelado. */
function leerMuestra(archivo) {
  const crudo = fs.readFileSync(archivo);
  return JSON.parse(archivo.endsWith('.gz') ? zlib.gunzipSync(crudo) : crudo.toString('utf8'));
}

/** Escribe una muestra como archivo suelto. Devuelve la ruta, o null si ya estaba. */
export function exportarMuestra(db, busquedaId, snapshotId, dir) {
  const b = DB.buscarBusqueda(db, { id: busquedaId });
  const snap = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId);
  if (!b || !snap) return null;

  const carpeta = path.join(dir, b.check_in);
  fs.mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, nombreArchivo(snap.tomado));
  if (fs.existsSync(destino)) return null;

  const filas = DB.filasSnapshot(db, snapshotId);
  fs.writeFileSync(destino, zlib.gzipSync(JSON.stringify({
    busqueda: {
      ciudadId: b.ciudad_id, ciudad: b.ciudad, checkIn: b.check_in, los: b.los,
      adultos: b.adultos, ninos: b.ninos, habitaciones: b.habitaciones, moneda: b.moneda, url: b.url,
    },
    tomado: snap.tomado,
    totalDisponibles: snap.total_disponibles,
    paginas: snap.paginas,
    origen: snap.origen ?? null,
    propiedades: filas.map((f) => Object.fromEntries(CAMPOS.map((k) => [k, f[k] ?? null]))),
  })));
  return destino;
}

function archivosDe(dir) {
  if (!fs.existsSync(dir)) return [];
  const salida = [];
  for (const noche of fs.readdirSync(dir)) {
    const carpeta = path.join(dir, noche);
    if (!fs.statSync(carpeta).isDirectory()) continue;
    for (const f of fs.readdirSync(carpeta)) {
      if (f.endsWith('.json') || f.endsWith('.json.gz')) salida.push(path.join(carpeta, f));
    }
  }
  return salida.sort();
}

/**
 * Mete en la base todas las muestras de `dir` que todavia no esten.
 * Es idempotente: correrlo dos veces no duplica nada.
 */
export function importarSerie(db, dir) {
  let importadas = 0, salteadas = 0, rotas = 0;

  for (const archivo of archivosDe(dir)) {
    let m;
    try { m = leerMuestra(archivo); } catch { rotas++; continue; }
    if (!m?.tomado || !m.busqueda?.checkIn) { rotas++; continue; }

    const b = DB.guardarBusqueda(db, m.busqueda);
    const yaEsta = db.prepare('SELECT 1 FROM snapshots WHERE busqueda_id = ? AND tomado = ?')
      .get(b.id, m.tomado);
    if (yaEsta) { salteadas++; continue; }

    const props = (m.propiedades ?? []).map((p) => ({
      propertyId: p.property_id, nombre: p.nombre, tipoId: p.tipo_id, tipo: p.tipo, familia: p.familia,
      estrellas: p.estrellas, zona: p.zona, ciudad: p.ciudad, ciudadId: p.ciudad_id, pais: p.pais,
      lat: p.lat, lon: p.lon, url: p.url, imagen: p.imagen, nota: p.nota, reviews: p.reviews,
      disponible: p.disponible === 1 || p.disponible === true,
      moneda: p.moneda, porNoche: p.por_noche, porNocheSinImp: p.por_noche_sin_imp, total: p.total,
      tachado: p.tachado, habitacionesLibres: p.habitaciones_libres, cancelacion: p.cancelacion,
    }));
    const { snapshotId } = DB.guardarSnapshot(db, b.id, props, {
      totalDisponibles: m.totalDisponibles ?? null, paginas: m.paginas ?? null,
      origen: m.origen ?? null,
    });
    // La marca de tiempo original es lo que hace comparable una noche con otra.
    db.prepare('UPDATE snapshots SET tomado = ? WHERE id = ?').run(m.tomado, snapshotId);
    importadas++;
  }

  return { importadas, salteadas, rotas, archivos: archivosDe(dir).length };
}
