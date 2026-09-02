import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { descartar, recuperar, leerDescartados, idsDescartados, sinDescartados } from '../src/descartados.mjs';

function archivoTemporal() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agoda-desc-')), 'descartados.json');
}

test('descartar agrega, no duplica, y recuperar saca', () => {
  const ruta = archivoTemporal();

  const nuevos = descartar([{ id: 111, nombre: 'Depto feo' }, { id: 222 }], ruta);
  assert.deepEqual(nuevos, ['111', '222']);

  const otra = descartar([{ id: 111, nombre: 'Depto feo' }, { id: 333 }], ruta);
  assert.deepEqual(otra, ['333'], 'el que ya estaba no se cuenta de nuevo');

  const lista = leerDescartados(ruta);
  assert.equal(Object.keys(lista).length, 3);
  assert.equal(lista['111'].nombre, 'Depto feo');
  assert.ok(lista['111'].cuando, 'queda cuando lo descartaste');

  assert.deepEqual(recuperar([222, 999], ruta), ['222'], 'solo el que estaba');
  assert.deepEqual(Object.keys(leerDescartados(ruta)).sort(), ['111', '333']);
});

test('lo que no es un id se ignora', () => {
  const ruta = archivoTemporal();
  assert.deepEqual(descartar(['', 'abc', '12a', {}, { id: 'x' }], ruta), []);
  assert.equal(fs.existsSync(ruta), false, 'ni siquiera crea el archivo');
});

test('un archivo ilegible no rompe nada', () => {
  const ruta = archivoTemporal();
  fs.writeFileSync(ruta, '{ esto no es json');
  assert.deepEqual(leerDescartados(ruta), {});
  assert.deepEqual([...idsDescartados(ruta)], []);

  // Y se puede volver a escribir encima.
  assert.deepEqual(descartar([444], ruta), ['444']);
  assert.deepEqual([...idsDescartados(ruta)], [444]);
});

test('sinDescartados saca las filas, con cualquiera de los dos nombres de campo', () => {
  const filas = [
    { property_id: 1, nombre: 'uno' },
    { propertyId: 2, nombre: 'dos' },
    { property_id: 3, nombre: 'tres' },
  ];
  assert.deepEqual(sinDescartados(filas, new Set()).length, 3, 'sin descartados no toca nada');
  assert.deepEqual(sinDescartados(filas, new Set([2])).map((f) => f.nombre), ['uno', 'tres']);
  assert.deepEqual(sinDescartados(filas, new Set([1, 3])).map((f) => f.nombre), ['dos']);
});
