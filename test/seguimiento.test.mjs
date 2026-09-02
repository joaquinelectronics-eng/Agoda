import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as DB from '../src/db.mjs';
import { enriquecer } from '../src/filtros.mjs';
import { compararMuestras, pestanasPedidas } from '../src/comandos.mjs';

function dbTemporal() {
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agoda-test-')), 'test.db');
  return { db: DB.abrirDb(ruta), ruta };
}

const prop = (id, precio, extra = {}) => ({
  propertyId: id, nombre: `Depto ${id}`, tipoId: 29, tipo: 'Apartamento/Piso', familia: 'SingleRoom',
  estrellas: 3, zona: 'Palermo', ciudad: 'Buenos Aires', ciudadId: 9294, pais: 'Argentina',
  lat: -34.6, lon: -58.4, url: `https://www.agoda.com/p${id}`, imagen: null, nota: 8.5, reviews: 120,
  disponible: true, moneda: 'ARS', porNoche: precio, porNocheSinImp: precio * 0.8, total: precio,
  tachado: null, habitacionesLibres: 2, cancelacion: 'FreeCancellation', ...extra,
});

test('la base guarda muestras y calcula la evolucion de cada precio', () => {
  const { db } = dbTemporal();
  const b = DB.guardarBusqueda(db, {
    ciudadId: 9294, ciudad: 'Buenos Aires', checkIn: '2026-09-01', los: 1,
    adultos: 2, ninos: 0, habitaciones: 1, moneda: 'ARS', url: 'https://x',
  });

  DB.guardarSnapshot(db, b.id, [prop(1, 60000), prop(2, 40000)]);
  DB.guardarSnapshot(db, b.id, [prop(1, 75000), prop(2, 40000)]);
  DB.guardarSnapshot(db, b.id, [prop(1, 45000), prop(2, 41000), prop(3, 30000)]);

  const evo = new Map(DB.evolucion(db, b.id).map((r) => [r.property_id, r]));
  assert.equal(evo.size, 3);

  const uno = evo.get(1);
  assert.equal(uno.precio_inicial, 60000);
  assert.equal(uno.por_noche, 45000, 'el ultimo precio visto');
  assert.equal(uno.maximo, 75000);
  assert.equal(uno.minimo, 45000);
  assert.equal(uno.muestras, 3);

  const [enr] = enriquecer([uno], {});
  assert.equal(enr._bajada, -30000, 'bajo 30 mil desde el maximo');
  assert.equal(enr._bajadaPct, -40);

  assert.equal(evo.get(3).muestras, 1, 'la que aparecio recien tiene una sola muestra');
  db.close();
});

test('guardar la misma busqueda dos veces no la duplica', () => {
  const { db } = dbTemporal();
  const datos = { ciudadId: 9294, ciudad: 'Buenos Aires', checkIn: '2026-09-01', los: 1, adultos: 2, ninos: 0, habitaciones: 1, moneda: 'ARS', url: 'https://x' };
  const a = DB.guardarBusqueda(db, datos);
  const b = DB.guardarBusqueda(db, datos);
  assert.equal(a.id, b.id);
  // Cambiar la fecha si crea otra: es otra busqueda.
  const c = DB.guardarBusqueda(db, { ...datos, checkIn: '2026-09-02' });
  assert.notEqual(a.id, c.id);
  assert.equal(DB.listarBusquedas(db).length, 2);
  db.close();
});

test('el historial sale ordenado en el tiempo', () => {
  const { db } = dbTemporal();
  const b = DB.guardarBusqueda(db, { ciudadId: 1, ciudad: 'X', checkIn: '2026-09-01', los: 1, adultos: 2, ninos: 0, habitaciones: 1, moneda: 'ARS' });
  for (const p of [50, 45, 47]) DB.guardarSnapshot(db, b.id, [prop(7, p)]);
  assert.deepEqual(DB.historial(db, b.id, 7).map((x) => x.por_noche), [50, 45, 47]);
  db.close();
});

test('comparar dos muestras separa bajadas, subidas, nuevos y perdidos', () => {
  const mapa = (filas) => new Map(enriquecer(filas, {}).map((f) => [f.propertyId, f]));
  const antes = mapa([prop(1, 100), prop(2, 200), prop(3, 300)]);
  const ahora = mapa([prop(1, 80), prop(2, 260), prop(4, 90)]);

  const { bajaron, subieron, nuevos, perdidos } = compararMuestras(antes, ahora);
  assert.deepEqual(bajaron.map((c) => c.id), [1]);
  assert.equal(bajaron[0].delta, -20);
  assert.deepEqual(subieron.map((c) => c.id), [2]);
  assert.deepEqual(nuevos.map((f) => f.propertyId), [4]);
  assert.deepEqual(perdidos.map((f) => f.propertyId), [3]);
});

test('las bajadas se ordenan por porcentaje, no por pesos', () => {
  const mapa = (filas) => new Map(enriquecer(filas, {}).map((f) => [f.propertyId, f]));
  const antes = mapa([prop(1, 100), prop(2, 1000)]);
  const ahora = mapa([prop(1, 50), prop(2, 900)]);   // -50% vs -10% (pero -50 vs -100 en plata)
  const { bajaron } = compararMuestras(antes, ahora);
  assert.deepEqual(bajaron.map((c) => c.id), [1, 2]);
});

test('las solapas extra se saltean si esa noche todavia no tiene datos', () => {
  const { db } = dbTemporal();
  const base = {
    ciudadId: 9294, ciudad: 'Buenos Aires', los: 1,
    adultos: 2, ninos: 0, habitaciones: 1, moneda: 'USD', url: 'https://x',
  };
  const hoy = DB.guardarBusqueda(db, { ...base, checkIn: '2026-09-01' });
  const viernes = DB.guardarBusqueda(db, { ...base, checkIn: '2026-09-04' });

  assert.deepEqual(pestanasPedidas(db, {}).map((b) => b.id), []);
  assert.deepEqual(pestanasPedidas(db, { pestanas: '2026-09-04' }).map((b) => b.id), [viernes.id]);
  assert.deepEqual(pestanasPedidas(db, { pestanas: `${hoy.id}, 2026-09-04` }).map((b) => b.id),
    [hoy.id, viernes.id], 'tambien acepta ids');

  // Lo importante: esto corre cada hora sin nadie mirando. Que falte una solapa
  // no puede tirar la corrida, porque la muestra ya se guardo y lo unico que se
  // perderia es la pagina.
  assert.deepEqual(pestanasPedidas(db, { pestanas: '2026-12-25' }).map((b) => b.id), []);
  assert.deepEqual(pestanasPedidas(db, { pestanas: '2026-12-25,2026-09-04' }).map((b) => b.id),
    [viernes.id], 'las que si estan siguen saliendo');
});
