import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsDeTipo, filtrar, ordenar, enriquecer, notaAjustada, parsearCoords } from '../src/filtros.mjs';

const filas = [
  { property_id: 1, nombre: 'Depto Palermo', por_noche: 50, total: 50, tipo_id: 29, zona: 'Palermo', nota: 9.0, reviews: 200, estrellas: 3, disponible: 1, lat: -34.588, lon: -58.430, cancelacion: 'FreeCancellation' },
  { property_id: 2, nombre: 'Hotel Centro', por_noche: 30, total: 30, tipo_id: 34, zona: 'San Nicolás', nota: 7.0, reviews: 900, estrellas: 2, disponible: 1, lat: -34.604, lon: -58.381, cancelacion: 'NonRefundable' },
  { property_id: 3, nombre: 'Casa Boedo', por_noche: 80, total: 80, tipo_id: 131, zona: 'Boedo', nota: 9.9, reviews: 2, estrellas: 4, disponible: 1, lat: -34.630, lon: -58.415, cancelacion: 'NonRefundable' },
  { property_id: 4, nombre: 'Sin stock', por_noche: null, tipo_id: 29, zona: 'Palermo', nota: 8, reviews: 10, disponible: 0, lat: -34.58, lon: -58.43 },
];

test('idsDeTipo entiende alias, ids y "todos"', () => {
  assert.deepEqual([...idsDeTipo('depto')], [29, 120]);
  assert.ok(idsDeTipo('depto,hostel').has(33));
  assert.ok(idsDeTipo('29,34').has(34));
  assert.equal(idsDeTipo('todos'), null);
  assert.equal(idsDeTipo(undefined), null);
  assert.throws(() => idsDeTipo('chalet'), /Tipo desconocido/);
});

test('por defecto descarta lo que no tiene precio o stock', () => {
  const r = filtrar(filas, {});
  assert.deepEqual(r.map((f) => f.property_id), [1, 2, 3]);
});

test('--todos incluye lo no disponible', () => {
  assert.equal(filtrar(filas, { incluirNoDisponibles: true, incluirSinPrecio: true }).length, 4);
});

test('filtra por precio, nota, reviews y tipo', () => {
  assert.deepEqual(filtrar(filas, { max: 60 }).map((f) => f.property_id), [1, 2]);
  assert.deepEqual(filtrar(filas, { minNota: 8 }).map((f) => f.property_id), [1, 3]);
  assert.deepEqual(filtrar(filas, { minNota: 8, minReviews: 50 }).map((f) => f.property_id), [1]);
  assert.deepEqual(filtrar(filas, { tipo: 'depto,casa' }).map((f) => f.property_id), [1, 3]);
});

test('filtra por zona (sin importar acentos) y por exclusion', () => {
  assert.deepEqual(filtrar(filas, { zona: 'palermo' }).map((f) => f.property_id), [1]);
  assert.deepEqual(filtrar(filas, { zona: 'san nicolas' }).map((f) => f.property_id), [2]);
  assert.deepEqual(filtrar(filas, { sinZona: 'palermo,boedo' }).map((f) => f.property_id), [2]);
});

test('filtra por distancia a un punto', () => {
  const obelisco = parsearCoords('-34.6037,-58.3816');
  assert.deepEqual(filtrar(filas, { cerca: obelisco, radio: 1 }).map((f) => f.property_id), [2]);
  assert.equal(filtrar(filas, { cerca: obelisco, radio: 10 }).length, 3);
});

test('cancelacion gratis', () => {
  assert.deepEqual(filtrar(filas, { cancelacionGratis: true }).map((f) => f.property_id), [1]);
});

test('la nota ajustada castiga a los que tienen pocas opiniones', () => {
  assert.ok(notaAjustada(9.9, 2) < notaAjustada(9.0, 200));
  assert.ok(Math.abs(notaAjustada(9.0, 10000) - 9.0) < 0.01);
});

test('ordenes: precio, nota y valor', () => {
  const e = enriquecer(filtrar(filas, {}), {});
  assert.deepEqual(ordenar(e, 'precio').map((f) => f.property_id), [2, 1, 3]);
  assert.deepEqual(ordenar(e, 'nota').map((f) => f.property_id), [1, 3, 2]);
  assert.equal(ordenar(e, 'valor')[0].property_id, 2); // 7.0 a 30 rinde mas que 9.0 a 50
  assert.throws(() => ordenar(e, 'ranking'), /Orden desconocido/);
});

test('sin historial no inventa una bajada', () => {
  const [a] = enriquecer([{ ...filas[0], muestras: 1, maximo: 50, precio_inicial: 50 }], {});
  assert.equal(a._bajadaPct, null);
  const [b] = enriquecer([{ ...filas[0], muestras: 3, maximo: 100, precio_inicial: 100 }], {});
  assert.equal(b._bajadaPct, -50);
});

test('los nulos van al final, nunca primeros', () => {
  const e = enriquecer(filtrar(filas, { incluirNoDisponibles: true, incluirSinPrecio: true }), {});
  assert.equal(ordenar(e, 'precio').at(-1).property_id, 4);
});
