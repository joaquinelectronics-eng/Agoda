// Filtros y ordenamientos: la parte que Agoda hace mal.

import { normalizar, distanciaKm } from './util.mjs';

// Ids de tipo de alojamiento de Agoda, agrupados en algo que se pueda escribir.
export const GRUPOS_TIPO = {
  depto:   [29, 120],                                   // Apartamento/Piso, Apartamento con servicio
  casa:    [131, 30, 102],                              // Casa entera y similares
  hogar:   [28, 29, 30, 102, 103, 106, 107, 108, 109, 110, 114, 115, 120, 131], // "Agoda Homes"
  hotel:   [34, 105, 113],
  hostel:  [33],
  bb:      [32, 111, 108],
};
/**
 * Con lo que abre la pagina si no se le dice otra cosa. No recorta los datos:
 * son los chips que arrancan marcados, y se destildan con un click.
 *
 * Estaba antes solo en las opciones que le pasaba la tarea programada, asi que
 * cualquier reporte generado a mano abria sin nada marcado.
 *
 * "depto" ya incluye Apartamento con servicio (120), y "casa" incluye Casa
 * entera (131). Lo que queda afuera: hoteles, hostels, B&B y "Estancia en una
 * familia" (el chip "homestay"), que es alojarse en la casa de alguien.
 */
export const MIS_FILTROS = {
  tipo: 'depto,casa',
  zona: 'nunez,belgrano,palermo,recoleta',
};

GRUPOS_TIPO.apartamento = GRUPOS_TIPO.depto;
GRUPOS_TIPO.apart = GRUPOS_TIPO.depto;
GRUPOS_TIPO.deptos = GRUPOS_TIPO.depto;
GRUPOS_TIPO.nha = GRUPOS_TIPO.hogar;

/** "depto,hostel" o "29,120" -> Set de ids. `todos` devuelve null (sin filtro). */
export function idsDeTipo(spec) {
  if (!spec) return null;
  const partes = String(spec).split(',').map((s) => normalizar(s)).filter(Boolean);
  if (partes.includes('todos') || partes.includes('all')) return null;
  const ids = new Set();
  for (const p of partes) {
    if (/^\d+$/.test(p)) { ids.add(Number(p)); continue; }
    const g = GRUPOS_TIPO[p];
    if (!g) throw new Error(`Tipo desconocido: "${p}". Opciones: ${Object.keys(GRUPOS_TIPO).join(', ')} o ids numericos.`);
    for (const id of g) ids.add(id);
  }
  return ids;
}

/**
 * Nota ajustada por cantidad de reviews (media bayesiana): un 9.8 con 2 opiniones
 * no le gana a un 8.9 con 400.
 */
export function notaAjustada(nota, reviews, { prior = 8.0, peso = 20 } = {}) {
  if (nota == null) return null;
  const n = reviews ?? 0;
  return (nota * n + prior * peso) / (n + peso);
}

/** Relacion calidad/precio: cuanta nota ajustada te dan por unidad de precio. */
export function valor(fila) {
  const na = notaAjustada(fila.nota, fila.reviews);
  const p = fila.por_noche ?? fila.porNoche;
  if (na == null || !p) return null;
  return (na / p) * 100;
}

function coincideZona(fila, lista) {
  const z = normalizar(fila.zona);
  // El nombre solo cuenta cuando Agoda no dijo el barrio. Mirandolo siempre, un
  // "depto a 5 minutos de Palermo" que esta en Almagro entraba como Palermo, y
  // el filtro de zona dejaba de querer decir algo.
  const donde = z || normalizar(fila.nombre);
  return lista.some((t) => donde.includes(t));
}

/**
 * Aplica todos los filtros. `filas` acepta tanto el formato del scraper (porNoche)
 * como el de la base (por_noche); normalizamos al entrar.
 */
export function filtrar(filas, o = {}) {
  const tipos = idsDeTipo(o.tipo);
  const zonas = (o.zona ? String(o.zona).split(',') : []).map(normalizar).filter(Boolean);
  const excluir = (o.sinZona ? String(o.sinZona).split(',') : []).map(normalizar).filter(Boolean);
  const texto = o.texto ? normalizar(o.texto) : null;
  const centro = o.cerca ?? null;

  return filas.filter((f) => {
    const precio = f.por_noche ?? f.porNoche;
    const disponible = f.disponible === 1 || f.disponible === true;

    if (o.incluirNoDisponibles !== true && !disponible) return false;
    if (o.incluirSinPrecio !== true && precio == null) return false;
    if (o.max != null && precio != null && precio > o.max) return false;
    if (o.min != null && precio != null && precio < o.min) return false;
    if (o.maxTotal != null && f.total != null && f.total > o.maxTotal) return false;
    if (o.minNota != null && (f.nota == null || f.nota < o.minNota)) return false;
    if (o.minReviews != null && (f.reviews ?? 0) < o.minReviews) return false;
    if (o.minEstrellas != null && (f.estrellas ?? 0) < o.minEstrellas) return false;

    const tipoId = f.tipo_id ?? f.tipoId;
    if (tipos && !tipos.has(tipoId)) return false;

    if (zonas.length && !coincideZona(f, zonas)) return false;
    if (excluir.length && coincideZona(f, excluir)) return false;
    if (texto && !normalizar(f.nombre).includes(texto)) return false;

    if (o.cancelacionGratis && !/free/i.test(f.cancelacion ?? '')) return false;

    if (centro) {
      const d = distanciaKm(centro.lat, centro.lon, f.lat, f.lon);
      if (d == null || d > (o.radio ?? 3)) return false;
    }
    return true;
  });
}

/** Agrega columnas calculadas (distancia, valor, bajada) sin tocar el original. */
export function enriquecer(filas, { cerca = null } = {}) {
  return filas.map((f) => {
    const precio = f.por_noche ?? f.porNoche ?? null;
    const inicial = f.precio_inicial ?? null;
    const maximo = f.maximo ?? null;
    const base = maximo ?? inicial;
    // Con una sola observacion no hay contra que comparar: mejor vacio que un 0% enganoso.
    const hayHistoria = f.muestras == null || f.muestras > 1;
    const bajada = hayHistoria && base != null && precio != null ? precio - base : null;
    return {
      ...f,
      _precio: precio,
      _valor: valor(f),
      _notaAjustada: notaAjustada(f.nota, f.reviews),
      _distancia: cerca ? distanciaKm(cerca.lat, cerca.lon, f.lat, f.lon) : null,
      _bajada: bajada,
      _bajadaPct: bajada != null && base ? (bajada / base) * 100 : null,
      _descuentoAgoda: f.tachado && precio ? ((precio - f.tachado) / f.tachado) * 100 : null,
    };
  });
}

const COMPARADORES = {
  precio:    (a, b) => cmp(a._precio, b._precio),
  total:     (a, b) => cmp(a.total, b.total),
  nota:      (a, b) => cmp(b._notaAjustada, a._notaAjustada),
  valor:     (a, b) => cmp(b._valor, a._valor),
  bajada:    (a, b) => cmp(a._bajadaPct, b._bajadaPct),
  descuento: (a, b) => cmp(a._descuentoAgoda, b._descuentoAgoda),
  distancia: (a, b) => cmp(a._distancia, b._distancia),
  reviews:   (a, b) => cmp(b.reviews ?? 0, a.reviews ?? 0),
  nombre:    (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'),
};

function cmp(a, b) {
  const na = a == null || Number.isNaN(a);
  const nb = b == null || Number.isNaN(b);
  if (na && nb) return 0;
  if (na) return 1;   // los nulos siempre al final
  if (nb) return -1;
  return a - b;
}

export function ordenar(filas, orden = 'precio') {
  const clave = normalizar(orden);
  const f = COMPARADORES[clave];
  if (!f) throw new Error(`Orden desconocido: "${orden}". Opciones: ${Object.keys(COMPARADORES).join(', ')}`);
  return [...filas].sort(f);
}

export const ORDENES = Object.keys(COMPARADORES);

/** "-34.60,-58.38" -> {lat, lon} */
export function parsearCoords(s) {
  if (!s) return null;
  const m = String(s).split(',').map((x) => Number(x.trim()));
  if (m.length !== 2 || m.some(Number.isNaN)) throw new Error(`Coordenadas invalidas: "${s}". Usa "lat,lon".`);
  return { lat: m[0], lon: m[1] };
}
