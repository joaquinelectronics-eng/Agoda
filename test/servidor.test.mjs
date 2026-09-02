import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolverRuta, portada, crearServidor } from '../src/servidor.mjs';

function carpetaTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agoda-web-'));
}

test('resolverRuta no deja salir de la carpeta', () => {
  const raiz = path.resolve('/srv/reportes');

  assert.equal(resolverRuta(raiz, '/hoy.html'), path.join(raiz, 'hoy.html'));
  assert.equal(resolverRuta(raiz, '/sub/dir/a.png'), path.join(raiz, 'sub/dir/a.png'));

  // Lo que importa: nada de esto puede devolver una ruta de afuera.
  for (const intento of [
    '/../etc/passwd',
    '/../../etc/passwd',
    '/sub/../../etc/passwd',
    '/%2e%2e/etc/passwd',       // ya viene decodificado desde la URL
    '/..%2f..%2fetc/passwd',
    '/./../../etc/passwd',
  ]) {
    const r = resolverRuta(raiz, decodeURIComponent(intento));
    assert.ok(r === null || r === raiz || r.startsWith(raiz + path.sep),
      `${intento} se escapo a ${r}`);
  }

  assert.equal(resolverRuta(raiz, '/mal\0.html'), null, 'byte nulo');
  assert.equal(resolverRuta(raiz, '/%ZZ'), null, 'porcentaje roto');
});

test('la portada es hoy.html, y si no el html mas nuevo', () => {
  const dir = carpetaTemporal();
  assert.equal(portada(dir), null, 'todavia no hay nada');

  fs.writeFileSync(path.join(dir, 'viejo.html'), 'a');
  fs.utimesSync(path.join(dir, 'viejo.html'), new Date(1e9), new Date(1e9));
  fs.writeFileSync(path.join(dir, 'nuevo.html'), 'b');
  assert.equal(portada(dir), 'nuevo.html');

  fs.writeFileSync(path.join(dir, 'hoy.html'), 'c');
  assert.equal(portada(dir), 'hoy.html', 'hoy.html gana aunque no sea el mas nuevo');
});

test('el servidor sirve la pagina y no lo de afuera', async () => {
  const padre = carpetaTemporal();
  const raiz = path.join(padre, 'reportes');
  fs.mkdirSync(raiz);
  fs.writeFileSync(path.join(raiz, 'hoy.html'), '<h1>hola</h1>');
  fs.writeFileSync(path.join(padre, 'secreto.txt'), 'esto no se puede ver');

  const servidor = crearServidor({ carpeta: raiz });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const raizResp = await fetch(`${base}/`);
    assert.equal(raizResp.status, 200);
    assert.equal(raizResp.headers.get('cache-control'), 'no-store', 'si cachea, el celular te muestra la version vieja');
    assert.equal(await raizResp.text(), '<h1>hola</h1>');

    const afuera = await fetch(`${base}/%2e%2e/secreto.txt`);
    assert.notEqual(afuera.status, 200, 'llego a un archivo de afuera de la carpeta');

    assert.equal((await fetch(`${base}/no-esta.html`)).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally {
    servidor.close();
  }
});

test('con clave, sin clave no se ve', async () => {
  const raiz = carpetaTemporal();
  fs.writeFileSync(path.join(raiz, 'hoy.html'), 'ok');

  const servidor = crearServidor({ carpeta: raiz, clave: 'melon' });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    assert.equal((await fetch(`${base}/`)).status, 403);
    assert.equal((await fetch(`${base}/?k=otra`)).status, 403);
    assert.equal((await fetch(`${base}/?k=melon`)).status, 200);
  } finally {
    servidor.close();
  }
});
