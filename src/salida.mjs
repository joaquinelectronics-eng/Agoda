// Formatos de salida: tabla en consola, CSV, JSON y reporte HTML.

import fs from 'node:fs';
import path from 'node:path';
import { c, tabla, fmtPrecio, fmtPct, recortar, sparkline, horaCorta, haceCuanto } from './util.mjs';
import { miniatura } from './imagenes.mjs';

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

/** Tabla de hoy contra la noche anterior a la misma hora. */
export function tablaComparacion(filas, { moneda = '' } = {}) {
  const datos = filas.map((f, i) => ({
    n: i + 1,
    hoy: fmtPrecio(f.hoy),
    ayer: fmtPrecio(f.ayer),
    ref: f.base === 'mejor' ? `mejor ${f.horaAyer ?? ''}`.trim() : (f.horaAyer ?? ''),
    dif: fmtPrecio(f.delta),
    pct: fmtPct(f.pct),
    nota: f.nota ? f.nota.toFixed(1) : '-',
    tipo: tipoCorto(f.tipo),
    zona: f.zona ?? '-',
    nombre: enlace(recortar(f.nombre, 40), f.url),
  }));
  return tabla(datos, [
    { key: 'n', title: '#', align: 'right' },
    { key: 'hoy', title: 'hoy', align: 'right', color: 'green' },
    { key: 'ayer', title: 'la noche anterior', align: 'right', color: 'gray' },
    { key: 'ref', title: 'referencia', color: (f) => (String(f.ref).startsWith('mejor') ? 'yellow' : 'gray') },
    { key: 'dif', title: 'dif', align: 'right' },
    { key: 'pct', title: '%', align: 'right', color: (f) => (String(f.pct).startsWith('-') ? 'green' : 'red') },
    { key: 'nota', title: 'nota', align: 'right', color: 'cyan' },
    { key: 'tipo', title: 'tipo', width: 12, color: 'gray' },
    { key: 'zona', title: 'zona', width: 16 },
    { key: 'nombre', title: 'alojamiento', width: 40 },
  ]) + (moneda ? `\n  ${c('gray', `precios por noche en ${moneda}`)}` : '');
}

/**
 * Tabla de horarios con una barra centrada en cero: a la izquierda las horas mas
 * baratas que lo tipico del dia, a la derecha las mas caras.
 */
export function tablaHorarios(horas, { minSeries = 5, mejor = null, grafica = 'mediana' } = {}) {
  const columna = grafica === 'promedio' ? 'promedioPct' : 'indicePct';
  const escala = Math.max(6, ...horas.map((h) => Math.abs(h[columna] ?? 0)));
  const ANCHO = 18;

  const barra = (pct) => {
    const n = Math.max(1, Math.round((Math.abs(pct) / escala) * ANCHO));
    if (pct < -0.5) return ' '.repeat(ANCHO - n) + c('green', '█'.repeat(n)) + '│' + ' '.repeat(ANCHO);
    if (pct > 0.5) return ' '.repeat(ANCHO) + '│' + c('red', '█'.repeat(n)) + ' '.repeat(ANCHO - n);
    return ' '.repeat(ANCHO) + c('gray', '│') + ' '.repeat(ANCHO);
  };

  const pct = (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
  const flojas = (h) => h.series < minSeries;

  const datos = horas.map((h) => ({
    hora: `${String(h.hora).padStart(2, '0')}:00`,
    tipico: flojas(h) ? c('gray', 'pocas') : pct(h.indicePct),
    promedio: flojas(h) ? c('gray', '-') : pct(h.promedioPct),
    grafico: barra(flojas(h) ? 0 : (grafica === 'promedio' ? h.promedioPct : h.indicePct)),
    minimo: h.vecesMinimo || '',
    series: h.series,
    noches: h.noches,
    marca: mejor && h.hora === mejor.hora ? c('green', '← mejor') : '',
  }));

  return tabla(datos, [
    { key: 'hora', title: 'hora' },
    { key: 'tipico', title: 'tipico', align: 'right' },
    { key: 'promedio', title: 'promedio', align: 'right' },
    { key: 'grafico', title: `mas barato ${' '.repeat(6)}│${' '.repeat(6)} mas caro` },
    { key: 'minimo', title: 'fue el min', align: 'right', color: 'cyan' },
    { key: 'series', title: 'muestras', align: 'right', color: 'gray' },
    { key: 'noches', title: 'noches', align: 'right', color: 'gray' },
    { key: 'marca', title: '' },
  ]);
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

const ESTILOS = `
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  /* Paleta clara completa. Los neutros tiran a azul, hacia el acento. */
  :root{
    --ground:#eceef1; --surface:#fbfcfd; --surface2:#f1f3f7;
    --ink:#131820; --muted:#5f6875; --line:#dcdfe5; --line2:#c6cbd4;
    --accent:#2f4dab; --accent-ink:#ffffff;
    --good:#0b6b3a;          /* precio final */
    --markup:#8f5410;        /* el recargo que Agoda no muestra */
    --markup-soft:#f0dcc0;
    --bad:#a52f22;
    --sombra:0 1px 2px rgba(19,24,32,.05), 0 6px 16px rgba(19,24,32,.06);
    --sombra-alta:0 2px 4px rgba(19,24,32,.07), 0 12px 28px rgba(19,24,32,.12);
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --ground:#0f1216; --surface:#171b21; --surface2:#1e232b;
      --ink:#e9ecf1; --muted:#949daa; --line:#2a3038; --line2:#3b434e;
      --accent:#8fa8ee; --accent-ink:#0f1216;
      --good:#52d38a; --markup:#e0a44e; --markup-soft:#3a2c17; --bad:#f08a7c;
      --sombra:0 1px 2px rgba(0,0,0,.4), 0 6px 16px rgba(0,0,0,.35);
      --sombra-alta:0 2px 4px rgba(0,0,0,.45), 0 12px 28px rgba(0,0,0,.5);
    }
  }
  :root[data-theme="dark"]{
    --ground:#0f1216; --surface:#171b21; --surface2:#1e232b;
    --ink:#e9ecf1; --muted:#949daa; --line:#2a3038; --line2:#3b434e;
    --accent:#8fa8ee; --accent-ink:#0f1216;
    --good:#52d38a; --markup:#e0a44e; --markup-soft:#3a2c17; --bad:#f08a7c;
    --sombra:0 1px 2px rgba(0,0,0,.4), 0 6px 16px rgba(0,0,0,.35);
    --sombra-alta:0 2px 4px rgba(0,0,0,.45), 0 12px 28px rgba(0,0,0,.5);
  }

  *{box-sizing:border-box}
  /* Sin esto, cualquier regla con display propio le gana al atributo hidden. */
  [hidden]{display:none !important}
  body{
    margin:0; background:var(--ground); color:var(--ink);
    font:400 14px/1.5 'Archivo', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .n{font-family:'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-variant-numeric:tabular-nums}
  .cont{max-width:1560px; margin:0 auto; padding:0 22px}
  :focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:5px}
  @media (prefers-reduced-motion:reduce){ *{transition:none !important; animation:none !important} }

  header{padding:26px 0 14px; display:flex; flex-direction:column; gap:5px}
  h1{margin:0; font-size:24px; font-weight:700; letter-spacing:-.02em; text-wrap:balance}
  .meta{color:var(--muted); font-size:13px}
  .tesis{
    margin-top:14px; padding:11px 14px; border-radius:9px;
    background:var(--markup-soft); border:1px solid var(--line); font-size:13.5px;
  }
  .tesis b{color:var(--markup)}

  .solapas{display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 4px}
  .solapa{
    background:var(--surface); color:var(--muted); border:1px solid var(--line); border-radius:11px;
    padding:9px 16px; font:inherit; cursor:pointer; text-align:left; display:flex; flex-direction:column; gap:2px;
    transition:border-color .14s, color .14s, background .14s;
  }
  .solapa:hover{border-color:var(--line2); color:var(--ink)}
  .solapa[aria-pressed="true"]{background:var(--ink); color:var(--ground); border-color:var(--ink)}
  .solapaTitulo{font-size:15px; font-weight:600; letter-spacing:-.01em}
  .solapaSub{font-size:11.5px; opacity:.75; font-family:'IBM Plex Mono', ui-monospace, monospace}

  .consola{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:15px 17px; margin:15px 0; box-shadow:var(--sombra)}
  .grupo{display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:11px 0; border-top:1px solid var(--line)}
  .grupo:first-child{padding-top:0; border-top:none}
  .grupo:last-child{padding-bottom:0}
  .rotulo{width:100%; font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.09em; color:var(--muted); margin-bottom:1px}
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
  .textual{background:none; border:none; color:var(--accent); font:inherit; font-size:13px; cursor:pointer; padding:4px 2px; text-decoration:underline; text-underline-offset:3px}
  .campo{font-size:11.5px; color:var(--muted); display:flex; flex-direction:column; gap:3px}
  input[type=number],input[type=search],select{
    background:var(--surface2); color:var(--ink); border:1px solid var(--line2); border-radius:7px;
    padding:6px 9px; font:inherit; font-size:13px;
  }
  input[type=number]{width:108px; font-family:'IBM Plex Mono', ui-monospace, monospace}
  input[type=search]{width:210px}
  .marca{display:inline-flex; align-items:center; gap:7px; font-size:13px; cursor:pointer}
  .destacado{background:var(--accent); border:1px solid var(--accent); color:var(--accent-ink); border-radius:8px; padding:6px 14px; font:inherit; font-size:13px; font-weight:600; cursor:pointer}
  .destacado:hover{filter:brightness(1.1)}
  .selector{display:inline-flex; border:1px solid var(--line2); border-radius:8px; overflow:hidden}
  .selector button{background:transparent; color:var(--muted); border:none; padding:6px 14px; font:inherit; font-size:13px; cursor:pointer}
  .selector button[aria-pressed="true"]{background:var(--ink); color:var(--ground); font-weight:600}

  .resumen{display:flex; flex-wrap:wrap; gap:18px; align-items:baseline; margin:16px 2px 12px; font-size:13px; color:var(--muted)}
  .resumen .grande{font-size:19px; font-weight:700; color:var(--ink); font-family:'IBM Plex Mono', ui-monospace, monospace}
  .resumen .verde{color:var(--good); font-weight:600; font-family:'IBM Plex Mono', ui-monospace, monospace}

  /* ---- fichas: la foto manda ---- */
  .rejilla{display:grid; grid-template-columns:repeat(auto-fill, minmax(266px, 1fr)); gap:18px; padding-bottom:8px}
  .ficha{
    position:relative;
    display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--line);
    border-radius:13px; overflow:hidden; text-decoration:none; color:inherit; box-shadow:var(--sombra);
    transition:transform .14s ease, box-shadow .14s ease, border-color .14s ease;
  }
  .ficha:hover{transform:translateY(-3px); box-shadow:var(--sombra-alta); border-color:var(--line2)}
  .ficha:hover .abrir{color:var(--accent-ink); background:var(--accent); border-color:var(--accent)}
  .ficha .titulo a{color:inherit; text-decoration:none}
  .ficha .titulo a:hover{text-decoration:underline; text-underline-offset:2px}
  .foto{display:block}
  /* La cruz para descartar. Chica y translucida hasta que pasas por encima:
     esta sobre la foto, que es lo que mira el ojo. */
  .tachar{
    position:absolute; top:8px; right:8px; z-index:3;
    width:26px; height:26px; border-radius:50%; cursor:pointer;
    border:1px solid rgba(255,255,255,.45); background:rgba(0,0,0,.42); color:#fff;
    font-size:14px; line-height:1; padding:0; opacity:0; transition:opacity .14s ease, background .14s ease;
    display:flex; align-items:center; justify-content:center;
  }
  .ficha:hover .tachar, .tachar:focus-visible{opacity:1}
  .tachar:hover{background:#c0392b; border-color:#c0392b}
  /* En pantalla tactil no hay hover: que se vea siempre. */
  @media (hover:none){ .tachar{opacity:.85} }
  tr .tachar{position:static; opacity:.5; width:22px; height:22px; font-size:12px; display:inline-flex}
  tr:hover .tachar{opacity:1}
  .ficha.fuera{opacity:.45; filter:grayscale(1)}
  .barraDesc{
    display:flex; align-items:center; gap:10px; flex-wrap:wrap;
    margin:10px 2px 0; padding:8px 12px; border-radius:10px;
    background:var(--surface2); border:1px solid var(--line); font-size:12.5px; color:var(--muted);
  }
  .barraDesc b{color:var(--ink)}
  .barraDesc button{
    border:1px solid var(--line2); background:var(--surface); color:var(--ink);
    border-radius:8px; padding:3px 9px; font-size:12px; cursor:pointer; font-family:inherit;
  }
  .barraDesc button:hover{border-color:var(--ink)}
  .barraDesc .aviso{color:var(--markup)}
  .foto{position:relative; aspect-ratio:16/10; background:var(--surface2); overflow:hidden}
  .foto img{width:100%; height:100%; object-fit:cover; display:block}
  .foto .sinfoto{
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    color:var(--muted); font-size:12px;
  }
  .sello{
    position:absolute; top:9px; left:9px; display:flex; align-items:baseline; gap:6px;
    background:rgba(255,255,255,.94); color:#0b6b3a; border-radius:8px; padding:5px 10px;
    font-family:'IBM Plex Mono', ui-monospace, monospace; font-weight:600; font-size:19px;
    box-shadow:0 2px 8px rgba(0,0,0,.18); backdrop-filter:blur(3px);
  }
  .sello .moneda{font-size:11px; font-weight:500; opacity:.72}
  .selloRecargo{
    position:absolute; top:9px; right:9px; background:rgba(143,84,16,.95); color:#fff;
    border-radius:999px; padding:3px 9px; font-family:'IBM Plex Mono', ui-monospace, monospace;
    font-size:11.5px; font-weight:600; box-shadow:0 2px 8px rgba(0,0,0,.2);
  }
  .selloBaja{
    position:absolute; bottom:9px; left:9px; background:rgba(11,107,58,.95); color:#fff;
    border-radius:999px; padding:3px 9px; font-family:'IBM Plex Mono', ui-monospace, monospace;
    font-size:11.5px; font-weight:600;
  }
  .interior{padding:12px 14px 13px; display:flex; flex-direction:column; gap:7px; flex:1}
  .titulo{
    margin:0; font-size:14.5px; font-weight:600; line-height:1.32;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
  }
  .subdatos{display:flex; flex-wrap:wrap; align-items:center; gap:7px; font-size:12.5px; color:var(--muted)}
  .puntaje{
    font-family:'IBM Plex Mono', ui-monospace, monospace; font-weight:600; font-size:13px;
    color:var(--ink); background:var(--surface2); border-radius:6px; padding:1px 7px;
  }
  .sinImp{font-size:12px; color:var(--muted); font-family:'IBM Plex Mono', ui-monospace, monospace}
  .etiquetas{display:flex; flex-wrap:wrap; gap:5px}
  .etiqueta{font-size:10.5px; color:var(--muted); border:1px solid var(--line2); border-radius:999px; padding:1px 8px}
  .etiqueta.buena{color:var(--good); border-color:var(--good)}
  .vsAyer{
    font-size:10.5px; font-weight:600; border-radius:999px; padding:1px 8px; white-space:nowrap;
    font-family:'IBM Plex Mono', ui-monospace, monospace;
  }
  .vsAyer.mejor{color:var(--good); border:1px solid var(--good)}
  .vsAyer.peor{color:var(--bad); border:1px solid var(--bad)}
  .vsAyer.igual{color:var(--muted); border:1px solid var(--line2)}
  .vsAyer.piso{border-style:dashed}
  .vsAyerLeyenda{opacity:.72; font-weight:400}
  .tesis.ayer{background:var(--surface2); border-color:var(--line2)}
  .tesis.ayer b{color:var(--ink)}
  .pie{margin-top:auto; padding-top:9px; display:flex; align-items:center; justify-content:space-between; gap:8px}
  .abrir{
    font-size:12.5px; font-weight:600; color:var(--accent); border:1px solid var(--line2);
    border-radius:7px; padding:5px 11px; text-decoration:none;
    transition:background .14s, color .14s, border-color .14s;
  }
  .curvita{opacity:.85}
  .acciones{display:inline-flex; align-items:center; gap:6px}
  .copiar{
    background:transparent; border:1px solid var(--line2); color:var(--muted); border-radius:7px;
    padding:4px 8px; font:inherit; font-size:13px; line-height:1.1; cursor:pointer;
    transition:color .14s, border-color .14s;
  }
  .copiar:hover{color:var(--accent); border-color:var(--accent)}
  .copiar{white-space:nowrap}
  .copiar.copiado{color:var(--good); border-color:var(--good)}
  td .copiar{padding:1px 6px; font-size:11px; margin-left:7px; vertical-align:1px}

  /* ---- lista ---- */
  .marco{overflow-x:auto; background:var(--surface); border:1px solid var(--line); border-radius:12px; box-shadow:var(--sombra)}
  table{width:100%; border-collapse:collapse; font-size:13px; min-width:1000px}
  th{
    text-align:left; font-weight:600; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em;
    color:var(--muted); border-bottom:1px solid var(--line); padding:11px 12px; white-space:nowrap;
    cursor:pointer; user-select:none; position:sticky; top:0; background:var(--surface); z-index:2;
  }
  th:hover{color:var(--ink)} th.activa{color:var(--accent)} th.der{text-align:right}
  td{border-bottom:1px solid var(--line); padding:9px 12px; vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tbody tr:hover td{background:var(--surface2)}
  .der{text-align:right}
  .precio{font-family:'IBM Plex Mono', ui-monospace, monospace; font-size:17px; font-weight:600; color:var(--good); font-variant-numeric:tabular-nums}
  .sombraTxt{color:var(--muted); font-size:11.5px; font-family:'IBM Plex Mono', ui-monospace, monospace; margin-top:1px}
  .recargo{display:flex; flex-direction:column; align-items:flex-end; gap:3px}
  .recargo .pct{color:var(--markup); font-size:12.5px; font-weight:600; font-family:'IBM Plex Mono', ui-monospace, monospace}
  .barra{height:3px; border-radius:2px; background:var(--markup); opacity:.85}
  .baja{color:var(--good); font-weight:600} .sube{color:var(--bad); font-weight:600} .plano{color:var(--muted)}
  .evol{display:flex; align-items:center; gap:8px; justify-content:flex-end}
  .miniatura{width:58px; height:44px; object-fit:cover; border-radius:6px; background:var(--surface2); display:block}
  a{color:var(--accent); text-decoration:none}
  .marco a:hover{text-decoration:underline; text-underline-offset:2px}

  .tesis.nota{background:var(--surface2); border-color:var(--line2)}
  .tesis.nota code{font-family:'IBM Plex Mono', ui-monospace, monospace; font-size:12.5px}
  .aviso{
    position:fixed; left:50%; transform:translateX(-50%); bottom:22px; z-index:60;
    background:var(--ink); color:var(--ground); border-radius:9px; padding:10px 16px;
    font-size:13px; font-weight:500; box-shadow:var(--sombra-alta); max-width:90vw;
  }
  .aviso.bien{background:var(--good); color:#fff}
  .nada{padding:52px 20px; text-align:center; color:var(--muted)}
  footer{color:var(--muted); font-size:12px; padding:22px 2px 44px; line-height:1.75; max-width:80ch}

  @media (max-width:640px){ .cont{padding:0 13px} h1{font-size:19px} input[type=search]{width:100%} .rejilla{grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:14px} }
</style>`;

// --- reporte HTML -----------------------------------------------------------

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * El link a la propiedad tiene que abrir TUS fechas, no las que Agoda elija.
 * Sin estos parametros cae en la pagina generica y hay que cargar todo de nuevo.
 */
export function urlConFechas(url, busqueda) {
  if (!url || !busqueda) return url;
  try {
    const u = new URL(url);
    const p = {
      checkIn: busqueda.check_in ?? busqueda.checkIn,
      los: busqueda.los,
      adults: busqueda.adultos,
      children: busqueda.ninos,
      rooms: busqueda.habitaciones,
      currency: busqueda.moneda,
    };
    for (const [k, v] of Object.entries(p)) if (v != null && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Fila de la base -> objeto liviano para el navegador.
 * Las fotos van como miniatura del ancho que use la vista: la original pesa 40
 * veces mas. Si `fotos` viene, la miniatura va incrustada como data: URI.
 */
function filaParaWeb(f, { historiales, fotos, busqueda, anchoFoto, contraAyer }) {
  const id = f.property_id ?? f.propertyId;
  const mini = miniatura(f.imagen, anchoFoto);
  const ayer = contraAyer ? contraAyer.get(id) : null;
  const final = f._precio ?? f.por_noche ?? f.porNoche ?? null;
  const base = f.por_noche_sin_imp ?? f.porNocheSinImp ?? null;
  return {
    id,
    nombre: f.nombre,
    final,                                   // por noche, impuestos y cargos incluidos
    base,                                    // por noche, lo que Agoda muestra en la tarjeta
    impPct: final != null && base ? ((final - base) / base) * 100 : null,
    total: f.total ?? null,
    min: f.minimo ?? null,
    max: f.maximo ?? null,
    bajadaPct: f._bajadaPct ?? null,
    nota: f.nota ?? null,
    reviews: f.reviews ?? 0,
    estrellas: f.estrellas ?? null,
    tipo: tipoCorto(f.tipo),
    zona: f.zona ?? '',
    url: urlConFechas(f.url, busqueda) ?? '',
    img: (fotos ? fotos.get(mini) : mini) ?? '',
    canc: /free/i.test(f.cancelacion ?? '') ? 1 : 0,
    libres: f.habitaciones_libres ?? f.habitacionesLibres ?? null,
    hist: (historiales[id] ?? []).map((p) => p.por_noche),
    ayer: ayer ? ayer.ayer : null,
    ayerPct: ayer ? ayer.pct : null,
    ayerBase: ayer ? ayer.base : null,
    ayerHora: ayer ? ayer.horaAyer : null,
  };
}

/** Nombre corto de una noche, para la solapa: "vie 4 sep". */
function etiquetaNoche(checkIn) {
  const [y, m, d] = String(checkIn).split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${dias[fecha.getDay()]} ${d} ${meses[m - 1]}`;
}

/** Las fotos se comparten entre solapas: el mismo depto aparece en varias noches. */
export function urlesDeFotos(filas, anchoFoto = 320) {
  return filas.map((f) => miniatura(f.imagen, anchoFoto)).filter(Boolean);
}

/**
 * Reporte autocontenido con una solapa por busqueda.
 *
 * `vistas` es un array de { busqueda, filas, historiales, comparacion, contraAyer, muestras }.
 * Los filtros son unicos y se comparten entre solapas: los chips salen de la
 * union de todas, asi cambiar de noche no te resetea lo que elegiste.
 */
export function reporteHtml(vistas, {
  generado = new Date(), preseleccion = {}, fragmento = false, nombre = null,
  fotos = null, anchoFoto = 320, titulo = null,
} = {}) {
  const pestanas = vistas.map((v, i) => {
    const datos = v.filas.map((f) => filaParaWeb(f, {
      historiales: v.historiales ?? {}, fotos, busqueda: v.busqueda, anchoFoto, contraAyer: v.contraAyer,
    }));
    const conRecargo = datos.filter((d) => d.impPct != null && d.impPct > 0.5);
    const conAyer = datos.filter((d) => d.ayerPct != null);
    const b = v.busqueda;
    const noches = Number(b?.los ?? 1);
    return {
      id: `p${i}`,
      etiqueta: etiquetaNoche(b.check_in),
      checkIn: b.check_in,
      noches,
      moneda: b.moneda ?? '',
      huespedes: b.adultos ?? 2,
      ciudad: b.ciudad ?? 'Agoda',
      muestras: v.muestras ?? null,
      recargoMax: conRecargo.length ? Math.max(...conRecargo.map((d) => d.impPct)) : 0,
      comparacion: v.comparacion?.hermana ? {
        checkIn: v.comparacion.hermana.check_in,
        hora: v.comparacion.referencia?.etiqueta ?? '',
        piso: conAyer.filter((d) => d.ayerBase === 'mejor').length,
        aHora: conAyer.filter((d) => d.ayerBase === 'hora').length,
        masBaratos: conAyer.filter((d) => d.ayerPct < -0.5).length,
        masCaros: conAyer.filter((d) => d.ayerPct > 0.5).length,
        total: conAyer.length,
      } : null,
      datos,
    };
  });

  // Los chips salen de la union de todas las solapas.
  const contar = (clave) => {
    const m = new Map();
    for (const p of pestanas) for (const d of p.datos) {
      const v = d[clave];
      if (v == null || v === '') continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'es'));
  };
  const tipos = contar('tipo');
  const zonas = contar('zona');

  const tituloPagina = titulo ?? `${pestanas[0].ciudad} · ${pestanas.map((p) => p.etiqueta).join(' · ')}`;

  const estadoInicial = {
    pestana: pestanas[0].id,
    tipos: preseleccion.tipos ?? [],
    zonas: preseleccion.zonas ?? [],
    max: preseleccion.max ?? null,
    nota: preseleccion.minNota ?? null,
    reviews: preseleccion.minReviews ?? null,
    canc: preseleccion.cancelacionGratis ?? false,
    baja: false,
    mejorQueAyer: false,
    texto: '',
    conImpuestos: true,
    vista: 'fichas',
    orden: 'final',
    asc: true,
  };

  const chips = (lista, grupo) => lista.map(([valor, n]) =>
    `<button type="button" class="chip" data-grupo="${grupo}" data-valor="${escHtml(valor)}" aria-pressed="false">` +
    `${escHtml(valor)}<span class="c">${n}</span></button>`).join('');

  const solapas = pestanas.map((p) => {
    const noches = p.noches > 1 ? `${p.noches} noches` : '1 noche';
    return `<button type="button" class="solapa" data-pestana="${p.id}" aria-pressed="false">
      <span class="solapaTitulo">${escHtml(p.etiqueta)}</span>
      <span class="solapaSub">${escHtml(p.checkIn)} · ${noches} · ${p.datos.length}</span>
    </button>`;
  }).join('');

  const CUERPO = `
<div class="cont">
<header>
  <h1>${escHtml(tituloPagina)}</h1>
  <div class="meta">datos del ${escHtml(generado.toLocaleString('es-AR'))}</div>
</header>

${pestanas.length > 1 ? `<div class="solapas" role="tablist">${solapas}</div>` : ''}

<div id="bandas"></div>

<div class="consola">
  <div class="grupo">
    <button type="button" class="destacado" id="preset">Mis filtros</button>
    <button type="button" class="textual" id="limpiar">Limpiar todo</button>
    <span style="flex:1"></span>
    <div class="selector" role="group" aria-label="Cómo ver los resultados">
      <button type="button" id="vFichas" aria-pressed="true">Fichas</button>
      <button type="button" id="vLista" aria-pressed="false">Lista</button>
    </div>
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
    <label class="campo">ordenar por<select id="forden">
      <option value="final">precio final</option>
      <option value="impPct">recargo oculto</option>
      <option value="bajadaPct">cuánto bajó</option>
      <option value="ayerPct">vs la noche anterior</option>
      <option value="nota">nota</option>
      <option value="reviews">cantidad de reviews</option>
      <option value="zona">zona</option>
      <option value="nombre">nombre</option>
    </select></label>
    <button type="button" class="chip" id="fsentido" title="Invertir el orden">↑ menor primero</button>
    <label class="marca"><input type="checkbox" id="fcanc"> cancelación gratis</label>
    <label class="marca"><input type="checkbox" id="fbaja"> solo los que bajaron hoy</label>
    <label class="marca" id="marcaAyer" hidden><input type="checkbox" id="fayer"> solo más baratos que la noche anterior</label>
  </div>

  <div class="grupo barraDesc" id="barraDesc" hidden></div>
</div>

<div class="resumen" id="resumen"></div>
<div class="rejilla" id="rejilla"></div>
<div class="marco" id="marco" hidden><table><thead><tr id="cabecera"></tr></thead><tbody id="cuerpoTabla"></tbody></table></div>
<div class="nada" id="nada" hidden>Ningún alojamiento coincide con estos filtros.</div>

<footer>
  Precio final = por habitación por noche, con impuestos y cargos de Agoda incluidos. Puede haber
  extras que el alojamiento cobre en el momento y que Agoda no informe acá.<br>
  Los links abren la ficha de Agoda ya con las fechas de la solapa que estés mirando.<br>
  Los precios se mueven durante el día: una bajada chica puede ser ruido, una sostenida es real.
  Verificá siempre en Agoda antes de reservar.
</footer>
</div>`;

  const GUION = `
<script>
var PESTANAS = ${JSON.stringify(pestanas)};
var CLAVE = 'agoda-filtros-' + ${JSON.stringify(pestanas.map((p) => p.checkIn).join('_'))};

// true si la pagina vive adentro de un iframe: ahi abrir pestanas puede estar prohibido.
var ENMARCADO = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

var VACIO = { pestana: PESTANAS[0].id, tipos:[], zonas:[], max:null, nota:null, reviews:null, canc:false,
              baja:false, mejorQueAyer:false, texto:'', conImpuestos:true, vista:'fichas', orden:'final', asc:true };
var estado = Object.assign({}, VACIO, ${JSON.stringify(estadoInicial)});

try {
  var guardado = localStorage.getItem(CLAVE);
  if (guardado) estado = Object.assign(estado, JSON.parse(guardado));
} catch (e) { /* modo privado o storage bloqueado */ }
if (!PESTANAS.some(function (p) { return p.id === estado.pestana; })) estado.pestana = PESTANAS[0].id;
function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) {} }

// Los descartados van aparte y con una clave FIJA: la de los filtros lleva las
// noches adentro y cambia todos los dias, asi que guardarlos ahi los perderia
// en cada corrida, que es justo lo contrario de lo que se pide.
var CLAVE_DESC = 'agoda-descartados';
var descartados = {};
var guardaDeVerdad = false;
try {
  descartados = JSON.parse(localStorage.getItem(CLAVE_DESC)) || {};
  // Probar de verdad: en algunos navegadores el storage existe pero no escribe,
  // y descartar algo y que reaparezca al recargar seria peor que avisar.
  localStorage.setItem(CLAVE_DESC, JSON.stringify(descartados));
  guardaDeVerdad = localStorage.getItem(CLAVE_DESC) != null;
} catch (e) { descartados = {}; }
var verDescartados = false;
var ultimoDescartado = null;

function guardarDescartados() {
  try { localStorage.setItem(CLAVE_DESC, JSON.stringify(descartados)); } catch (e) {}
}
function estaDescartado(d) { return Object.prototype.hasOwnProperty.call(descartados, String(d.id)); }

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase(); }
function fmt(n) { return n == null ? '' : n.toLocaleString('es-AR', { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }); }
function activa() { return PESTANAS.filter(function (p) { return p.id === estado.pestana; })[0] || PESTANAS[0]; }
function precioDe(d) { return estado.conImpuestos ? d.final : d.base; }

function curva(h, ancho) {
  if (!h || h.length < 2) return '';
  var w = ancho || 58, ht = 16, mn = Math.min.apply(null, h), mx = Math.max.apply(null, h), r = (mx - mn) || 1;
  var d = h.map(function (v, i) {
    var x = (i / (h.length - 1)) * w, y = ht - ((v - mn) / r) * (ht - 3) - 1.5;
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
  var fin = h[h.length - 1];
  var col = fin < h[0] ? 'var(--good)' : fin > h[0] ? 'var(--bad)' : 'var(--muted)';
  var uy = ht - ((fin - mn) / r) * (ht - 3) - 1.5;
  return '<svg class="curvita" width="' + w + '" height="' + ht + '" aria-hidden="true">' +
    '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<circle cx="' + (w - 1) + '" cy="' + uy.toFixed(1) + '" r="1.8" fill="' + col + '"/></svg>';
}

function filtrados() {
  return activa().datos.filter(function (d) {
    var p = precioDe(d);
    if (!verDescartados && estaDescartado(d)) return false;
    if (estado.tipos.length && estado.tipos.indexOf(d.tipo) < 0) return false;
    if (estado.zonas.length && estado.zonas.indexOf(d.zona) < 0) return false;
    if (estado.max != null && (p == null || p > estado.max)) return false;
    if (estado.nota != null && (d.nota == null || d.nota < estado.nota)) return false;
    if (estado.reviews != null && d.reviews < estado.reviews) return false;
    if (estado.canc && d.canc !== 1) return false;
    if (estado.baja && !(d.bajadaPct != null && d.bajadaPct < -0.5)) return false;
    if (estado.mejorQueAyer && !(d.ayerPct != null && d.ayerPct < -0.5)) return false;
    if (estado.texto && norm(d.nombre).indexOf(norm(estado.texto)) < 0) return false;
    return true;
  });
}

function ordenados() {
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
  return f;
}

function etiquetasDe(d) {
  var t = '';
  if (d.canc) t += '<span class="etiqueta buena">cancelación gratis</span>';
  if (d.libres != null && d.libres <= 3) t += '<span class="etiqueta">' + (d.libres === 1 ? 'queda 1' : 'quedan ' + d.libres) + '</span>';
  return t;
}

function ficha(d) {
  var p = activa();
  var foto = d.img
    ? '<img loading="lazy" decoding="async" src="' + d.img + '" alt="Foto de ' + esc(d.nombre) + '">'
    : '<span class="sinfoto">sin foto</span>';
  var recargo = (d.impPct != null && d.impPct > 0.5)
    ? '<span class="selloRecargo" title="Agoda publica ' + fmt(d.base) + ', sin impuestos">+' + d.impPct.toFixed(0) + '%</span>' : '';
  var baja = (d.bajadaPct != null && d.bajadaPct < -0.5)
    ? '<span class="selloBaja">bajó ' + d.bajadaPct.toFixed(0) + '%</span>' : '';
  var sinImp = (estado.conImpuestos && d.base != null && d.base !== d.final)
    ? '<span class="sinImp">Agoda publica ' + fmt(d.base) + '</span>' : '';

  var vsAyer = '';
  if (d.ayerPct != null) {
    var mejor = d.ayerPct < -0.5, peor = d.ayerPct > 0.5;
    var contraElPiso = d.ayerBase === 'mejor';
    // El porcentaje solo no dice cuanta plata es: va tambien el precio de esa noche.
    var leyenda = contraElPiso ? 'lo mejor de la noche anterior' : 'la noche anterior';
    var explica = contraElPiso
      ? 'Lo mas barato que llego a estar la noche anterior: ' + fmt(d.ayer) + ' (' + (d.ayerHora || '') + '). Es el piso de toda esa noche, no la misma hora.'
      : 'La noche anterior, a esta misma hora (' + (d.ayerHora || '') + '), costaba ' + fmt(d.ayer);
    vsAyer = '<span class="vsAyer ' + (mejor ? 'mejor' : peor ? 'peor' : 'igual') + (contraElPiso ? ' piso' : '') + '" ' +
      'title="' + explica + '">' + (mejor ? '▼' : peor ? '▲' : '=') + ' ' +
      (d.ayerPct > 0 ? '+' : '') + d.ayerPct.toFixed(0) + '% · ' + fmt(d.ayer) + ' ' + p.moneda +
      ' <span class="vsAyerLeyenda">' + leyenda + '</span></span>';
  }

  var ancla = 'href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer"';
  var cruz = '<button type="button" class="tachar" data-tachar="' + esc(d.id) + '" ' +
    'title="No mostrarme mas este" aria-label="Descartar ' + esc(d.nombre) + '">' +
    (estaDescartado(d) ? '↩' : '✕') + '</button>';
  return '<article class="ficha' + (estaDescartado(d) ? ' fuera' : '') + '">' + cruz +
    '<a class="foto" ' + ancla + ' aria-label="Abrir ' + esc(d.nombre) + ' en Agoda">' + foto +
      '<span class="sello">' + fmt(precioDe(d)) + '<span class="moneda">' + p.moneda + '</span></span>' +
      recargo + baja +
    '</a>' +
    '<div class="interior">' +
      '<h3 class="titulo"><a ' + ancla + '>' + esc(d.nombre) + '</a></h3>' +
      '<div class="subdatos">' +
        (d.nota != null ? '<span class="puntaje">' + d.nota.toFixed(1) + '</span>' : '') +
        (d.reviews ? '<span>' + d.reviews + ' reviews</span>' : '<span>sin reviews</span>') +
        '<span>·</span><span>' + esc(d.tipo) + '</span>' +
        (d.zona ? '<span>·</span><span>' + esc(d.zona) + '</span>' : '') +
      '</div>' +
      (sinImp ? '<div class="subdatos">' + sinImp + (p.noches > 1 ? '<span>· total ' + fmt(d.total) + '</span>' : '') + '</div>' : '') +
      '<div class="etiquetas">' + vsAyer + etiquetasDe(d) + '</div>' +
      '<div class="pie">' + curva(d.hist, 72) +
        '<span class="acciones">' +
          '<a class="abrir" ' + ancla + '>Ver en Agoda ↗</a>' +
          '<button type="button" class="copiar" data-url="' + esc(d.url) + '" title="Copiar el link de Agoda">' + (ENMARCADO ? 'Copiar link' : '⧉') + '</button>' +
        '</span>' +
      '</div>' +
    '</div></article>';
}

function cabeceraTabla() {
  var p = activa();
  var verAyer = p.comparacion != null;
  var th = [
    '<th class="der" data-k="_i">#</th><th></th>',
    '<th class="der" data-k="final">precio final</th>',
    '<th class="der" data-k="impPct">recargo oculto</th>',
    p.noches > 1 ? '<th class="der" data-k="total">total ' + p.noches + 'n</th>' : '',
    '<th class="der" data-k="bajadaPct">evolución</th>',
    verAyer ? '<th class="der" data-k="ayerPct">vs anterior</th>' : '',
    '<th class="der" data-k="nota">nota</th>',
    '<th data-k="tipo">tipo</th><th data-k="zona">zona</th><th data-k="nombre">alojamiento</th>',
  ].join('');
  $('cabecera').innerHTML = th;
  document.querySelectorAll('th[data-k]').forEach(function (x) {
    if (x.dataset.k === estado.orden) { x.classList.add('activa'); x.textContent += estado.asc ? ' ▲' : ' ▼'; }
    x.addEventListener('click', function () {
      var k = x.dataset.k;
      if (k === '_i') return;
      if (estado.orden === k) estado.asc = !estado.asc;
      else { estado.orden = k; estado.asc = ['nota', 'bajadaPct', 'impPct', 'ayerPct'].indexOf(k) < 0; }
      sincronizar(); pintar();
    });
  });
}

function fila(d, i) {
  var p = activa();
  var b = d.bajadaPct;
  var clase = b == null ? '' : b < -0.5 ? 'baja' : b > 0.5 ? 'sube' : 'plano';
  var recargo = '<span style="color:var(--muted)">—</span>';
  if (d.impPct != null && d.impPct > 0.5) {
    var ancho = Math.max(6, Math.min(54, (d.impPct / (p.recargoMax || 30)) * 54));
    recargo = '<span class="recargo"><span class="pct">+' + d.impPct.toFixed(0) + '%</span>' +
              '<span class="barra" style="width:' + ancho.toFixed(0) + 'px"></span></span>';
  }
  var segundo = '';
  if (estado.conImpuestos && d.base != null && d.base !== d.final) segundo = '<div class="sombraTxt">Agoda: ' + fmt(d.base) + '</div>';
  else if (!estado.conImpuestos && d.final != null && d.base !== d.final) segundo = '<div class="sombraTxt">real: ' + fmt(d.final) + '</div>';

  return '<tr>' +
    '<td class="der n" style="color:var(--muted)">' + (i + 1) + '</td>' +
    '<td>' + (d.img ? '<img class="miniatura" loading="lazy" decoding="async" src="' + d.img + '" alt="">' : '<span class="miniatura"></span>') + '</td>' +
    '<td class="der"><span class="precio">' + fmt(precioDe(d)) + '</span>' + segundo + '</td>' +
    '<td class="der">' + recargo + '</td>' +
    (p.noches > 1 ? '<td class="der n">' + fmt(d.total) + '</td>' : '') +
    '<td class="der"><span class="evol">' + curva(d.hist) +
      '<span class="n ' + clase + '">' + (b == null ? '' : (b > 0 ? '+' : '') + b.toFixed(0) + '%') + '</span></span></td>' +
    (p.comparacion ? '<td class="der">' + (d.ayerPct == null ? '<span style="color:var(--muted)">—</span>' :
      '<span class="n ' + (d.ayerPct < -0.5 ? 'baja' : d.ayerPct > 0.5 ? 'sube' : 'plano') + '">' +
      (d.ayerPct > 0 ? '+' : '') + d.ayerPct.toFixed(0) + '%</span><div class="sombraTxt">' +
      (d.ayerBase === 'mejor' ? 'mejor ' : '') + fmt(d.ayer) + '</div>') + '</td>' : '') +
    '<td class="der"><span class="n" style="font-weight:600">' + (d.nota == null ? '–' : d.nota.toFixed(1)) + '</span>' +
      (d.reviews ? '<div class="sombraTxt">' + d.reviews + '</div>' : '') + '</td>' +
    '<td style="color:var(--muted)">' + esc(d.tipo) + '</td><td>' + esc(d.zona) + '</td>' +
    '<td><a href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer">' + esc(d.nombre) + '</a>' +
      '<button type="button" class="copiar" data-url="' + esc(d.url) + '" title="Copiar el link de Agoda">⧉</button>' +
      '<button type="button" class="tachar" data-tachar="' + esc(d.id) + '" title="No mostrarme mas este">' +
        (estaDescartado(d) ? '↩' : '✕') + '</button>' +
      etiquetasDe(d) + '</td>' +
  '</tr>';
}

function bandas() {
  var p = activa();
  var html = '<div class="meta" style="margin:2px 2px 10px">' + esc(p.ciudad) + ' · ' + esc(p.checkIn) + ' · ' +
    (p.noches > 1 ? p.noches + ' noches' : '1 noche') + ' · ' + p.huespedes + ' huéspedes · ' +
    p.datos.length + ' alojamientos' + (p.muestras ? ' · ' + p.muestras + ' muestras de precio' : '') + '</div>';

  html += '<div class="tesis">Agoda muestra en sus tarjetas el precio <b>sin impuestos</b>. Acá el orden es por <b>precio final</b>' +
    (p.recargoMax > 1 ? ', y el recargo llega al <b>' + p.recargoMax.toFixed(0) + '%</b> en esta búsqueda' : '') +
    ': el que parece más barato muchas veces no lo es.</div>';

  var cmp = p.comparacion;
  if (cmp) {
    var contra = cmp.piso && !cmp.aHora
      ? 'con <b>el precio más bajo que tocó cada uno la noche del ' + esc(cmp.checkIn) + '</b>'
      : cmp.piso
        ? 'con <b>la noche del ' + esc(cmp.checkIn) + '</b> (' + cmp.aHora + ' a la misma hora ~' + esc(cmp.hora) + ', ' + cmp.piso + ' contra el mejor precio de esa noche)'
        : 'con <b>la noche del ' + esc(cmp.checkIn) + '</b> a la misma hora (~' + esc(cmp.hora) + ')';
    var aclara = cmp.piso ? ' Ese mejor precio es el piso de toda la noche, así que esa parte tira para arriba; van con el borde punteado.' : '';
    html += '<div class="tesis ayer">Comparado ' + contra + ': <b>' + cmp.masBaratos + '</b> están más baratos, ' +
      cmp.masCaros + ' más caros, sobre ' + cmp.total + ' comparables.' + aclara + '</div>';
  }

  if (ENMARCADO) {
    html += '<div class="tesis nota">Esta página está embebida, y el navegador puede no dejarla abrir pestañas nuevas. ' +
      'Si al tocar una ficha no pasa nada, usá <b>Copiar link</b> y pegalo en una pestaña.</div>';
  }
  $('bandas').innerHTML = html;
  $('marcaAyer').hidden = !cmp;
}

function nombresDescartados() {
  return Object.keys(descartados);
}

function pintarBarraDesc() {
  var ids = nombresDescartados();
  var barra = $('barraDesc');
  barra.hidden = ids.length === 0;
  if (!ids.length) return;

  var html = '<span><b>' + ids.length + '</b> descartado' + (ids.length > 1 ? 's' : '') + '</span>' +
    '<button type="button" id="dVer">' + (verDescartados ? 'ocultarlos' : 'verlos') + '</button>' +
    (ultimoDescartado ? '<button type="button" id="dDeshacer">traer el último</button>' : '') +
    '<button type="button" id="dCopiar" title="Para que no vuelvan aunque cambies de navegador">copiar comando</button>';
  if (!guardaDeVerdad) {
    html += '<span class="aviso">Acá no se guardan: si recargás, vuelven. Copiá el comando.</span>';
  }
  barra.innerHTML = html;

  $('dVer').addEventListener('click', function () { verDescartados = !verDescartados; pintar(); });
  var deshacer = $('dDeshacer');
  if (deshacer) deshacer.addEventListener('click', function () {
    delete descartados[ultimoDescartado];
    ultimoDescartado = null;
    guardarDescartados(); pintar();
  });
  $('dCopiar').addEventListener('click', function (ev) {
    copiarYAvisar('node bin/agoda.mjs descartar ' + nombresDescartados().join(' '), ev.currentTarget);
  });
}

function tachar(id) {
  var clave = String(id);
  if (Object.prototype.hasOwnProperty.call(descartados, clave)) {
    delete descartados[clave];
    if (ultimoDescartado === clave) ultimoDescartado = null;
  } else {
    var d = activa().datos.filter(function (x) { return String(x.id) === clave; })[0];
    descartados[clave] = d ? d.nombre : '';
    ultimoDescartado = clave;
  }
  guardarDescartados();
  pintar();

  var cuantos = nombresDescartados().length;
  if (!cuantos) return avisar('Vuelve a aparecer.', true);
  avisar(guardaDeVerdad
    ? 'Descartado. Van ' + cuantos + '.'
    : 'Descartado (' + cuantos + '), pero este visor no guarda: si recargás, vuelven. Usá "copiar comando".');
}

function pintar() {
  var p = activa();
  var f = ordenados();
  var barato = null, recargoAca = 0;
  for (var i = 0; i < f.length; i++) {
    var v = precioDe(f[i]);
    if (v != null && (barato == null || v < barato)) barato = v;
    if (f[i].impPct != null && f[i].impPct > recargoAca) recargoAca = f[i].impPct;
  }
  $('resumen').innerHTML =
    '<span><span class="grande">' + f.length + '</span> de ' + p.datos.length + ' alojamientos</span>' +
    (barato != null ? '<span>más barato <span class="verde">' + fmt(barato) + ' ' + p.moneda + '</span></span>' : '') +
    (recargoAca > 1 ? '<span>recargo más alto acá: <span class="n" style="color:var(--markup);font-weight:600">+' + recargoAca.toFixed(0) + '%</span></span>' : '');

  var fichas = estado.vista === 'fichas';
  $('rejilla').hidden = !fichas || !f.length;
  $('marco').hidden = fichas || !f.length;
  $('nada').hidden = f.length > 0;

  if (fichas) { $('rejilla').innerHTML = f.map(ficha).join(''); $('cuerpoTabla').innerHTML = ''; }
  else { cabeceraTabla(); $('cuerpoTabla').innerHTML = f.map(fila).join(''); $('rejilla').innerHTML = ''; }
  pintarBarraDesc();
  guardar();
}

function sincronizar() {
  document.querySelectorAll('.chip[data-grupo]').forEach(function (ch) {
    var sel = estado[ch.dataset.grupo].indexOf(ch.dataset.valor) >= 0;
    ch.setAttribute('aria-pressed', sel ? 'true' : 'false');
    if (sel) ch.classList.remove('escondido');
  });
  document.querySelectorAll('.solapa').forEach(function (s) {
    s.setAttribute('aria-pressed', s.dataset.pestana === estado.pestana ? 'true' : 'false');
  });
  $('fmax').value = estado.max == null ? '' : estado.max;
  $('fnota').value = estado.nota == null ? '' : estado.nota;
  $('frev').value = estado.reviews == null ? '' : estado.reviews;
  $('ftexto').value = estado.texto;
  $('fcanc').checked = estado.canc;
  $('fbaja').checked = estado.baja;
  $('fayer').checked = estado.mejorQueAyer;
  $('forden').value = estado.orden;
  $('fsentido').textContent = estado.asc ? '↑ menor primero' : '↓ mayor primero';
  $('mFinal').setAttribute('aria-pressed', estado.conImpuestos ? 'true' : 'false');
  $('mBase').setAttribute('aria-pressed', estado.conImpuestos ? 'false' : 'true');
  $('vFichas').setAttribute('aria-pressed', estado.vista === 'fichas' ? 'true' : 'false');
  $('vLista').setAttribute('aria-pressed', estado.vista === 'lista' ? 'true' : 'false');
}

document.querySelectorAll('.solapa').forEach(function (s) {
  s.addEventListener('click', function () {
    estado.pestana = s.dataset.pestana;
    sincronizar(); bandas(); pintar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

document.querySelectorAll('.chip[data-grupo]').forEach(function (ch) {
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
$('fayer').addEventListener('change', function () { estado.mejorQueAyer = this.checked; pintar(); });
$('forden').addEventListener('change', function () { estado.orden = this.value; pintar(); });
$('fsentido').addEventListener('click', function () { estado.asc = !estado.asc; sincronizar(); pintar(); });
$('mFinal').addEventListener('click', function () { estado.conImpuestos = true; sincronizar(); pintar(); });
$('mBase').addEventListener('click', function () { estado.conImpuestos = false; sincronizar(); pintar(); });
$('vFichas').addEventListener('click', function () { estado.vista = 'fichas'; sincronizar(); pintar(); });
$('vLista').addEventListener('click', function () { estado.vista = 'lista'; sincronizar(); pintar(); });

$('preset').addEventListener('click', function () {
  estado.tipos = ${JSON.stringify(estadoInicial.tipos)}.slice();
  estado.zonas = ${JSON.stringify(estadoInicial.zonas)}.slice();
  sincronizar(); pintar();
});
$('limpiar').addEventListener('click', function () {
  estado = Object.assign({}, VACIO, {
    pestana: estado.pestana, conImpuestos: estado.conImpuestos, vista: estado.vista,
    orden: estado.orden, asc: estado.asc,
  });
  sincronizar(); pintar();
});

var verZonas = $('verZonas');
if (verZonas) {
  var todas = [].slice.call(document.querySelectorAll('#filaZonas .chip'));
  var plegado = true;
  var plegar = function () {
    todas.forEach(function (ch, i) {
      ch.classList.toggle('escondido', plegado && i >= 14 && ch.getAttribute('aria-pressed') !== 'true');
    });
    verZonas.textContent = plegado ? 'ver todas' : 'ver menos';
  };
  plegar();
  verZonas.addEventListener('click', function () { plegado = !plegado; plegar(); });
}

/*
 * Los links son anclas nativas y nadie intercepta el click cuando la pagina esta
 * suelta. Enmarcada, probamos window.open sin noopener (con noopener devuelve
 * null aunque haya abierto) y, si no sale, copiamos la direccion.
 */
function copiarAlPortapapeles(texto) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(texto).then(function () { return true; }).catch(function () { return viejoCopiar(texto); });
  }
  return Promise.resolve(viejoCopiar(texto));
}
function viejoCopiar(texto) {
  var campo = document.createElement('textarea');
  campo.value = texto;
  campo.setAttribute('readonly', '');
  campo.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(campo);
  campo.select();
  var listo = false;
  try { listo = document.execCommand('copy'); } catch (e) { listo = false; }
  campo.remove();
  return listo;
}
function avisar(texto, ok) {
  var vieja = $('aviso');
  if (vieja) vieja.remove();
  var caja = document.createElement('div');
  caja.id = 'aviso';
  caja.className = 'aviso' + (ok ? ' bien' : '');
  caja.setAttribute('role', 'status');
  caja.textContent = texto;
  document.body.appendChild(caja);
  setTimeout(function () { caja.remove(); }, 3200);
}
function copiarYAvisar(url, boton) {
  return copiarAlPortapapeles(url).then(function (listo) {
    if (boton) {
      var antes = boton.textContent;
      boton.textContent = listo ? '✓ copiado' : '✕';
      boton.classList.toggle('copiado', listo);
      setTimeout(function () { boton.textContent = antes; boton.classList.remove('copiado'); }, 1600);
    }
    if (listo) avisar('Link copiado. Pegalo en una pestaña nueva.', true);
    else window.prompt('Copiá el link a mano:', url);
    return listo;
  });
}
document.addEventListener('click', function (ev) {
  var cruz = ev.target.closest ? ev.target.closest('.tachar') : null;
  if (cruz) {
    ev.preventDefault(); ev.stopPropagation();
    return tachar(cruz.dataset.tachar);
  }
  var boton = ev.target.closest ? ev.target.closest('.copiar') : null;
  if (boton) {
    ev.preventDefault(); ev.stopPropagation();
    return copiarYAvisar(boton.dataset.url, boton);
  }
  if (!ENMARCADO) return;
  var a = ev.target.closest ? ev.target.closest('a[target="_blank"]') : null;
  if (!a || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  ev.preventDefault();
  var abierta = null;
  try { abierta = window.open(a.getAttribute('href'), '_blank'); } catch (e) { abierta = null; }
  if (!abierta) copiarYAvisar(a.getAttribute('href'), null);
});

sincronizar();
bandas();
pintar();
</script>`;

  if (fragmento) return `<title>${escHtml(nombre ?? tituloPagina)}</title>${ESTILOS}${CUERPO}${GUION}`;

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(tituloPagina)} — precio final Agoda</title>
${ESTILOS}
</head><body>${CUERPO}${GUION}</body></html>`;
}

export { sparkline, haceCuanto };
