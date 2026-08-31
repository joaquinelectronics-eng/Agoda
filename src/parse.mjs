// Traduce el JSON crudo de Agoda a filas planas y comodas.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** El precio mas barato entre todas las ofertas/habitaciones de la propiedad. */
function mejorPrecio(pricing) {
  const salida = {
    moneda: null,
    porNoche: null,        // por habitacion por noche, impuestos incluidos
    porNocheSinImp: null,  // idem, sin impuestos ni fees (lo que Agoda muestra grande)
    total: null,           // total de la estadia, impuestos incluidos
    tachado: null,         // precio "antes" que muestra Agoda
    habitacionesLibres: null,
    cancelacion: null,
  };
  let mejor = Infinity;

  for (const oferta of pricing?.offers ?? []) {
    for (const ro of oferta?.roomOffers ?? []) {
      const room = ro?.room;
      for (const pr of room?.pricing ?? []) {
        const p = pr?.price ?? {};
        const prpn = p.perRoomPerNight ?? {};
        const inc = num(prpn.inclusive?.display) ?? num(p.perNight?.inclusive?.display);
        const exc = num(prpn.exclusive?.display) ?? num(p.perNight?.exclusive?.display);
        const ref = inc ?? exc;
        if (ref == null || ref >= mejor) continue;

        mejor = ref;
        salida.moneda = pr.currency ?? salida.moneda;
        salida.porNoche = inc;
        salida.porNocheSinImp = exc;
        salida.total = num(p.perBook?.inclusive?.display) ?? num(p.perBook?.exclusive?.display);
        const tach = num(prpn.inclusive?.crossedOutPrice) || num(prpn.exclusive?.crossedOutPrice);
        salida.tachado = tach && tach > 0 ? tach : null;
        salida.habitacionesLibres = num(room?.availableRooms);
        salida.cancelacion = ro?.payment?.cancellation?.cancellationType ?? null;
      }
    }
  }

  salida.cancelacion ??= pricing?.payment?.cancellation?.cancellationType ?? null;
  return salida;
}

function puntaje(reviews) {
  const cum = reviews?.cumulative;
  return { nota: num(cum?.score), reviews: num(cum?.reviewCount) };
}

function primeraImagen(images) {
  const url = images?.hotelImages?.[0]?.urls?.[0]?.value;
  if (!url) return null;
  return url.startsWith('//') ? `https:${url}` : url;
}

/**
 * property (JSON de Agoda) -> fila plana.
 * `tipos` es el mapa id -> nombre que sale de la matriz de agregacion.
 */
export function parsearPropiedad(prop, { tipos = new Map() } = {}) {
  const info = prop?.content?.informationSummary ?? {};
  const dir = info.address ?? {};
  const precio = mejorPrecio(prop?.pricing);
  const { nota, reviews } = puntaje(prop?.content?.reviews);
  const ruta = info.propertyLinks?.propertyPage ?? null;
  const tipoId = num(info.accommodationType);

  return {
    propertyId: prop?.propertyId ?? null,
    nombre: info.displayName || info.localeName || info.defaultName || '(sin nombre)',
    tipoId,
    tipo: (tipoId != null && tipos.get(tipoId)) || info.propertyType || null,
    familia: info.propertyType ?? null,       // Hotel | NonHotel | SingleRoom
    estrellas: num(info.rating),
    zona: dir.area?.name ?? null,
    zonaId: num(dir.area?.id),
    ciudad: dir.city?.name ?? null,
    ciudadId: num(dir.city?.id),
    pais: dir.country?.name ?? null,
    lat: num(info.geoInfo?.latitude),
    lon: num(info.geoInfo?.longitude),
    url: ruta ? `https://www.agoda.com${ruta}` : null,
    imagen: primeraImagen(prop?.content?.images),
    nota,
    reviews,
    disponible: prop?.pricing?.isAvailable === true && !prop?.soldOut,
    ...precio,
  };
}

/** Mapa id -> nombre de tipo de alojamiento, sacado de las agregaciones. */
export function mapaTipos(citySearch) {
  const m = new Map();
  for (const g of citySearch?.aggregation?.matrixGroupResults ?? []) {
    if (g?.matrixGroup !== 'AccommodationType') continue;
    for (const it of g.matrixItemResults ?? []) {
      if (it?.filterKey === 'AccommodationType' && it.id != null) m.set(it.id, String(it.name).trim());
    }
  }
  return m;
}

/** Saca las propiedades y algo de contexto de una respuesta de /graphql/search. */
export function parsearRespuesta(json) {
  const cs = json?.data?.citySearch;
  if (!cs) return null;
  const tipos = mapaTipos(cs);
  const info = cs.searchResult?.searchInfo ?? {};
  return {
    ciudad: info.objectInfo?.cityName ?? null,
    ciudadId: info.objectInfo?.cityId ?? null,
    totalDisponibles: info.totalFilteredHotels ?? null,
    tipos,
    propiedades: (cs.properties ?? []).map((p) => parsearPropiedad(p, { tipos })),
  };
}
