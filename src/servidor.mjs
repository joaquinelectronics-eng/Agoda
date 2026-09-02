// Un servidor estatico chiquito para mirar la pagina desde el celular cuando el
// seguimiento corre en un servidor. Sin dependencias: es solo node:http.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Que sirve la raiz "/": hoy.html si esta, si no el html mas nuevo. Se resuelve
 * en cada pedido y no al arrancar, porque la tarea de cada hora reescribe el
 * archivo y puede incluso crearlo despues de que el servidor ya estaba andando.
 */
export function portada(raiz) {
  if (fs.existsSync(path.join(raiz, 'hoy.html'))) return 'hoy.html';
  let mejor = null;
  let cuando = -1;
  for (const nombre of fs.readdirSync(raiz)) {
    if (!nombre.endsWith('.html')) continue;
    const m = fs.statSync(path.join(raiz, nombre)).mtimeMs;
    if (m > cuando) { cuando = m; mejor = nombre; }
  }
  return mejor;
}

/**
 * Resuelve un pedido a un archivo dentro de la carpeta, o null si se sale de
 * ella. Sin esto, un pedido a /../../etc/passwd leeria cualquier cosa del disco.
 */
export function resolverRuta(raiz, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null; // porcentajes rotos en la URL
  }
  if (rel.includes('\0')) return null;
  const destino = path.resolve(raiz, '.' + (rel.startsWith('/') ? rel : `/${rel}`));
  if (destino !== raiz && !destino.startsWith(raiz + path.sep)) return null;
  return destino;
}

export function crearServidor({ carpeta, clave = null, alPedido = null }) {
  const raiz = path.resolve(carpeta);

  return http.createServer((req, res) => {
    const responder = (codigo, cuerpo, tipo = 'text/plain; charset=utf-8') => {
      res.writeHead(codigo, { 'content-type': tipo, 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : cuerpo);
      if (alPedido) alPedido(codigo, req.method, req.url);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') return responder(405, 'Solo GET.');

    const u = new URL(req.url, 'http://localhost');
    if (clave && u.searchParams.get('k') !== clave) return responder(403, 'Falta la clave.');

    let pathname = u.pathname;
    if (pathname === '/' || pathname === '') {
      const tapa = portada(raiz);
      if (!tapa) return responder(404, 'Todavia no hay ninguna pagina generada.');
      pathname = `/${tapa}`;
    }

    const destino = resolverRuta(raiz, pathname);
    if (!destino) return responder(403, 'Fuera de la carpeta.');
    if (!fs.existsSync(destino) || !fs.statSync(destino).isFile()) return responder(404, 'No esta.');

    // El html lo reescribe la tarea de cada hora: nada de cache, si no el
    // celular te sigue mostrando la version vieja.
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(destino).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': fs.statSync(destino).size,
    });
    if (req.method === 'HEAD') { res.end(); if (alPedido) alPedido(200, req.method, req.url); return; }
    fs.createReadStream(destino).pipe(res).on('finish', () => alPedido?.(200, req.method, req.url));
  });
}
