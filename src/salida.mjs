// Formatos de salida: tabla en consola, CSV, JSON y reporte HTML.

import fs from 'node:fs';
import path from 'node:path';
import { c, tabla, fmtPrecio, fmtPct, recortar, sparkline, horaCorta, haceCuanto } from './util.mjs';

const SOPORTA_LINKS = process.stdout.isTTY && !process.env.NO_HYPERLINKS;

/** Hipervinculo de terminal (OSC 8): el nombre se vuelve clickeable. */
export function enlace(texto, url) {
  if (!SOPORTA_LINKS || !url) return texto;
  return `\x1b]8;;${url}\x1b\\${texto}\x1b]8;;\x1b\\`;
}

const TIPO_CORTO = {
  'Apartamento/Piso': 'depto',
  'Apartamento con servicio': 'apart-hotel',
  'Casa entera': 'casa',
  'Pensión / Bed & Breakfast': 'B&B',
  'Hotel': 'hotel',
  'Hostel': 'hostel',
  'Estancia en una familia': 'homestay',
  'Hotel cápsula': 'capsula',
  'Love Hotel': 'love hotel',
  'Posada': 'posada',
};

export function tipoCorto(t) {
  if (!t) return '-';
  return TIPO_CORTO[t] ?? recortar(String(t).toLowerCase(), 12);
}

function fmtReviews(n) {
  if (!n) return '';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Tabla principal de resultados. */
export function tablaResultados(filas, { moneda = '', noches = 1, mostrarBajada = false, mostrarDistancia = false } = {}) {
  const cols = [
    { key: 'n', title: '#', align: 'right' },
    { key: 'precio', title: `${noches > 1 ? 'x noche' : 'precio'}`, align: 'right', color: 'green' },
  ];
  if (noches > 1) cols.push({ key: 'total', title: `total ${noches}n`, align: 'right' });
  if (mostrarBajada) {
    cols.push({
      key: 'bajada', title: 'bajo', align: 'right',
      color: (f) => (f._bajadaPct != null && f._bajadaPct < -0.5 ? 'green' : f._bajadaPct > 0.5 ? 'red' : 'gray'),
    });
  }
  cols.push({ key: 'nota', title: 'nota', align: 'right', color: 'cyan' });
  cols.push({ key: 'tipo', title: 'tipo', width: 12, color: 'gray' });
  cols.push({ key: 'zona', title: 'zona', width: 18 });
  if (mostrarDistancia) cols.push({ key: 'dist', title: 'km', align: 'right', color: 'gray' });
  cols.push({ key: 'nombre', title: 'alojamiento', width: 46 });

  const datos = filas.map((f, i) => ({
    n: i + 1,
    precio: fmtPrecio(f._precio),
    total: fmtPrecio(f.total),
    bajada: f._bajadaPct == null ? '' : fmtPct(f._bajadaPct),
    nota: f.nota ? `${f.nota.toFixed(1)}${f.reviews ? c('gray', ` (${fmtReviews(f.reviews)})`) : ''}` : '-',
    tipo: tipoCorto(f.tipo),
    zona: f.zona ?? '-',
    dist: f._distancia == null ? '' : f._distancia.toFixed(1),
    nombre: enlace(recortar(f.nombre, 46), f.url),
  }));

  // La nota lleva color embebido, asi que la medimos sin los codigos ANSI.
  return tabla(datos, cols) + (moneda ? `\n  ${c('gray', `precios por habitacion por noche, impuestos incluidos, en ${moneda}`)}` : '');
}

/** Tabla del ranking de bajadas. */
export function tablaBajadas(filas, { moneda = '' } = {}) {
  const datos = filas.map((f, i) => ({
    n: i + 1,
    ahora: fmtPrecio(f._precio),
    antes: fmtPrecio(f.maximo ?? f.precio_inicial),
    dif: fmtPrecio(f._bajada),
    pct: fmtPct(f._bajadaPct),
    min: fmtPrecio(f.minimo),
    obs: f.muestras ?? '',
    nota: f.nota ? f.nota.toFixed(1) : '-',
    zona: f.zona ?? '-',
    nombre: enlace(recortar(f.nombre, 40), f.url),
  }));
  return tabla(datos, [
    { key: 'n', title: '#', align: 'right' },
    { key: 'ahora', title: 'ahora', align: 'right', color: 'green' },
    { key: 'antes', title: 'antes', align: 'right', color: 'gray' },
    { key: 'dif', title: 'dif', align: 'right' },
    { key: 'pct', title: '%', align: 'right', color: (f) => (String(f.pct).startsWith('-') ? 'green' : 'red') },
    { key: 'min', title: 'min hist', align: 'right', color: 'gray' },
    { key: 'obs', title: 'obs', align: 'right', color: 'gray' },
    { key: 'nota', title: 'nota', align: 'right', color: 'cyan' },
    { key: 'zona', title: 'zona', width: 16 },
    { key: 'nombre', title: 'alojamiento', width: 40 },
  ]) + (moneda ? `\n  ${c('gray', `precios por noche en ${moneda}`)}` : '');
}

export function tablaHistorial(puntos, { moneda = '' } = {}) {
  const datos = puntos.map((p, i) => {
    const prev = puntos[i - 1]?.por_noche;
    const d = prev != null && p.por_noche != null ? p.por_noche - prev : null;
    return {
      cuando: horaCorta(p.tomado),
      precio: fmtPrecio(p.por_noche),
      cambio: d == null ? '' : `${d > 0 ? '+' : ''}${fmtPrecio(d)}`,
      libres: p.habitaciones_libres ?? '',
      estado: p.disponible ? '' : 'sin stock',
    };
  });
  return tabla(datos, [
    { key: 'cuando', title: 'cuando' },
    { key: 'precio', title: `precio ${moneda}`, align: 'right', color: 'green' },
    { key: 'cambio', title: 'cambio', align: 'right', color: (f) => (String(f.cambio).startsWith('-') ? 'green' : f.cambio ? 'red' : 'gray') },
    { key: 'libres', title: 'libres', align: 'right', color: 'gray' },
    { key: 'estado', title: '', color: 'yellow' },
  ]);
}

// --- exportar ---------------------------------------------------------------

const CAMPOS_CSV = [
  ['property_id', (f) => f.property_id ?? f.propertyId],
  ['nombre', (f) => f.nombre],
  ['precio_por_noche', (f) => f._precio],
  ['total_estadia', (f) => f.total],
  ['moneda', (f) => f.moneda],
  ['precio_inicial', (f) => f.precio_inicial],
  ['maximo', (f) => f.maximo],
  ['minimo', (f) => f.minimo],
  ['bajada_pct', (f) => (f._bajadaPct == null ? '' : f._bajadaPct.toFixed(1))],
  ['nota', (f) => f.nota],
  ['reviews', (f) => f.reviews],
  ['estrellas', (f) => f.estrellas],
  ['tipo', (f) => f.tipo],
  ['zona', (f) => f.zona],
  ['ciudad', (f) => f.ciudad],
  ['lat', (f) => f.lat],
  ['lon', (f) => f.lon],
  ['distancia_km', (f) => (f._distancia == null ? '' : f._distancia.toFixed(2))],
  ['cancelacion', (f) => f.cancelacion],
  ['habitaciones_libres', (f) => f.habitaciones_libres ?? f.habitacionesLibres],
  ['url', (f) => f.url],
];

const escCsv = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function aCsv(filas) {
  const lineas = [CAMPOS_CSV.map(([k]) => k).join(',')];
  for (const f of filas) lineas.push(CAMPOS_CSV.map(([, get]) => escCsv(get(f))).join(','));
  return lineas.join('\n') + '\n';
}

export function guardar(ruta, contenido) {
  fs.mkdirSync(path.dirname(path.resolve(ruta)), { recursive: true });
  fs.writeFileSync(ruta, contenido);
  return path.resolve(ruta);
}

// --- reporte HTML -----------------------------------------------------------

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Fila de la base -> objeto liviano para el navegador. */
function filaParaWeb(f, historiales) {
  const id = f.property_id ?? f.propertyId;
  const final = f._precio ?? f.por_noche ?? f.porNoche ?? null;
  const base = f.por_noche_sin_imp ?? f.porNocheSinImp ?? null;
  return {
    id,
    nombre: f.nombre,
    final,                                   // por noche, impuestos y cargos incluidos
    base,                                    // por noche, lo que Agoda muestra en la tarjeta
    impPct: final != null && base ? ((final - base) / base) * 100 : null,
    total: f.total ?? null,                  // toda la estadia, con impuestos
    min: f.minimo ?? null,
    max: f.maximo ?? null,
    bajadaPct: f._bajadaPct ?? null,
    nota: f.nota ?? null,
    reviews: f.reviews ?? 0,
    estrellas: f.estrellas ?? null,
    tipo: tipoCorto(f.tipo),
    zona: f.zona ?? '',
    url: f.url ?? '',
    img: f.imagen ?? '',
    canc: /free/i.test(f.cancelacion ?? '') ? 1 : 0,
    libres: f.habitaciones_libres ?? f.habitacionesLibres ?? null,
    hist: (historiales[id] ?? []).map((p) => p.por_noche),
  };
}

const ESTILOS = `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  /* Paleta clara completa. Los neutros tiran a azul, hacia el acento. */
  :root{
    --ground:#eceef1; --surface:#fbfcfd; --surface2:#f3f5f8;
    --ink:#131820; --muted:#5f6875; --line:#dcdfe5; --line2:#c6cbd4;
    --accent:#2f4dab; --accent-ink:#ffffff; --accent-soft:#e4e9f7;
    --good:#0b6b3a;          /* precio final */
    --markup:#8f5410;        /* el recargo que Agoda no muestra */
    --markup-soft:#efdcc2;
    --bad:#a52f22;           /* subio */
    --focus:#2f4dab;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --ground:#0f1216; --surface:#171b21; --surface2:#1d222a;
      --ink:#e9ecf1; --muted:#949daa; --line:#2a3038; --line2:#3b434e;
      --accent:#8fa8ee; --accent-ink:#0f1216; --accent-soft:#1e2941;
      --good:#52d38a; --markup:#e0a44e; --markup-soft:#3a2c17; --bad:#f08a7c;
      --focus:#8fa8ee;
    }
  }
  :root[data-theme="dark"]{
    --ground:#0f1216; --surface:#171b21; --surface2:#1d222a;
    --ink:#e9ecf1; --muted:#949daa; --line:#2a3038; --line2:#3b434e;
    --accent:#8fa8ee; --accent-ink:#0f1216; --accent-soft:#1e2941;
    --good:#52d38a; --markup:#e0a44e; --markup-soft:#3a2c17; --bad:#f08a7c;
    --focus:#8fa8ee;
  }

  *{box-sizing:border-box}
  body{
    margin:0; background:var(--ground); color:var(--ink);
    font:400 14px/1.5 'Archivo', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .n{font-family:'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-variant-numeric:tabular-nums}
  .cont{max-width:1560px; margin:0 auto; padding:0 22px}
  :focus-visible{outline:2px solid var(--focus); outline-offset:2px; border-radius:4px}
  @media (prefers-reduced-motion:reduce){ *{transition:none !important; animation:none !important} }

  /* cabecera */
  header{padding:26px 0 16px; display:flex; flex-direction:column; gap:5px}
  h1{margin:0; font-size:24px; font-weight:700; letter-spacing:-.02em; text-wrap:balance}
  .meta{color:var(--muted); font-size:13px}
  .tesis{
    margin-top:14px; padding:11px 14px; border-radius:9px;
    background:var(--markup-soft); border:1px solid var(--line); color:var(--ink); font-size:13.5px;
  }
  .tesis b{color:var(--markup)}

  /* consola de filtros */
  .consola{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:15px 17px; margin:15px 0}
  .grupo{display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:11px 0; border-top:1px solid var(--line)}
  .grupo:first-child{padding-top:0; border-top:none}
  .grupo:last-child{padding-bottom:0}
  .rotulo{
    width:100%; font-size:10.5px; font-weight:600; text-transform:uppercase;
    letter-spacing:.09em; color:var(--muted); margin-bottom:1px;
  }
  .chip{
    background:transparent; color:var(--ink); border:1px solid var(--line2); border-radius:999px;
    padding:4px 12px; font:inherit; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:7px;
    transition:border-color .12s, background .12s;
  }
  .chip:hover{border-color:var(--accent)}
  .chip[aria-pressed="true"]{background:var(--accent); border-color:var(--accent); color:var(--accent-ink); font-weight:500}
  .chip .c{font-size:11px; opacity:.62; font-family:'IBM Plex Mono', ui-monospace, monospace}
  .chip[aria-pressed="true"] .c{opacity:.8}
  .escondido{display:none}
  .textual{
    background:none; border:none; color:var(--accent); font:inherit; font-size:13px;
    cursor:pointer; padding:4px 2px; text-decoration:underline; text-underline-offset:3px;
  }
  .campo{font-size:11.5px; color:var(--muted); display:flex; flex-direction:column; gap:3px}
  input[type=number],input[type=search]{
    background:var(--surface2); color:var(--ink); border:1px solid var(--line2); border-radius:7px;
    padding:6px 9px; font:inherit; font-size:13px;
  }
  input[type=number]{width:108px; font-family:'IBM Plex Mono', ui-monospace, monospace}
  input[type=search]{width:210px}
  .marca{display:inline-flex; align-items:center; gap:7px; font-size:13px; cursor:pointer}
  .destacado{
    background:var(--accent); border:1px solid var(--accent); color:var(--accent-ink); border-radius:8px;
    padding:6px 14px; font:inherit; font-size:13px; font-weight:600; cursor:pointer;
  }
  .destacado:hover{filter:brightness(1.1)}
  .selector{display:inline-flex; border:1px solid var(--line2); border-radius:8px; overflow:hidden}
  .selector button{background:transparent; color:var(--muted); border:none; padding:6px 14px; font:inherit; font-size:13px; cursor:pointer}
  .selector button[aria-pressed="true"]{background:var(--ink); color:var(--ground); font-weight:600}

  /* resumen */
  .resumen{display:flex; flex-wrap:wrap; gap:18px; align-items:baseline; margin:16px 2px 8px; font-size:13px; color:var(--muted)}
  .resumen .grande{font-size:19px; font-weight:700; color:var(--ink); font-family:'IBM Plex Mono', ui-monospace, monospace}
  .resumen .verde{color:var(--good); font-weight:600; font-family:'IBM Plex Mono', ui-monospace, monospace}

  /* tabla */
  .marco{overflow-x:auto; background:var(--surface); border:1px solid var(--line); border-radius:12px}
  table{width:100%; border-collapse:collapse; font-size:13px; min-width:1000px}
  th{
    text-align:left; font-weight:600; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em;
    color:var(--muted); border-bottom:1px solid var(--line); padding:11px 12px; white-space:nowrap;
    cursor:pointer; user-select:none; position:sticky; top:0; background:var(--surface); z-index:2;
  }
  th:hover{color:var(--ink)}
  th.activa{color:var(--accent)}
  th.der{text-align:right}
  td{border-bottom:1px solid var(--line); padding:9px 12px; vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tbody tr:hover td{background:var(--surface2)}
  .der{text-align:right}
  .precio{font-family:'IBM Plex Mono', ui-monospace, monospace; font-size:17px; font-weight:600; color:var(--good); font-variant-numeric:tabular-nums}
  .sombra{color:var(--muted); font-size:11.5px; font-family:'IBM Plex Mono', ui-monospace, monospace; margin-top:1px}
  .recargo{display:flex; flex-direction:column; align-items:flex-end; gap:3px}
  .recargo .pct{color:var(--markup); font-size:12.5px; font-weight:600; font-family:'IBM Plex Mono', ui-monospace, monospace}
  .barra{height:3px; border-radius:2px; background:var(--markup); opacity:.85}
  .baja{color:var(--good); font-weight:600} .sube{color:var(--bad); font-weight:600}
  .plano{color:var(--muted)}
  .evol{display:flex; align-items:center; gap:8px; justify-content:flex-end}
  .nota{font-family:'IBM Plex Mono', ui-monospace, monospace; font-weight:600; font-size:14px}
  .miniatura{width:58px; height:44px; object-fit:cover; border-radius:6px; background:var(--surface2); display:block}
  a{color:var(--accent); text-decoration:none}
  a:hover{text-decoration:underline; text-underline-offset:2px}
  .etiqueta{
    display:inline-block; font-size:10.5px; color:var(--muted); border:1px solid var(--line2);
    border-radius:999px; padding:0 8px; margin-left:7px; white-space:nowrap; vertical-align:1px;
  }
  .etiqueta.buena{color:var(--good); border-color:var(--good)}
  .nada{padding:52px 20px; text-align:center; color:var(--muted)}
  footer{color:var(--muted); font-size:12px; padding:20px 2px 44px; line-height:1.75; max-width:80ch}
  @media (max-width:640px){
    .cont{padding:0 13px} h1{font-size:19px} input[type=search]{width:100%}
  }
</style>`;

/**
 * Reporte autocontenido: filtros de verdad (tipo y zona se eligen de a varios),
 * precio final con impuestos, y la curva de precio de cada alojamiento.
 * `preseleccion` deja los filtros ya marcados al abrir, sin sacar datos de la tabla.
 * `fragmento: true` devuelve solo el contenido, sin <html>/<head>/<body>.
 */
export function reporteHtml(filas, {
  busqueda, historiales = {}, generado = new Date(), preseleccion = {}, muestras = null,
  fragmento = false, nombre = null,
} = {}) {
  const datos = filas.map((f) => filaParaWeb(f, historiales));
  const noches = Number(busqueda?.los ?? 1);
  const moneda = busqueda?.moneda ?? '';
  const ciudad = busqueda?.ciudad ?? 'Agoda';
  const fecha = busqueda?.check_in ?? busqueda?.checkIn ?? '';
  const huespedes = busqueda?.adultos ?? 2;
  const titulo = `${ciudad} · ${fecha} · ${noches} noche${noches > 1 ? 's' : ''}`;

  // Cuanto esconde el recargo, para poder decirlo con numeros propios.
  const conRecargo = datos.filter((d) => d.impPct != null && d.impPct > 0.5);
  const recargoMax = conRecargo.length ? Math.max(...conRecargo.map((d) => d.impPct)) : 0;

  const contar = (clave) => {
    const m = new Map();
    for (const d of datos) {
      const v = d[clave];
      if (v == null || v === '') continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'es'));
  };
  const tipos = contar('tipo');
  const zonas = contar('zona');

  const estadoInicial = {
    tipos: preseleccion.tipos ?? [],
    zonas: preseleccion.zonas ?? [],
    max: preseleccion.max ?? null,
    nota: preseleccion.minNota ?? null,
    reviews: preseleccion.minReviews ?? null,
    canc: preseleccion.cancelacionGratis ?? false,
    baja: false,
    texto: '',
    conImpuestos: true,
    orden: 'final',
    asc: true,
  };

  const chips = (lista, grupo) => lista.map(([valor, n]) =>
    `<button type="button" class="chip" data-grupo="${grupo}" data-valor="${escHtml(valor)}" aria-pressed="false">` +
    `${escHtml(valor)}<span class="c">${n}</span></button>`).join('');

  const CUERPO = `
<div class="cont">
<header>
  <h1>${escHtml(titulo)}</h1>
  <div class="meta">${escHtml(String(huespedes))} huéspedes · ${datos.length} alojamientos${muestras ? ` · ${muestras} muestras de precio` : ''} · datos del ${escHtml(generado.toLocaleString('es-AR'))}</div>
  <div class="tesis">Agoda muestra en sus tarjetas el precio <b>sin impuestos</b>. Acá el orden es por
  <b>precio final</b>${recargoMax > 1 ? `, y el recargo llega al <b>${recargoMax.toFixed(0)}%</b> en esta búsqueda` : ''}:
  el que parece más barato muchas veces no lo es.</div>
</header>

<div class="consola">
  <div class="grupo">
    <button type="button" class="destacado" id="preset">Mis filtros</button>
    <button type="button" class="textual" id="limpiar">Limpiar todo</button>
    <span style="flex:1"></span>
    <div class="selector" role="group" aria-label="Qué precio usar">
      <button type="button" id="mFinal" aria-pressed="true">Precio final</button>
      <button type="button" id="mBase" aria-pressed="false">Como lo muestra Agoda</button>
    </div>
  </div>

  <div class="grupo"><span class="rotulo">Tipo de alojamiento</span>${chips(tipos, 'tipos')}</div>

  <div class="grupo" id="filaZonas"><span class="rotulo">Zona</span>${chips(zonas, 'zonas')}
    ${zonas.length > 14 ? '<button type="button" class="textual" id="verZonas">ver todas</button>' : ''}</div>

  <div class="grupo">
    <span class="rotulo">Acotar</span>
    <label class="campo">precio final máx<input type="number" id="fmax" placeholder="sin tope"></label>
    <label class="campo">nota mín<input type="number" id="fnota" step="0.1" placeholder="0"></label>
    <label class="campo">reviews mín<input type="number" id="frev" placeholder="0"></label>
    <label class="campo">buscar por nombre<input type="search" id="ftexto" placeholder="ej: palermo soho"></label>
    <label class="marca"><input type="checkbox" id="fcanc"> cancelación gratis</label>
    <label class="marca"><input type="checkbox" id="fbaja"> solo los que bajaron</label>
  </div>
</div>

<div class="resumen" id="resumen"></div>

<div class="marco"><table><thead><tr>
  <th class="der" data-k="_i">#</th><th></th>
  <th class="der activa" data-k="final">precio final ▲</th>
  <th class="der" data-k="impPct">recargo oculto</th>
  ${noches > 1 ? '<th class="der" data-k="total">total ' + noches + 'n</th>' : ''}
  <th class="der" data-k="bajadaPct">evolución</th>
  <th class="der" data-k="nota">nota</th>
  <th data-k="tipo">tipo</th><th data-k="zona">zona</th><th data-k="nombre">alojamiento</th>
</tr></thead><tbody id="cuerpo"></tbody></table>
<div class="nada" id="nada" hidden>Ningún alojamiento coincide con estos filtros.</div></div>

<footer>
  Precio final = por habitación por noche, con impuestos y cargos de Agoda incluidos. Puede haber
  extras que el alojamiento cobre en el momento y que Agoda no informe acá.<br>
  Los precios se mueven durante el día: una bajada chica puede ser ruido, una sostenida es real.
  Verificá siempre en Agoda antes de reservar.
</footer>
</div>`;

  const GUION = `
<script>
var DATOS = ${JSON.stringify(datos)};
var MONEDA = ${JSON.stringify(moneda)};
var VER_TOTAL = ${noches > 1};
var RECARGO_MAX = ${recargoMax.toFixed(2)};
var PRESET = ${JSON.stringify({ tipos: estadoInicial.tipos, zonas: estadoInicial.zonas })};
var CLAVE = 'agoda-filtros-' + ${JSON.stringify(String(busqueda?.id ?? 'x') + '-' + fecha)};

var VACIO = { tipos:[], zonas:[], max:null, nota:null, reviews:null, canc:false, baja:false, texto:'', conImpuestos:true, orden:'final', asc:true };
var estado = Object.assign({}, VACIO, ${JSON.stringify(estadoInicial)});

try {
  var guardado = localStorage.getItem(CLAVE);
  if (guardado) estado = Object.assign(estado, JSON.parse(guardado));
} catch (e) { /* modo privado o storage bloqueado: seguimos con lo que vino */ }

function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) {} }

function $(id) { return document.getElementById(id); }
function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase(); }
function fmt(n) {
  if (n == null) return '';
  return n.toLocaleString('es-AR', { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 });
}
function precioDe(d) { return estado.conImpuestos ? d.final : d.base; }

function curva(h) {
  if (!h || h.length < 2) return '';
  var w = 58, ht = 16, mn = Math.min.apply(null, h), mx = Math.max.apply(null, h), r = (mx - mn) || 1;
  var d = h.map(function (v, i) {
    var x = (i / (h.length - 1)) * w, y = ht - ((v - mn) / r) * (ht - 3) - 1.5;
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
  var fin = h[h.length - 1];
  var col = fin < h[0] ? 'var(--good)' : fin > h[0] ? 'var(--bad)' : 'var(--muted)';
  var ux = w, uy = ht - ((fin - mn) / r) * (ht - 3) - 1.5;
  return '<svg width="' + w + '" height="' + ht + '" aria-hidden="true">' +
    '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<circle cx="' + (ux - 1) + '" cy="' + uy.toFixed(1) + '" r="1.8" fill="' + col + '"/></svg>';
}

function filtrados() {
  return DATOS.filter(function (d) {
    var p = precioDe(d);
    if (estado.tipos.length && estado.tipos.indexOf(d.tipo) < 0) return false;
    if (estado.zonas.length && estado.zonas.indexOf(d.zona) < 0) return false;
    if (estado.max != null && (p == null || p > estado.max)) return false;
    if (estado.nota != null && (d.nota == null || d.nota < estado.nota)) return false;
    if (estado.reviews != null && d.reviews < estado.reviews) return false;
    if (estado.canc && d.canc !== 1) return false;
    if (estado.baja && !(d.bajadaPct != null && d.bajadaPct < -0.5)) return false;
    if (estado.texto && norm(d.nombre).indexOf(norm(estado.texto)) < 0) return false;
    return true;
  });
}

function pintar() {
  var f = filtrados();
  var k = (estado.orden === 'final' && !estado.conImpuestos) ? 'base' : estado.orden;
  f.sort(function (a, b) {
    var x = a[k], y = b[k];
    if (typeof x === 'string' || typeof y === 'string') {
      return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'es') * (estado.asc ? 1 : -1);
    }
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * (estado.asc ? 1 : -1);
  });

  var barato = null, ahorro = 0;
  for (var i = 0; i < f.length; i++) {
    var p = precioDe(f[i]);
    if (p != null && (barato == null || p < barato)) barato = p;
    if (f[i].impPct != null && f[i].impPct > ahorro) ahorro = f[i].impPct;
  }
  $('resumen').innerHTML =
    '<span><span class="grande">' + f.length + '</span> de ' + DATOS.length + ' alojamientos</span>' +
    (barato != null ? '<span>más barato <span class="verde">' + fmt(barato) + ' ' + MONEDA + '</span></span>' : '') +
    (ahorro > 1 ? '<span>recargo más alto acá: <span class="n" style="color:var(--markup);font-weight:600">+' + ahorro.toFixed(0) + '%</span></span>' : '');

  $('cuerpo').innerHTML = f.map(function (d, i) {
    var b = d.bajadaPct;
    var clase = b == null ? '' : b < -0.5 ? 'baja' : b > 0.5 ? 'sube' : 'plano';
    var etiquetas = '';
    if (d.canc) etiquetas += '<span class="etiqueta buena">cancelación gratis</span>';
    if (d.libres != null && d.libres <= 3) etiquetas += '<span class="etiqueta">' + (d.libres === 1 ? 'queda 1' : 'quedan ' + d.libres) + '</span>';

    var recargo = '<span style="color:var(--muted)">—</span>';
    if (d.impPct != null && d.impPct > 0.5) {
      var ancho = Math.max(6, Math.min(54, (d.impPct / (RECARGO_MAX || 30)) * 54));
      recargo = '<span class="recargo"><span class="pct">+' + d.impPct.toFixed(0) + '%</span>' +
                '<span class="barra" style="width:' + ancho.toFixed(0) + 'px"></span></span>';
    }

    var segundo = '';
    if (estado.conImpuestos && d.base != null && d.base !== d.final) segundo = '<div class="sombra">Agoda: ' + fmt(d.base) + '</div>';
    else if (!estado.conImpuestos && d.final != null && d.base !== d.final) segundo = '<div class="sombra">real: ' + fmt(d.final) + '</div>';

    return '<tr>' +
      '<td class="der n" style="color:var(--muted)">' + (i + 1) + '</td>' +
      '<td>' + (d.img ? '<img class="miniatura" loading="lazy" src="' + d.img + '" alt="">' : '<span class="miniatura"></span>') + '</td>' +
      '<td class="der"><span class="precio">' + fmt(precioDe(d)) + '</span>' + segundo + '</td>' +
      '<td class="der">' + recargo + '</td>' +
      (VER_TOTAL ? '<td class="der n">' + fmt(d.total) + '</td>' : '') +
      '<td class="der"><span class="evol">' + curva(d.hist) +
        '<span class="n ' + clase + '">' + (b == null ? '' : (b > 0 ? '+' : '') + b.toFixed(0) + '%') + '</span></span></td>' +
      '<td class="der"><span class="nota">' + (d.nota == null ? '–' : d.nota.toFixed(1)) + '</span>' +
        (d.reviews ? '<div class="sombra">' + d.reviews + '</div>' : '') + '</td>' +
      '<td style="color:var(--muted)">' + d.tipo + '</td><td>' + d.zona + '</td>' +
      '<td>' + (d.url ? '<a href="' + d.url + '" target="_blank" rel="noopener">' + d.nombre + '</a>' : d.nombre) + etiquetas + '</td>' +
    '</tr>';
  }).join('');

  $('nada').hidden = f.length > 0;
  guardar();
}

function sincronizar() {
  var chips = document.querySelectorAll('.chip');
  for (var i = 0; i < chips.length; i++) {
    var ch = chips[i];
    var sel = estado[ch.dataset.grupo].indexOf(ch.dataset.valor) >= 0;
    ch.setAttribute('aria-pressed', sel ? 'true' : 'false');
    if (sel) ch.classList.remove('escondido');   // una zona elegida nunca queda tapada
  }
  $('fmax').value = estado.max == null ? '' : estado.max;
  $('fnota').value = estado.nota == null ? '' : estado.nota;
  $('frev').value = estado.reviews == null ? '' : estado.reviews;
  $('ftexto').value = estado.texto;
  $('fcanc').checked = estado.canc;
  $('fbaja').checked = estado.baja;
  $('mFinal').setAttribute('aria-pressed', estado.conImpuestos ? 'true' : 'false');
  $('mBase').setAttribute('aria-pressed', estado.conImpuestos ? 'false' : 'true');
}

document.querySelectorAll('.chip').forEach(function (ch) {
  ch.addEventListener('click', function () {
    var g = ch.dataset.grupo, v = ch.dataset.valor, i = estado[g].indexOf(v);
    if (i < 0) estado[g].push(v); else estado[g].splice(i, 1);
    sincronizar(); pintar();
  });
});

function numeroDe(el) { var v = parseFloat(el.value); return isNaN(v) ? null : v; }
$('fmax').addEventListener('input', function () { estado.max = numeroDe(this); pintar(); });
$('fnota').addEventListener('input', function () { estado.nota = numeroDe(this); pintar(); });
$('frev').addEventListener('input', function () { estado.reviews = numeroDe(this); pintar(); });
$('ftexto').addEventListener('input', function () { estado.texto = this.value; pintar(); });
$('fcanc').addEventListener('change', function () { estado.canc = this.checked; pintar(); });
$('fbaja').addEventListener('change', function () { estado.baja = this.checked; pintar(); });
$('mFinal').addEventListener('click', function () { estado.conImpuestos = true; sincronizar(); pintar(); });
$('mBase').addEventListener('click', function () { estado.conImpuestos = false; sincronizar(); pintar(); });

$('preset').addEventListener('click', function () {
  estado.tipos = PRESET.tipos.slice();
  estado.zonas = PRESET.zonas.slice();
  sincronizar(); pintar();
});
$('limpiar').addEventListener('click', function () {
  estado = Object.assign({}, VACIO, { conImpuestos: estado.conImpuestos, orden: estado.orden, asc: estado.asc });
  sincronizar(); pintar();
});

var verZonas = $('verZonas');
if (verZonas) {
  var todas = [].slice.call(document.querySelectorAll('#filaZonas .chip'));
  var plegado = true;
  var plegar = function () {
    todas.forEach(function (ch, i) {
      var tapar = plegado && i >= 14 && ch.getAttribute('aria-pressed') !== 'true';
      ch.classList.toggle('escondido', tapar);
    });
    verZonas.textContent = plegado ? 'ver todas' : 'ver menos';
  };
  plegar();
  verZonas.addEventListener('click', function () { plegado = !plegado; plegar(); });
}

document.querySelectorAll('th[data-k]').forEach(function (th) {
  th.addEventListener('click', function () {
    var k = th.dataset.k;
    if (k === '_i') return;
    if (estado.orden === k) estado.asc = !estado.asc;
    else { estado.orden = k; estado.asc = ['nota', 'bajadaPct', 'impPct'].indexOf(k) < 0; }
    document.querySelectorAll('th[data-k]').forEach(function (x) {
      x.classList.remove('activa');
      x.textContent = x.textContent.replace(/ [▲▼]$/, '');
    });
    th.classList.add('activa');
    th.textContent += estado.asc ? ' ▲' : ' ▼';
    pintar();
  });
});

sincronizar();
pintar();
</script>`;

  if (fragmento) return `<title>${escHtml(nombre ?? titulo)}</title>${ESTILOS}${CUERPO}${GUION}`;

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(titulo)} — precio final Agoda</title>
${ESTILOS}
</head><body>${CUERPO}${GUION}</body></html>`;
}

export { sparkline, haceCuanto };
