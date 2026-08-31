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

/**
 * Reporte autocontenido: tabla ordenable y filtrable en el navegador,
 * con la curva de precio de cada alojamiento.
 */
export function reporteHtml(filas, { busqueda, historiales = {}, generado = new Date() } = {}) {
  const datos = filas.map((f) => ({
    id: f.property_id ?? f.propertyId,
    nombre: f.nombre,
    precio: f._precio,
    total: f.total,
    inicial: f.precio_inicial ?? null,
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
    libres: f.habitaciones_libres ?? null,
    dist: f._distancia ?? null,
    hist: (historiales[f.property_id ?? f.propertyId] ?? []).map((p) => p.por_noche),
  }));

  const noches = Number(busqueda?.los ?? 1);
  const verTotal = noches > 1;
  const titulo = busqueda
    ? `${busqueda.ciudad ?? 'Agoda'} · ${busqueda.check_in ?? busqueda.checkIn} · ${noches} noche${noches > 1 ? 's' : ''}`
    : 'Agoda';

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(titulo)} — precios Agoda</title>
<style>
  :root{ --bg:#f7f7f5; --card:#fff; --tx:#1c1c1a; --mut:#6b6b66; --bd:#e4e4e0; --ok:#0a7d43; --bad:#b3261e; --ac:#2b6cb0; }
  @media (prefers-color-scheme:dark){ :root{ --bg:#16161a; --card:#1e1e24; --tx:#ececea; --mut:#9a9a95; --bd:#32323a; --ok:#4ade80; --bad:#f87171; --ac:#7cb0e8; } }
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  header{padding:20px 24px 12px;max-width:1400px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px} .sub{color:var(--mut);font-size:13px}
  .barra{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--bd);padding:12px 24px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .barra label{font-size:12px;color:var(--mut);display:flex;flex-direction:column;gap:3px}
  input,select{background:var(--card);color:var(--tx);border:1px solid var(--bd);border-radius:6px;padding:5px 8px;font:inherit;font-size:13px}
  input[type=number]{width:96px} input[type=search]{width:190px}
  .wrap{max-width:1400px;margin:0 auto;padding:0 24px 48px;overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13px;min-width:900px}
  th{text-align:left;font-weight:600;color:var(--mut);border-bottom:1px solid var(--bd);padding:8px 10px;cursor:pointer;white-space:nowrap;user-select:none}
  th:hover{color:var(--tx)} th.on{color:var(--ac)}
  td{border-bottom:1px solid var(--bd);padding:8px 10px;vertical-align:middle}
  tr:hover td{background:var(--card)}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .precio{font-weight:600;color:var(--ok);font-size:15px}
  .baja{color:var(--ok);font-weight:600} .sube{color:var(--bad)}
  .th{width:54px;height:40px;object-fit:cover;border-radius:5px;background:var(--bd)}
  a{color:var(--ac);text-decoration:none} a:hover{text-decoration:underline}
  .chip{display:inline-block;font-size:11px;color:var(--mut);border:1px solid var(--bd);border-radius:99px;padding:1px 7px;margin-left:6px}
  .vacio{padding:40px;text-align:center;color:var(--mut)}
  footer{max-width:1400px;margin:0 auto;padding:0 24px 32px;color:var(--mut);font-size:12px}
</style></head><body>
<header><h1>${escHtml(titulo)}</h1>
<div class="sub">${datos.length} alojamientos · generado ${escHtml(generado.toLocaleString('es-AR'))}${busqueda?.moneda ? ` · precios por noche en ${escHtml(busqueda.moneda)}` : ''}</div></header>
<div class="barra">
  <label>precio máx<input type="number" id="fmax" placeholder="sin tope"></label>
  <label>nota mín<input type="number" id="fnota" step="0.1" placeholder="0"></label>
  <label>reviews mín<input type="number" id="frev" placeholder="0"></label>
  <label>tipo<select id="ftipo"><option value="">todos</option></select></label>
  <label>zona<select id="fzona"><option value="">todas</option></select></label>
  <label>buscar<input type="search" id="ftexto" placeholder="nombre..."></label>
  <label>&nbsp;<span><input type="checkbox" id="fcanc"> solo cancelación gratis</span></label>
  <label>&nbsp;<span><input type="checkbox" id="fbaja"> solo los que bajaron</span></label>
</div>
<div class="wrap"><table id="t"><thead><tr>
  <th data-k="_i" class="num">#</th><th></th>
  <th data-k="precio" class="num on">precio ▲</th>
  ${verTotal ? `<th data-k="total" class="num">total ${noches}n</th>` : ''}
  <th data-k="bajadaPct" class="num">bajó</th>
  <th data-k="_hist">historial</th>
  <th data-k="nota" class="num">nota</th>
  <th data-k="reviews" class="num">reviews</th>
  <th data-k="tipo">tipo</th><th data-k="zona">zona</th><th data-k="nombre">alojamiento</th>
</tr></thead><tbody id="b"></tbody></table><div class="vacio" id="vacio" hidden>Nada coincide con los filtros.</div></div>
<footer>Datos extraídos de Agoda. Los precios cambian solos: verificá siempre en el sitio antes de reservar.</footer>
<script>
const DATOS = ${JSON.stringify(datos)};
const VER_TOTAL = ${verTotal};
const $ = (id) => document.getElementById(id);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();

for (const [sel, campo] of [['ftipo','tipo'],['fzona','zona']]) {
  const vals = [...new Set(DATOS.map(d => d[campo]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  for (const v of vals) { const o = document.createElement('option'); o.value = v; o.textContent = v; $(sel).append(o); }
}

let orden = 'precio', asc = true;
function spark(h){
  if(!h || h.length < 2) return '';
  const w=70,ht=18,mn=Math.min(...h),mx=Math.max(...h),r=(mx-mn)||1;
  const pts=h.map((v,i)=>[(i/(h.length-1))*w, ht-((v-mn)/r)*(ht-3)-1.5]);
  const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const col=h.at(-1)<h[0]?'var(--ok)':h.at(-1)>h[0]?'var(--bad)':'var(--mut)';
  return '<svg width="'+w+'" height="'+ht+'" aria-hidden="true"><path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.5"/></svg>';
}
const fmt = (n) => n==null ? '' : n.toLocaleString('es-AR',{maximumFractionDigits: Math.abs(n)>=1000?0:2});

function pintar(){
  const max=parseFloat($('fmax').value), nota=parseFloat($('fnota').value), rev=parseFloat($('frev').value);
  const tipo=$('ftipo').value, zona=$('fzona').value, txt=norm($('ftexto').value);
  const canc=$('fcanc').checked, baja=$('fbaja').checked;
  let f = DATOS.filter(d =>
    (isNaN(max) || (d.precio!=null && d.precio<=max)) &&
    (isNaN(nota) || (d.nota!=null && d.nota>=nota)) &&
    (isNaN(rev) || d.reviews>=rev) &&
    (!tipo || d.tipo===tipo) && (!zona || d.zona===zona) &&
    (!txt || norm(d.nombre).includes(txt)) &&
    (!canc || d.canc===1) && (!baja || (d.bajadaPct!=null && d.bajadaPct < -0.5)));
  f.sort((a,b)=>{
    let x=a[orden], y=b[orden];
    if(typeof x==='string'||typeof y==='string') return String(x??'').localeCompare(String(y??''),'es')*(asc?1:-1);
    if(x==null) return 1; if(y==null) return -1;
    return (x-y)*(asc?1:-1);
  });
  $('b').innerHTML = f.map((d,i)=>{
    const b = d.bajadaPct;
    const cls = b==null?'':b<-0.5?'baja':b>0.5?'sube':'';
    return '<tr>'+
      '<td class="num">'+(i+1)+'</td>'+
      '<td>'+(d.img?'<img class="th" loading="lazy" src="'+d.img+'" alt="">':'<div class="th"></div>')+'</td>'+
      '<td class="num precio">'+fmt(d.precio)+'</td>'+
      (VER_TOTAL ? '<td class="num">'+fmt(d.total)+'</td>' : '')+
      '<td class="num '+cls+'">'+(b==null?'':(b>0?'+':'')+b.toFixed(0)+'%')+'</td>'+
      '<td>'+spark(d.hist)+'</td>'+
      '<td class="num">'+(d.nota==null?'':d.nota.toFixed(1))+'</td>'+
      '<td class="num">'+(d.reviews||'')+'</td>'+
      '<td>'+d.tipo+'</td><td>'+d.zona+'</td>'+
      '<td>'+(d.url?'<a href="'+d.url+'" target="_blank" rel="noopener">'+d.nombre+'</a>':d.nombre)+
        (d.canc?'<span class="chip">cancelación gratis</span>':'')+
        (d.libres!=null&&d.libres<=3?'<span class="chip">quedan '+d.libres+'</span>':'')+'</td>'+
    '</tr>';
  }).join('');
  $('vacio').hidden = f.length>0;
}
document.querySelectorAll('th[data-k]').forEach(th=>th.addEventListener('click',()=>{
  const k=th.dataset.k; if(k==='_i'||k==='_hist') return;
  if(orden===k) asc=!asc; else { orden=k; asc = !['nota','reviews'].includes(k); }
  document.querySelectorAll('th').forEach(x=>{x.classList.remove('on');x.textContent=x.textContent.replace(/ [▲▼]$/,'')});
  th.classList.add('on'); th.textContent += asc?' ▲':' ▼';
  pintar();
}));
['fmax','fnota','frev','ftipo','fzona','ftexto','fcanc','fbaja'].forEach(id=>{
  $(id).addEventListener('input', pintar); $(id).addEventListener('change', pintar);
});
pintar();
</script></body></html>`;
}

export { sparkline, haceCuanto };
