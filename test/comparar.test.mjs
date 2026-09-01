import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as DB from '../src/db.mjs';
import { compararConDiaAnterior, distanciaHoraria, masCercanaEnHora, minutosDelDia, etiquetaHora } from '../src/comparar.mjs';

function dbTemporal() {
  return DB.abrirDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agoda-cmp-')), 't.db'));
}

/** Marca de tiempo local del dia `fecha` a la hora `h:m`, en ISO. */
const cuando = (fecha, h, m = 0) => {
  const [y, mes, d] = fecha.split('-').map(Number);
  return new Date(y, mes - 1, d, h, m, 0).toISOString();
};

const prop = (id, precio) => ({
  propertyId: id, nombre: `Depto ${id}`, tipoId: 29, tipo: 'Apartamento/Piso', familia: 'SingleRoom',
  estrellas: 3, zona: 'Palermo', ciudad: 'Buenos Aires', ciudadId: 9294, pais: 'Argentina',
  lat: -34.6, lon: -58.4, url: 'https://www.agoda.com/x', imagen: null, nota: 8.5, reviews: 120,
  disponible: true, moneda: 'ARS', porNoche: precio, porNocheSinImp: precio * 0.8, total: precio,
  tachado: null, habitacionesLibres: 2, cancelacion: 'FreeCancellation',
});

/** Guarda un snapshot fechado a mano, para simular muestras de distintos dias. */
function muestraA(db, busquedaId, iso, props) {
  const { snapshotId } = DB.guardarSnapshot(db, busquedaId, props);
  db.prepare('UPDATE snapshots SET tomado = ? WHERE id = ?').run(iso, snapshotId);
  return snapshotId;
}

const BASE = { ciudadId: 9294, ciudad: 'Buenos Aires', los: 1, adultos: 2, ninos: 0, habitaciones: 1, moneda: 'ARS' };

test('distanciaHoraria da la vuelta por medianoche', () => {
  assert.equal(distanciaHoraria(10 * 60, 12 * 60), 120);
  assert.equal(distanciaHoraria(23 * 60, 1 * 60), 120, '23:00 y 01:00 estan a 2 horas');
  assert.equal(distanciaHoraria(0, 0), 0);
});

test('etiquetaHora formatea bien', () => {
  assert.equal(etiquetaHora(19 * 60), '19:00');
  assert.equal(etiquetaHora(9 * 60 + 5), '09:05');
});

test('masCercanaEnHora elige la observacion de la hora mas parecida', () => {
  const obs = [
    { por_noche: 100, tomado: cuando('2026-09-01', 11) },
    { por_noche: 80, tomado: cuando('2026-09-01', 19) },
    { por_noche: 90, tomado: cuando('2026-09-01', 15) },
  ];
  assert.equal(masCercanaEnHora(obs, 19 * 60, 90).por_noche, 80);
  assert.equal(masCercanaEnHora(obs, 15 * 60, 90).por_noche, 90);
  assert.equal(masCercanaEnHora(obs, 3 * 60, 90), null, 'fuera de tolerancia devuelve null');
});

test('compara cada propiedad contra la noche anterior a la misma hora', () => {
  const db = dbTemporal();
  const hoy = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-02' });
  const ayer = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-01' });

  // Ayer: caro al mediodia, mas barato a la noche.
  muestraA(db, ayer.id, cuando('2026-09-01', 12), [prop(1, 100), prop(2, 200)]);
  muestraA(db, ayer.id, cuando('2026-09-01', 19), [prop(1, 90), prop(2, 180)]);
  // Hoy: misma curva pero mas barato.
  muestraA(db, hoy.id, cuando('2026-09-02', 12), [prop(1, 95), prop(2, 210)]);
  muestraA(db, hoy.id, cuando('2026-09-02', 19), [prop(1, 72), prop(2, 198)]);

  const r = compararConDiaAnterior(db, hoy);
  assert.equal(r.hermana.check_in, '2026-09-01');
  assert.equal(r.referencia.etiqueta, '19:00', 'toma la hora de la ultima muestra de hoy');

  const porId = new Map(r.filas.map((f) => [f.property_id, f]));
  assert.equal(porId.get(1).hoy, 72);
  assert.equal(porId.get(1).ayer, 90, 'cruza contra las 19:00 de ayer, no contra el mediodia');
  assert.equal(porId.get(1).delta, -18);
  assert.equal(porId.get(1).pct, -20);
  assert.equal(porId.get(2).ayer, 180);
  db.close();
});

test('pedir una hora puntual compara ese momento en los dos dias', () => {
  const db = dbTemporal();
  const hoy = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-02' });
  const ayer = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-01' });
  muestraA(db, ayer.id, cuando('2026-09-01', 12), [prop(1, 100)]);
  muestraA(db, ayer.id, cuando('2026-09-01', 19), [prop(1, 90)]);
  muestraA(db, hoy.id, cuando('2026-09-02', 12), [prop(1, 95)]);
  muestraA(db, hoy.id, cuando('2026-09-02', 19), [prop(1, 72)]);

  const r = compararConDiaAnterior(db, hoy, { hora: 12 });
  assert.equal(r.referencia.etiqueta, '12:00');
  assert.equal(r.filas[0].hoy, 95);
  assert.equal(r.filas[0].ayer, 100);
  db.close();
});

test('sin la noche anterior guardada, lo dice en vez de inventar', () => {
  const db = dbTemporal();
  const hoy = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-02' });
  muestraA(db, hoy.id, cuando('2026-09-02', 19), [prop(1, 72)]);
  const r = compararConDiaAnterior(db, hoy);
  assert.equal(r.hermana, null);
  assert.deepEqual(r.filas, []);
  db.close();
});

test('una propiedad que ayer no estaba queda contada aparte, no comparada', () => {
  const db = dbTemporal();
  const hoy = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-02' });
  const ayer = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-01' });
  muestraA(db, ayer.id, cuando('2026-09-01', 19), [prop(1, 90)]);
  muestraA(db, hoy.id, cuando('2026-09-02', 19), [prop(1, 72), prop(9, 50)]);

  const r = compararConDiaAnterior(db, hoy);
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].property_id, 1);
  assert.equal(r.sinPar, 1);
  db.close();
});

test('no cruza con una busqueda de otra ocupacion o moneda', () => {
  const db = dbTemporal();
  const hoy = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-02' });
  const otra = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-01', adultos: 4 });
  muestraA(db, otra.id, cuando('2026-09-01', 19), [prop(1, 90)]);
  muestraA(db, hoy.id, cuando('2026-09-02', 19), [prop(1, 72)]);
  assert.equal(compararConDiaAnterior(db, hoy).hermana, null);
  db.close();
});
