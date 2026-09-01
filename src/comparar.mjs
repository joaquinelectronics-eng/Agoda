// Comparar una noche contra otra a la misma hora del dia.
//
// Los precios de Agoda siguen una curva a lo largo del dia: comparar el precio de
// hoy a las 19:00 contra el de ayer a las 11:00 no dice nada. Hay que cruzar
// observaciones tomadas a la misma hora.

import * as DB from './db.mjs';
import { addDays } from './util.mjs';

const MINUTOS_DIA = 1440;

/** Minutos transcurridos del dia (hora local) de una marca de tiempo ISO. */
export function minutosDelDia(iso) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Distancia en minutos entre dos horas del dia, dando la vuelta por medianoche. */
export function distanciaHoraria(a, b) {
  const d = Math.abs(a - b) % MINUTOS_DIA;
  return Math.min(d, MINUTOS_DIA - d);
}

/**
 * De todas las observaciones de una propiedad, la tomada a la hora del dia mas
 * parecida a `minutosRef`. Devuelve null si ninguna entra en la tolerancia.
 */
export function masCercanaEnHora(observaciones, minutosRef, toleranciaMin) {
  let mejor = null;
  let mejorDist = Infinity;
  for (const o of observaciones) {
    const dist = distanciaHoraria(minutosDelDia(o.tomado), minutosRef);
    if (dist < mejorDist) { mejorDist = dist; mejor = o; }
  }
  if (!mejor || mejorDist > toleranciaMin) return null;
  return { ...mejor, distanciaMin: mejorDist };
}

/**
 * Compara una busqueda contra la de `diasAtras` noches antes, cruzando cada
 * propiedad a la misma hora del dia.
 *
 * Devuelve { hermana, referencia, filas, sinPar } donde cada fila trae el precio
 * de hoy, el de la noche anterior a esa misma hora, y la diferencia.
 */
export function compararConDiaAnterior(db, busqueda, { diasAtras = 1, toleranciaMin = 90, hora = null } = {}) {
  const checkInAnterior = addDays(busqueda.check_in, -diasAtras);
  const hermana = DB.busquedaHermana(db, busqueda, checkInAnterior);
  if (!hermana) {
    return { hermana: null, checkInAnterior, filas: [], sinPar: 0, referencia: null };
  }

  const hoy = DB.observaciones(db, busqueda.id);
  if (!hoy.length) return { hermana, checkInAnterior, filas: [], sinPar: 0, referencia: null };

  // La hora de referencia: la que pidan, o la de la ultima muestra de hoy.
  const ultima = hoy[hoy.length - 1].tomado;
  const minutosRef = hora != null ? hora * 60 : minutosDelDia(ultima);

  // De hoy tambien tomamos la observacion mas cercana a esa hora, propiedad por
  // propiedad: si pidieron una hora vieja, tiene que comparar contra esa.
  const porPropHoy = agrupar(hoy);
  const porPropAyer = agrupar(DB.observaciones(db, hermana.id));

  const filas = [];
  let sinPar = 0;
  for (const [propertyId, obs] of porPropHoy) {
    const ahora = masCercanaEnHora(obs, minutosRef, toleranciaMin);
    if (!ahora) continue;
    const antes = porPropAyer.has(propertyId)
      ? masCercanaEnHora(porPropAyer.get(propertyId), minutosRef, toleranciaMin)
      : null;
    if (!antes) { sinPar++; continue; }

    const delta = ahora.por_noche - antes.por_noche;
    filas.push({
      property_id: propertyId,
      hoy: ahora.por_noche,
      ayer: antes.por_noche,
      delta,
      pct: antes.por_noche ? (delta / antes.por_noche) * 100 : null,
      tomadoHoy: ahora.tomado,
      tomadoAyer: antes.tomado,
      desfasajeMin: ahora.distanciaMin + antes.distanciaMin,
    });
  }

  return {
    hermana,
    checkInAnterior,
    referencia: { minutos: minutosRef, etiqueta: etiquetaHora(minutosRef) },
    filas,
    sinPar,
  };
}

function agrupar(observaciones) {
  const m = new Map();
  for (const o of observaciones) {
    if (!m.has(o.property_id)) m.set(o.property_id, []);
    m.get(o.property_id).push(o);
  }
  return m;
}

export function etiquetaHora(minutos) {
  const h = Math.floor(minutos / 60) % 24;
  const m = Math.round(minutos % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Indice property_id -> comparacion, para pegarlo a las filas del reporte. */
export function indicePorPropiedad(comparacion) {
  return new Map(comparacion.filas.map((f) => [f.property_id, f]));
}
