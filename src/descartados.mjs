// Los alojamientos que no te gustan y no querés volver a ver.
//
// Van en un archivo aparte y no en la base, porque la base se rehace desde
// datos/ y esto no es un dato de Agoda: es una preferencia tuya.
import fs from 'node:fs';
import path from 'node:path';
import { rutaDb } from './db.mjs';

export function rutaDescartados() {
  return path.join(path.dirname(rutaDb()), 'descartados.json');
}

/** { "12345": { nombre, cuando } } */
export function leerDescartados(ruta = rutaDescartados()) {
  try {
    const crudo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return crudo && typeof crudo === 'object' && !Array.isArray(crudo) ? crudo : {};
  } catch {
    return {}; // todavia no descartaste nada, o el archivo quedo ilegible
  }
}

function escribir(datos, ruta) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 2) + '\n');
}

/** Devuelve un Set de ids (como numeros) para filtrar rapido. */
export function idsDescartados(ruta = rutaDescartados()) {
  return new Set(Object.keys(leerDescartados(ruta)).map(Number).filter((n) => Number.isFinite(n)));
}

/**
 * Agrega. `entradas` es [{ id, nombre }] o [id]. Devuelve los que se agregaron
 * ahora, sin contar los que ya estaban.
 */
export function descartar(entradas, ruta = rutaDescartados()) {
  const datos = leerDescartados(ruta);
  const nuevos = [];
  for (const e of entradas) {
    const id = String(typeof e === 'object' ? e.id : e).trim();
    if (!id || !/^\d+$/.test(id)) continue;
    if (datos[id]) continue;
    datos[id] = { nombre: (typeof e === 'object' ? e.nombre : null) ?? null, cuando: new Date().toISOString() };
    nuevos.push(id);
  }
  if (nuevos.length) escribir(datos, ruta);
  return nuevos;
}

/** Saca de la lista. Devuelve los que estaban. */
export function recuperar(ids, ruta = rutaDescartados()) {
  const datos = leerDescartados(ruta);
  const sacados = [];
  for (const bruto of ids) {
    const id = String(bruto).trim();
    if (datos[id]) { delete datos[id]; sacados.push(id); }
  }
  if (sacados.length) escribir(datos, ruta);
  return sacados;
}

/** Saca de una lista de filas las que estan descartadas. */
export function sinDescartados(filas, descartados = idsDescartados()) {
  if (!descartados.size) return filas;
  return filas.filter((f) => !descartados.has(Number(f.property_id ?? f.propertyId)));
}
