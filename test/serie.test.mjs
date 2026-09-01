import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as DB from '../src/db.mjs';
import { exportarMuestra, importarSerie } from '../src/serie.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agoda-serie-'));
const prop = (id, precio) => ({
  propertyId: id, nombre: `Depto ${id}`, tipoId: 29, tipo: 'Apartamento/Piso', familia: 'SingleRoom',
  estrellas: 3, zona: 'Palermo', ciudad: 'Buenos Aires', ciudadId: 9294, pais: 'Argentina',
  lat: -34.6, lon: -58.4, url: 'https://www.agoda.com/x', imagen: 'https://pix8.agoda.net/a.jpg',
  nota: 8.5, reviews: 120, disponible: true, moneda: 'ARS', porNoche: precio,
  porNocheSinImp: precio * 0.8, total: precio, tachado: null, habitacionesLibres: 2,
  cancelacion: 'FreeCancellation',
});
const BASE = { ciudadId: 9294, ciudad: 'Buenos Aires', checkIn: '2026-09-04', los: 1, adultos: 2, ninos: 0, habitaciones: 1, moneda: 'ARS' };

test('una muestra exportada se puede volver a leer igual', () => {
  const dir = temp();
  const origen = DB.abrirDb(path.join(dir, 'a.db'));
  const b = DB.guardarBusqueda(origen, BASE);
  const { snapshotId } = DB.guardarSnapshot(origen, b.id, [prop(1, 100), prop(2, 250)], { totalDisponibles: 900, paginas: 3 });
  origen.prepare('UPDATE snapshots SET tomado = ? WHERE id = ?').run('2026-09-01T18:00:00.000Z', snapshotId);

  const escrito = exportarMuestra(origen, b.id, snapshotId, path.join(dir, 'datos'));
  assert.ok(escrito && fs.existsSync(escrito));
  assert.ok(escrito.includes('2026-09-04'), 'se guarda en la carpeta de esa noche');

  const destino = DB.abrirDb(path.join(dir, 'b.db'));
  const r = importarSerie(destino, path.join(dir, 'datos'));
  assert.equal(r.importadas, 1);

  const b2 = DB.buscarBusqueda(destino, { clave: '9294|2026-09-04|1|2|0|1|ARS' });
  const snap = DB.ultimoSnapshot(destino, b2.id);
  assert.equal(snap.tomado, '2026-09-01T18:00:00.000Z', 'conserva la marca de tiempo original');
  assert.equal(snap.total_disponibles, 900);
  const filas = DB.filasSnapshot(destino, snap.id).sort((x, y) => x.property_id - y.property_id);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].por_noche, 100);
  assert.equal(filas[1].por_noche, 250);
  assert.equal(filas[0].zona, 'Palermo');
  assert.equal(filas[0].disponible, 1);
  origen.close(); destino.close();
});

test('importar dos veces no duplica', () => {
  const dir = temp();
  const origen = DB.abrirDb(path.join(dir, 'a.db'));
  const b = DB.guardarBusqueda(origen, BASE);
  const { snapshotId } = DB.guardarSnapshot(origen, b.id, [prop(1, 100)]);
  exportarMuestra(origen, b.id, snapshotId, path.join(dir, 'datos'));

  const destino = DB.abrirDb(path.join(dir, 'b.db'));
  assert.equal(importarSerie(destino, path.join(dir, 'datos')).importadas, 1);
  const segunda = importarSerie(destino, path.join(dir, 'datos'));
  assert.equal(segunda.importadas, 0);
  assert.equal(segunda.salteadas, 1);
  const b2 = DB.buscarBusqueda(destino, { clave: '9294|2026-09-04|1|2|0|1|ARS' });
  assert.equal(DB.listarSnapshots(destino, b2.id, 99).length, 1);
  origen.close(); destino.close();
});

test('exportar la misma muestra dos veces no reescribe el archivo', () => {
  const dir = temp();
  const db = DB.abrirDb(path.join(dir, 'a.db'));
  const b = DB.guardarBusqueda(db, BASE);
  const { snapshotId } = DB.guardarSnapshot(db, b.id, [prop(1, 100)]);
  assert.ok(exportarMuestra(db, b.id, snapshotId, path.join(dir, 'datos')));
  assert.equal(exportarMuestra(db, b.id, snapshotId, path.join(dir, 'datos')), null);
  db.close();
});

test('un archivo roto no frena la importacion de los demas', () => {
  const dir = temp();
  const datos = path.join(dir, 'datos', '2026-09-04');
  fs.mkdirSync(datos, { recursive: true });
  fs.writeFileSync(path.join(datos, 'roto.json'), '{ esto no es json');
  fs.writeFileSync(path.join(datos, 'incompleto.json'), JSON.stringify({ tomado: '2026-09-01T10:00:00Z' }));

  const origen = DB.abrirDb(path.join(dir, 'a.db'));
  const b = DB.guardarBusqueda(origen, BASE);
  const { snapshotId } = DB.guardarSnapshot(origen, b.id, [prop(1, 100)]);
  exportarMuestra(origen, b.id, snapshotId, path.join(dir, 'datos'));

  const destino = DB.abrirDb(path.join(dir, 'b.db'));
  const r = importarSerie(destino, path.join(dir, 'datos'));
  assert.equal(r.importadas, 1, 'la buena entra igual');
  assert.equal(r.rotas, 2);
  origen.close(); destino.close();
});

test('varias noches quedan separadas por carpeta', () => {
  const dir = temp();
  const db = DB.abrirDb(path.join(dir, 'a.db'));
  for (const noche of ['2026-09-04', '2026-09-05']) {
    const b = DB.guardarBusqueda(db, { ...BASE, checkIn: noche });
    const { snapshotId } = DB.guardarSnapshot(db, b.id, [prop(1, 100)]);
    exportarMuestra(db, b.id, snapshotId, path.join(dir, 'datos'));
  }
  assert.deepEqual(fs.readdirSync(path.join(dir, 'datos')).sort(), ['2026-09-04', '2026-09-05']);
  const destino = DB.abrirDb(path.join(dir, 'b.db'));
  assert.equal(importarSerie(destino, path.join(dir, 'datos')).importadas, 2);
  assert.equal(DB.listarBusquedas(destino).length, 2);
  db.close(); destino.close();
});
