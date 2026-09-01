// A que hora del dia conviene reservar.
//
// No alcanza con promediar precios por hora: un depto caro muestreado de noche
// ensuciaria el promedio de esa hora. Hay que comparar cada alojamiento consigo
// mismo. Entonces, para cada noche y cada alojamiento tomamos su precio tipico de
// esa noche (la mediana) y miramos cada observacion como un porcentaje de eso.
// Asi "las 21:00 estan -8%" significa: a las 21, un alojamiento cualquiera suele
// estar un 8% por debajo de lo que vale el resto del dia.

import * as DB from './db.mjs';
import { minutosDelDia } from './comparar.mjs';

/**
 * Promedio geometrico de una lista de ratios, en porcentaje.
 *
 * El promedio comun no sirve para ratios: un precio que se duplica da 2.0 y uno
 * que se parte al medio da 0.5; promediados dan 1.25, o sea "+25%", cuando en
 * realidad se cancelan. Promediando los logaritmos, 2.0 y 0.5 dan 0%, que es lo
 * correcto. Este es el "promedio de descuento" bien hecho.
 */
export function promedioGeometricoPct(ratios) {
  const validos = ratios.filter((r) => r > 0);
  if (!validos.length) return null;
  const suma = validos.reduce((acc, r) => acc + Math.log(r), 0);
  return (Math.exp(suma / validos.length) - 1) * 100;
}

export function mediana(xs) {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Todas las busquedas del mismo perfil (destino, gente, moneda), mas recientes primero. */
export function nochesDelPerfil(db, busqueda, { noches = 30 } = {}) {
  return db.prepare(`
    SELECT * FROM busquedas
    WHERE los = ? AND moneda = ?
      AND IFNULL(ciudad_id, '') = IFNULL(?, '')
      AND IFNULL(adultos, 0) = IFNULL(?, 0)
      AND IFNULL(ninos, 0) = IFNULL(?, 0)
      AND IFNULL(habitaciones, 0) = IFNULL(?, 0)
    ORDER BY check_in DESC LIMIT ?
  `).all(busqueda.los, busqueda.moneda, busqueda.ciudad_id,
         busqueda.adultos, busqueda.ninos, busqueda.habitaciones, noches);
}

/**
 * Analiza a que hora suelen estar mas baratos los alojamientos.
 *
 * Devuelve { horas, noches, observaciones, propiedades, mejor, aviso } donde cada
 * hora trae:
 *   indicePct     mediana del precio a esa hora respecto del tipico del dia, en %
 *   promedioPct   lo mismo pero con promedio geometrico: siente mas las bajadas grandes
 *   vecesMinimo   en cuantas series (noche + alojamiento) el minimo cayo a esa hora
 *   series        cuantas series pasaron por esa hora
 *   noches        cuantas noches distintas la cubren
 *
 * `criterio` decide cual de las tres columnas define la "mejor hora":
 *   mediana   la hora mas barata para un alojamiento cualquiera (robusta)
 *   promedio  la hora con mayor descuento promedio (siente las bajadas fuertes)
 *   minimos   la hora donde mas seguido cae el minimo del dia
 */
export function analizarHorarios(db, busqueda, {
  noches = 30, propiedades = null, minSeriesPorHora = 5, criterio = 'mediana',
} = {}) {
  if (!['mediana', 'promedio', 'minimos'].includes(criterio)) {
    throw new Error(`Criterio desconocido: "${criterio}". Usa mediana, promedio o minimos.`);
  }
  const listaNoches = nochesDelPerfil(db, busqueda, { noches });

  const porHora = new Map();   // hora -> { ratios:[], vecesMinimo, noches:Set }
  const tocar = (h) => {
    if (!porHora.has(h)) porHora.set(h, { ratios: [], vecesMinimo: 0, noches: new Set() });
    return porHora.get(h);
  };

  let series = 0;
  let observaciones = 0;
  const propsVistas = new Set();

  for (const noche of listaNoches) {
    const obs = DB.observaciones(db, noche.id);
    if (!obs.length) continue;

    // Agrupamos por alojamiento: cada serie es un alojamiento en una noche.
    const porProp = new Map();
    for (const o of obs) {
      if (propiedades && !propiedades.has(o.property_id)) continue;
      if (!porProp.has(o.property_id)) porProp.set(o.property_id, []);
      porProp.get(o.property_id).push(o);
    }

    for (const [propertyId, serie] of porProp) {
      // Con una sola observacion no se puede decir si esa hora es buena o mala.
      if (serie.length < 2) continue;
      const tipico = mediana(serie.map((o) => o.por_noche));
      if (!tipico) continue;

      series++;
      propsVistas.add(propertyId);

      let minimo = Infinity;
      let horaMinimo = null;
      for (const o of serie) {
        const h = Math.floor(minutosDelDia(o.tomado) / 60);
        const celda = tocar(h);
        celda.ratios.push(o.por_noche / tipico);
        celda.noches.add(noche.id);
        observaciones++;
        if (o.por_noche < minimo) { minimo = o.por_noche; horaMinimo = h; }
      }
      if (horaMinimo != null) tocar(horaMinimo).vecesMinimo++;
    }
  }

  const horas = [...porHora.entries()]
    .map(([hora, d]) => ({
      hora,
      indicePct: (mediana(d.ratios) - 1) * 100,   // el tipico: aguanta los outliers
      promedioPct: promedioGeometricoPct(d.ratios), // el promedio: siente las bajadas grandes
      vecesMinimo: d.vecesMinimo,
      series: d.ratios.length,
      noches: d.noches.size,
    }))
    .sort((a, b) => a.hora - b.hora);

  // Solo opinamos sobre horas con suficiente respaldo.
  const solidas = horas.filter((h) => h.series >= minSeriesPorHora);
  const menorPor = (clave) => (solidas.length ? solidas.reduce((a, b) => (b[clave] < a[clave] ? b : a)) : null);

  const porCriterio = {
    mediana: menorPor('indicePct'),
    promedio: menorPor('promedioPct'),
    minimos: solidas.length ? solidas.reduce((a, b) => (b.vecesMinimo > a.vecesMinimo ? b : a)) : null,
  };
  const mejor = porCriterio[criterio] ?? null;
  const peor = solidas.length
    ? solidas.reduce((a, b) => (b.indicePct > a.indicePct ? b : a))
    : null;

  // Si los tres criterios no apuntan a la misma hora, hay que decirlo.
  const horasElegidas = [...new Set(Object.values(porCriterio).filter(Boolean).map((h) => h.hora))];
  const coinciden = horasElegidas.length <= 1;

  return {
    horas,
    nochesAnalizadas: listaNoches.filter((n) => DB.listarSnapshots(db, n.id, 999).length > 0).length,
    series,
    observaciones,
    propiedades: propsVistas.size,
    mejor,
    peor,
    criterio,
    porCriterio,
    coinciden,
    aviso: avisoDeConfianza(listaNoches.length, horas),
  };
}

/**
 * Con pocos datos cualquier conclusion es ruido. Devolvemos que tan en serio se
 * puede tomar el resultado, para decirlo en pantalla en vez de esconderlo.
 */
export function avisoDeConfianza(cantidadNoches, horas) {
  const horasConAlgo = horas.filter((h) => h.series >= 5).length;
  if (cantidadNoches < 2) {
    return { nivel: 'nada', texto: 'Con una sola noche guardada esto no dice nada todavia. Necesitas varias noches.' };
  }
  if (cantidadNoches < 4) {
    return { nivel: 'poco', texto: `Solo ${cantidadNoches} noches guardadas: tomalo como un indicio, no como una regla.` };
  }
  if (horasConAlgo < 4) {
    return { nivel: 'poco', texto: `Solo ${horasConAlgo} horas con muestras suficientes. Amplia la franja horaria del seguimiento.` };
  }
  if (cantidadNoches < 8) {
    return { nivel: 'medio', texto: `${cantidadNoches} noches guardadas. Ya se ve una tendencia; con dos semanas es mas confiable.` };
  }
  return { nivel: 'bien', texto: `${cantidadNoches} noches guardadas: suficiente para confiar en la tendencia.` };
}
