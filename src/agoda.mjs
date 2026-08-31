// Todo lo que toca agoda.com: armar la URL, resolver el destino y bajar las paginas.

import { parsearRespuesta } from './parse.mjs';
import { sleep, c } from './util.mjs';

const GRAPHQL = '/graphql/search';
const PAGE_SIZE = 100; // maximo que acepta el endpoint

/** Arma la URL de resultados de Agoda. La URL define la busqueda; el resto es paginado. */
export function construirUrl({
  cityId, checkIn, los = 1, adultos = 2, ninos = 0, habitaciones = 1,
  moneda = 'ARS', locale = 'es-ar', edadesNinos = [],
}) {
  const q = new URLSearchParams({
    city: String(cityId),
    checkIn,
    los: String(los),
    rooms: String(habitaciones),
    adults: String(adultos),
    children: String(ninos),
    currency: moneda,
  });
  if (edadesNinos.length) q.set('childAges', edadesNinos.join(','));
  return `https://www.agoda.com/${locale}/search?${q}`;
}

/** Lee los parametros de una URL de Agoda pegada por el usuario. */
export function leerUrl(url) {
  const u = new URL(url);
  const g = (k) => u.searchParams.get(k);
  return {
    cityId: g('city') ? Number(g('city')) : null,
    checkIn: g('checkIn'),
    los: Number(g('los') || 1),
    adultos: Number(g('adults') || 2),
    ninos: Number(g('children') || 0),
    habitaciones: Number(g('rooms') || 1),
    moneda: g('currency') || 'ARS',
  };
}

/** Cambia fecha/noches/moneda sobre una URL existente sin perder los filtros del usuario. */
export function ajustarUrl(url, cambios = {}) {
  const u = new URL(url);
  const mapa = {
    checkIn: 'checkIn', los: 'los', adultos: 'adults',
    ninos: 'children', habitaciones: 'rooms', moneda: 'currency',
  };
  for (const [k, param] of Object.entries(mapa)) {
    if (cambios[k] !== undefined && cambios[k] !== null) u.searchParams.set(param, String(cambios[k]));
  }
  u.searchParams.delete('ds'); // token de sesion viejo
  return u.toString();
}

/**
 * Resuelve texto libre ("palermo", "Bariloche") al destino de Agoda.
 * Corre dentro del navegador para tener cookies y region correctas.
 */
export async function resolverDestino(page, texto, { locale = 'es-ar' } = {}) {
  if (!/agoda\.com/.test(page.url())) {
    await page.goto('https://www.agoda.com/', { waitUntil: 'domcontentloaded' });
  }
  const lista = await page.evaluate(async ({ texto, locale }) => {
    const url = `https://www.agoda.com/api/cronos/search/GetUnifiedSuggestResult/3/1/1/0/${locale}/?searchText=${encodeURIComponent(texto)}`;
    const r = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'include' });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.ViewModelList || []).map((v) => ({
      nombre: v.Name,
      texto: v.ResultText,
      objectId: v.ObjectId,
      cityId: v.CityId,
      ciudad: v.CityName,
      pageTypeId: v.PageTypeId,
      esHotel: v.IsHotel,
      hoteles: v.NoOfHotels,
    }));
  }, { texto, locale });

  // Nos quedamos con lo que se pueda buscar como ciudad: o trae cityId, o es una ciudad.
  const candidatos = lista
    .map((s) => ({ ...s, ciudadFinal: s.cityId || (s.pageTypeId === 2 || s.pageTypeId === 5 ? s.objectId : null) }))
    .filter((s) => s.ciudadFinal && !s.esHotel && s.hoteles > 0);

  return { candidatos, todos: lista };
}

/** Navega a la busqueda y roba la plantilla del pedido GraphQL que hace la pagina. */
export async function capturarPlantilla(page, url, { timeoutMs = 45_000 } = {}) {
  let plantilla = null;
  const respuestas = [];

  const onReq = (req) => {
    if (plantilla || !req.url().includes(GRAPHQL)) return;
    const body = req.postData();
    if (body) plantilla = { url: req.url(), headers: req.headers(), body };
  };
  const onRes = async (res) => {
    if (!res.url().includes(GRAPHQL) || res.status() !== 200) return;
    try {
      const j = await res.json();
      if (j?.data?.citySearch?.properties?.length) respuestas.push(j);
    } catch { /* respuesta parcial o no-JSON */ }
  };

  page.on('request', onReq);
  page.on('response', onRes);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs + 30_000 });
    const limite = Date.now() + timeoutMs;
    while (!plantilla && Date.now() < limite) await sleep(400);

    if (!plantilla) {
      const titulo = await page.title().catch(() => '');
      const actual = page.url();
      if (/captcha|access denied|blocked/i.test(titulo)) {
        throw new Error(`Agoda pidio verificacion ("${titulo}"). Proba de nuevo mas tarde o con --headful.`);
      }
      if (!/\/search/.test(actual)) {
        throw new Error(`Agoda redirigio a ${actual} en vez de mostrar resultados. Revisa la ciudad o la fecha.`);
      }
      throw new Error('No pude capturar el pedido de busqueda de Agoda (puede que hayan cambiado el sitio).');
    }
  } finally {
    page.off('request', onReq);
    page.off('response', onRes);
  }
  return { plantilla, respuestasIniciales: respuestas };
}

/** Repite el pedido GraphQL con nuestro paginado y orden. */
async function pedirPagina(page, plantilla, { pageNumber, pageSize = PAGE_SIZE, sortField = 'Price', sortOrder = 'Asc' }) {
  return page.evaluate(async ({ tpl, opts }) => {
    const pd = JSON.parse(tpl.body);
    const op = Array.isArray(pd) ? pd[0] : pd;
    const sr = op?.variables?.CitySearchRequest?.searchRequest;
    if (!sr) return { ok: false, error: 'La plantilla no tiene searchRequest' };

    sr.page = { pageSize: opts.pageSize, pageNumber: opts.pageNumber, pageToken: '' };
    sr.searchCriteria.sorting = { sortField: opts.sortField, sortOrder: opts.sortOrder, sortParams: null };

    const headers = { ...tpl.headers };
    delete headers['content-length'];
    delete headers['host'];
    // Este header lleva timestamp + id de pedido; hay que regenerarlo en cada llamada.
    headers['x-gate-meta'] = btoa(`${Date.now()}|${crypto.randomUUID()}|/graphql/search`);
    headers['ag-request-id'] = crypto.randomUUID();
    headers['ag-correlation-id'] = crypto.randomUUID();

    const res = await fetch(tpl.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(Array.isArray(pd) ? [op] : op),
      credentials: 'include',
    });
    const texto = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: texto.slice(0, 300) };
    try {
      return { ok: true, json: JSON.parse(texto) };
    } catch {
      return { ok: false, status: res.status, error: 'Respuesta no era JSON' };
    }
  }, { tpl: plantilla, opts: { pageNumber, pageSize, sortField, sortOrder } });
}

/**
 * Baja una busqueda entera.
 * Devuelve { propiedades, ciudad, ciudadId, totalDisponibles, url, paginas }.
 */
export async function scrapear(page, url, { paginas = 3, verboso = true, pausaMs = 1200 } = {}) {
  const { plantilla, respuestasIniciales } = await capturarPlantilla(page, url);

  const porId = new Map();
  let meta = { ciudad: null, ciudadId: null, totalDisponibles: null };
  let paginasOk = 0;

  const absorber = (json) => {
    const r = parsearRespuesta(json);
    if (!r) return 0;
    meta = {
      ciudad: r.ciudad ?? meta.ciudad,
      ciudadId: r.ciudadId ?? meta.ciudadId,
      totalDisponibles: r.totalDisponibles ?? meta.totalDisponibles,
    };
    let nuevas = 0;
    for (const p of r.propiedades) {
      if (p.propertyId == null) continue;
      if (!porId.has(p.propertyId)) nuevas++;
      // La ultima vista gana: las paginas mas nuevas traen precios mas frescos.
      porId.set(p.propertyId, p);
    }
    return nuevas;
  };

  for (let n = 1; n <= paginas; n++) {
    const r = await pedirPagina(page, plantilla, { pageNumber: n });
    if (!r.ok) {
      if (verboso) console.error(c('yellow', `  ! pagina ${n}: ${r.error ?? r.status}`));
      break;
    }
    const nuevas = absorber(r.json);
    paginasOk++;
    if (verboso) {
      process.stderr.write(c('gray', `  pagina ${n}: ${nuevas} nuevas (${porId.size} en total)\n`));
    }
    if (nuevas === 0 && n > 1) break;             // ya no hay mas inventario
    if (porId.size >= (meta.totalDisponibles ?? Infinity)) break;
    if (n < paginas) await sleep(pausaMs);        // no le pegamos de golpe
  }

  if (!paginasOk) {
    // Plan B: al menos lo que trajo la carga de la pagina.
    for (const j of respuestasIniciales) absorber(j);
    if (!porId.size) throw new Error('Agoda no devolvio ninguna propiedad.');
  }

  return { ...meta, url, paginas: paginasOk, propiedades: [...porId.values()] };
}
