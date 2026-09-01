// Miniaturas: los CDN de Agoda sirven versiones chicas, y a veces hace falta
// incrustar las fotos dentro del HTML (por ejemplo para publicarlo o verlo sin red).

import { c } from './util.mjs';

/**
 * Reescribe la URL de una foto a una miniatura del ancho pedido.
 * Una tarjeta de 58px se ve en 116px en pantallas retina, asi que 120 alcanza.
 * Bajar la original serie 40 veces mas pesado.
 */
export function miniatura(url, ancho = 120) {
  if (!url) return null;
  try {
    const u = new URL(url);

    // pix8/pix1... .agoda.net acepta ?s=<ancho>x<alto>
    if (/(^|\.)agoda\.net$/.test(u.hostname)) {
      u.searchParams.set('s', `${ancho}x${Math.round((ancho * 3) / 4)}`);
      return u.toString();
    }

    // bstatic.com codifica el tamano en la ruta: /hotel/max500/foto.jpg
    if (/(^|\.)bstatic\.com$/.test(u.hostname)) {
      const escalon = ancho <= 100 ? 'max100' : ancho <= 150 ? 'max150' : ancho <= 200 ? 'max200'
        : ancho <= 300 ? 'max300' : ancho <= 400 ? 'max400' : 'max500';
      u.pathname = u.pathname.replace(/\/(max|square)\d+\//, `/${escalon}/`);
      return u.toString();
    }

    return url; // host desconocido: la dejamos como vino
  } catch {
    return url;
  }
}

const MAX_BYTES = 400 * 1024; // una miniatura nunca deberia pesar esto

async function bajarUna(url, timeoutMs) {
  const corte = AbortSignal.timeout(timeoutMs);
  const r = await fetch(url, { signal: corte, headers: { accept: 'image/*' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const tipo = r.headers.get('content-type') ?? 'image/jpeg';
  if (!tipo.startsWith('image/')) throw new Error(`no es imagen (${tipo})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error('demasiado pesada');
  return `data:${tipo.split(';')[0]};base64,${buf.toString('base64')}`;
}

/**
 * Baja las fotos y las devuelve como data: URI, en un Map url -> dataUri.
 * Las que fallan quedan afuera y la pagina muestra el recuadro vacio.
 */
export async function incrustar(urls, { concurrencia = 12, timeoutMs = 15_000, alProgreso = null } = {}) {
  const pendientes = [...new Set(urls.filter(Boolean))];
  const salida = new Map();
  let hechas = 0, fallidas = 0, bytes = 0;
  let i = 0;

  const obrero = async () => {
    while (i < pendientes.length) {
      const url = pendientes[i++];
      try {
        const dato = await bajarUna(url, timeoutMs);
        salida.set(url, dato);
        bytes += dato.length;
      } catch {
        fallidas++;
      }
      hechas++;
      if (alProgreso && hechas % 25 === 0) alProgreso(hechas, pendientes.length, fallidas);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrencia, pendientes.length) }, obrero));
  if (alProgreso) alProgreso(hechas, pendientes.length, fallidas);
  return { fotos: salida, total: pendientes.length, fallidas, bytes };
}

export function avisoProxy() {
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    return c('yellow', '! Hay un HTTPS_PROXY configurado. Si las fotos fallan, corre con NODE_USE_ENV_PROXY=1');
  }
  return null;
}
