// Utilidades chicas compartidas por todo el proyecto.

const HAS_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;

const CODES = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

export function c(style, text) {
  if (!HAS_COLOR || !CODES[style]) return String(text);
  return CODES[style] + text + CODES.reset;
}

export const log = (...a) => console.log(...a);
export const warn = (...a) => console.error(c('yellow', '! ') + a.join(' '));
export const die = (msg) => { console.error(c('red', 'Error: ') + msg); process.exit(1); };

// --- fechas -----------------------------------------------------------------

/** Fecha local (no UTC) en formato YYYY-MM-DD. */
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return isoDate(dt);
}

/**
 * Acepta: hoy, manana/mañana, pasado, +3, viernes, 2026-09-05, 05/09, 5-9.
 * Devuelve YYYY-MM-DD.
 */
export function parseFecha(input, hoy = isoDate()) {
  if (!input) return hoy;
  const s = String(input).trim().toLowerCase();
  if (s === 'hoy' || s === 'today') return hoy;
  if (s === 'manana' || s === 'mañana' || s === 'tomorrow') return addDays(hoy, 1);
  if (s === 'pasado' || s === 'pasadomanana') return addDays(hoy, 2);
  if (/^\+\d+$/.test(s)) return addDays(hoy, Number(s.slice(1)));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const idx = dias.indexOf(s.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  if (idx >= 0) {
    const [y, m, d] = hoy.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    const delta = (idx - base.getDay() + 7) % 7 || 7;
    return addDays(hoy, delta);
  }

  const dm = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (dm) {
    const [, d, m, yy] = dm;
    const year = yy ? (yy.length === 2 ? 2000 + Number(yy) : Number(yy)) : Number(hoy.slice(0, 4));
    const cand = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    // Si ya paso este año y no aclararon el año, asumimos el que viene.
    return (!yy && cand < hoy) ? `${year + 1}${cand.slice(4)}` : cand;
  }
  throw new Error(`No entiendo la fecha "${input}". Usa hoy, manana, +3, viernes, 05/09 o 2026-09-05.`);
}

export function ahoraISO() { return new Date().toISOString(); }

/** "hace 2 h 15 min" a partir de un timestamp ISO. */
export function haceCuanto(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'recien';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recien';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h ${min % 60} min`;
  const d = Math.floor(h / 24);
  return `hace ${d} d ${h % 24} h`;
}

export function horaCorta(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// --- numeros ----------------------------------------------------------------

export function fmtPrecio(n, moneda = '') {
  if (n == null || Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  const dec = abs >= 1000 ? 0 : abs >= 100 ? 0 : 2;
  const s = n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return moneda ? `${s} ${moneda}` : s;
}

export function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '-';
  const s = `${n > 0 ? '+' : ''}${n.toFixed(0)}%`;
  return s;
}

export function num(v, def = undefined) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isNaN(n) ? def : n;
}

/** Distancia en km entre dos puntos (haversine). */
export function distanciaKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null)) return null;
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// --- texto ------------------------------------------------------------------

/** Minusculas y sin acentos, para comparar zonas y nombres sin volverse loco. */
export function normalizar(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Codigos de color y de hipervinculo (OSC 8): ocupan bytes, no columnas.
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g;

export function anchoVisible(s) {
  return String(s ?? '').replace(ANSI, '').length;
}

export function tieneAnsi(s) {
  ANSI.lastIndex = 0;
  return ANSI.test(String(s ?? ''));
}

export function recortar(s, n) {
  const t = String(s ?? '');
  if (tieneAnsi(t)) return t;            // ya venia armado; cortarlo romperia los codigos
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// --- tabla ------------------------------------------------------------------

/**
 * Tabla alineada por columnas.
 * cols: [{ key, title, align, width, color }]
 */
export function tabla(filas, cols) {
  if (!filas.length) return c('gray', '  (sin resultados)');
  const anchos = cols.map((col) => {
    const max = Math.max(col.title.length, ...filas.map((f) => anchoVisible(f[col.key])));
    return col.width ? Math.min(max, col.width) : max;
  });
  const linea = (celdas, styler) =>
    '  ' + celdas.map((v, i) => {
      const txt = recortar(String(v ?? ''), anchos[i]);
      const relleno = ' '.repeat(Math.max(0, anchos[i] - anchoVisible(txt)));
      const pad = cols[i].align === 'right' ? relleno + txt : txt + relleno;
      return styler ? styler(pad, cols[i], i) : pad;
    }).join('  ').trimEnd();

  const out = [];
  out.push(linea(cols.map((x) => x.title), (t) => c('bold', t)));
  out.push('  ' + c('gray', anchos.map((a) => '─'.repeat(a)).join('  ')));
  for (const f of filas) {
    out.push(linea(cols.map((col) => f[col.key]), (t, col) => {
      const style = typeof col.color === 'function' ? col.color(f) : col.color;
      return style ? c(style, t) : t;
    }));
  }
  return out.join('\n');
}

/** Mini grafico de barras con bloques unicode para el historial. */
export function sparkline(valores) {
  const v = valores.filter((x) => x != null && !Number.isNaN(x));
  if (v.length < 2) return '';
  const chars = '▁▂▃▄▅▆▇█';
  const min = Math.min(...v), max = Math.max(...v);
  if (max === min) return chars[3].repeat(v.length);
  return v.map((x) => chars[Math.round(((x - min) / (max - min)) * (chars.length - 1))]).join('');
}
