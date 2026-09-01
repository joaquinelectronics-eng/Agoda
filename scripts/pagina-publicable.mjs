#!/usr/bin/env node
// Genera la version "fragmento" de la pagina (sin <html>/<head>/<body>), lista
// para publicarse embebida. Se usa desde las corridas automaticas.
//
//   node scripts/pagina-publicable.mjs <salida.html> [fecha1,fecha2...]
//
// Sin fechas, toma la noche de hoy y, si existe, la proxima noche guardada.

if (process.env.AGODA_TZ) process.env.TZ = process.env.AGODA_TZ;

import fs from 'node:fs';
import * as DB from '../src/db.mjs';
import { reporteHtml, tipoCorto } from '../src/salida.mjs';
import { filtrar, enriquecer, idsDeTipo } from '../src/filtros.mjs';
import { compararConDiaAnterior, indicePorPropiedad } from '../src/comparar.mjs';
import { miniatura, incrustar } from '../src/imagenes.mjs';
import { normalizar, isoDate } from '../src/util.mjs';
import { rutaDb } from '../src/db.mjs';

const ANCHO = Number(process.env.AGODA_FOTO_ANCHO || 320);
const TIPOS = idsDeTipo(process.env.AGODA_TIPOS || 'depto,casa');
const ZONAS = (process.env.AGODA_ZONAS || 'nunez,belgrano,palermo,recoleta').split(',').map(normalizar);

const salida = process.argv[2];
if (!salida) {
  console.error('uso: node scripts/pagina-publicable.mjs <salida.html> [fechas separadas por coma]');
  process.exit(1);
}

const db = DB.abrirDb(rutaDb());
const todas = DB.listarBusquedas(db).filter((b) => b.snapshots > 0 && b.check_in >= isoDate());
const pedidas = process.argv[3] ? process.argv[3].split(',').map((x) => x.trim()) : null;

const elegidas = pedidas
  ? pedidas.map((f) => {
      const b = elegirUnaPorNoche(todas).find((x) => x.check_in === f);
      if (!b) throw new Error(`No hay muestras guardadas para la noche ${f}`);
      return b;
    })
  : elegirUnaPorNoche(todas).slice(0, 3);

/**
 * Puede haber varias busquedas para la misma noche (distinta ocupacion o moneda).
 * Nos quedamos con la que mas muestras tenga: es la que venimos siguiendo.
 */
function elegirUnaPorNoche(lista) {
  const porNoche = new Map();
  for (const b of lista) {
    const previa = porNoche.get(b.check_in);
    if (!previa || (b.snapshots ?? 0) > (previa.snapshots ?? 0)) porNoche.set(b.check_in, b);
  }
  return [...porNoche.values()].sort((a, b) => a.check_in.localeCompare(b.check_in));
}

if (!elegidas.length) throw new Error('No hay ninguna noche futura con muestras guardadas.');

const vistas = elegidas.map((b) => {
  const snap = DB.ultimoSnapshot(db, b.id);
  const evo = new Map(DB.evolucion(db, b.id).map((r) => [r.property_id, r]));
  const conHistoria = DB.filasSnapshot(db, snap.id).map((f) => {
    const e = evo.get(f.property_id);
    return {
      ...f,
      precio_inicial: e?.precio_inicial ?? null, maximo: e?.maximo ?? null,
      minimo: e?.minimo ?? null, muestras: e?.muestras ?? 1,
    };
  });
  const filas = enriquecer(filtrar(conHistoria, {}), {})
    .filter((f) => TIPOS.has(f.tipo_id))
    .filter((f) => f.zona && ZONAS.some((z) => normalizar(f.zona).includes(z)));

  const historiales = {};
  for (const f of filas) historiales[f.property_id] = DB.historial(db, b.id, f.property_id);
  const comparacion = compararConDiaAnterior(db, b, { toleranciaMin: 90 });

  console.log(`  ${b.check_in}: ${filas.length} filas · ${DB.listarSnapshots(db, b.id, 999).length} muestras · ` +
    (comparacion.hermana ? `${comparacion.filas.length} comparables con ${comparacion.hermana.check_in}` : 'sin noche anterior'));

  return {
    busqueda: b, filas, historiales,
    muestras: DB.listarSnapshots(db, b.id, 999).length,
    comparacion,
    contraAyer: comparacion.hermana ? indicePorPropiedad(comparacion) : null,
  };
});

const filasTodas = vistas.flatMap((v) => v.filas);
const { fotos, total, fallidas, bytes } = await incrustar(
  filasTodas.map((f) => miniatura(f.imagen, ANCHO)).filter(Boolean),
);
console.log(`  fotos: ${total - fallidas}/${total} (${(bytes / 1e6).toFixed(1)} MB, compartidas entre solapas)`);

const html = reporteHtml(vistas, {
  preseleccion: {
    tipos: [...new Set(filasTodas.map((f) => tipoCorto(f.tipo)))],
    zonas: [...new Set(filasTodas.map((f) => f.zona).filter(Boolean))],
  },
  fotos, anchoFoto: ANCHO, fragmento: true,
  nombre: 'Precio final Agoda',
  titulo: `${elegidas[0].ciudad ?? 'Agoda'} · deptos y casas`,
});

fs.mkdirSync(salida.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(salida, html);
console.log(`  pagina: ${salida} (${(html.length / 1e6).toFixed(1)} MB)`);
