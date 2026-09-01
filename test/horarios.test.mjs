import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as DB from '../src/db.mjs';
import { analizarHorarios, mediana, avisoDeConfianza } from '../src/horarios.mjs';

const dbTemporal = () => DB.abrirDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agoda-hr-')), 't.db'));
const cuando = (fecha, h) => {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d, h, 0, 0).toISOString();
};
const prop = (id, precio) => ({
  propertyId: id, nombre: `Depto ${id}`, tipoId: 29, tipo: 'Apartamento/Piso', familia: 'SingleRoom',
  estrellas: 3, zona: 'Palermo', ciudad: 'Buenos Aires', ciudadId: 9294, pais: 'Argentina',
  lat: -34.6, lon: -58.4, url: 'u', imagen: null, nota: 8.5, reviews: 120, disponible: true,
  moneda: 'ARS', porNoche: precio, porNocheSinImp: precio * 0.8, total: precio,
  tachado: null, habitacionesLibres: 2, cancelacion: 'FreeCancellation',
});
function muestraA(db, busquedaId, iso, props) {
  const { snapshotId } = DB.guardarSnapshot(db, busquedaId, props);
  db.prepare('UPDATE snapshots SET tomado = ? WHERE id = ?').run(iso, snapshotId);
}
const BASE = { ciudadId: 9294, ciudad: 'Buenos Aires', los: 1, adultos: 2, ninos: 0, habitaciones: 1, moneda: 'ARS' };

test('mediana con cantidad par e impar', () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([4, 1, 2, 3]), 2.5);
  assert.equal(mediana([]), null);
});

test('encuentra la hora mas barata comparando cada alojamiento consigo mismo', () => {
  const db = dbTemporal();
  // Cinco noches con la misma forma: caro a las 12, barato a las 21.
  // Un alojamiento caro y otro barato, para probar que no lo desvia el nivel de precio.
  for (let d = 1; d <= 5; d++) {
    const fecha = `2026-09-0${d}`;
    const b = DB.guardarBusqueda(db, { ...BASE, checkIn: fecha });
    muestraA(db, b.id, cuando(fecha, 12), [prop(1, 100), prop(2, 1000)]);
    muestraA(db, b.id, cuando(fecha, 17), [prop(1, 90), prop(2, 900)]);
    muestraA(db, b.id, cuando(fecha, 21), [prop(1, 70), prop(2, 700)]);
  }
  const r = analizarHorarios(db, DB.buscarBusqueda(db, { clave: `9294|2026-09-05|1|2|0|1|ARS` }));

  assert.equal(r.mejor.hora, 21, 'las 21 son la mejor hora');
  assert.equal(r.peor.hora, 12);
  assert.ok(r.mejor.indicePct < -20, `a las 21 esta bastante abajo, dio ${r.mejor.indicePct}`);
  assert.ok(r.horas.find((h) => h.hora === 12).indicePct > 5, 'a las 12 esta por encima del tipico');
  assert.equal(r.mejor.vecesMinimo, 10, '2 alojamientos x 5 noches tocaron el minimo a las 21');
  assert.equal(r.nochesAnalizadas, 5);
  assert.equal(r.propiedades, 2);
  db.close();
});

test('un alojamiento caro no arrastra el indice de su hora', () => {
  const db = dbTemporal();
  // El caro solo aparece a las 12. Si promediaramos precios, las 12 darian carisimas.
  // Como cada uno se compara consigo mismo, las 12 tienen que quedar neutras.
  for (let d = 1; d <= 5; d++) {
    const fecha = `2026-09-0${d}`;
    const b = DB.guardarBusqueda(db, { ...BASE, checkIn: fecha });
    muestraA(db, b.id, cuando(fecha, 12), [prop(1, 100), prop(9, 5000)]);
    muestraA(db, b.id, cuando(fecha, 13), [prop(1, 100), prop(9, 5000)]);
    muestraA(db, b.id, cuando(fecha, 21), [prop(1, 100)]);
  }
  const r = analizarHorarios(db, DB.buscarBusqueda(db, { clave: '9294|2026-09-05|1|2|0|1|ARS' }));
  const doce = r.horas.find((h) => h.hora === 12);
  assert.equal(doce.indicePct, 0, 'precios planos => indice neutro, sin importar cuanto valen');
  db.close();
});

test('ignora series de una sola observacion', () => {
  const db = dbTemporal();
  const b = DB.guardarBusqueda(db, { ...BASE, checkIn: '2026-09-01' });
  muestraA(db, b.id, cuando('2026-09-01', 12), [prop(1, 100)]);
  const r = analizarHorarios(db, b);
  assert.equal(r.series, 0, 'con una sola muestra no hay con que comparar');
  assert.equal(r.mejor, null);
  db.close();
});

test('no opina sobre horas con poquitas muestras', () => {
  const db = dbTemporal();
  for (let d = 1; d <= 5; d++) {
    const fecha = `2026-09-0${d}`;
    const b = DB.guardarBusqueda(db, { ...BASE, checkIn: fecha });
    muestraA(db, b.id, cuando(fecha, 12), [prop(1, 100)]);
    muestraA(db, b.id, cuando(fecha, 21), [prop(1, 90)]);
  }
  // Las 3 AM solo una vez, y baratisima: no puede ganar por una casualidad.
  const ultima = DB.buscarBusqueda(db, { clave: '9294|2026-09-05|1|2|0|1|ARS' });
  muestraA(db, ultima.id, cuando('2026-09-05', 3), [prop(1, 10)]);
  const r = analizarHorarios(db, ultima, { minSeriesPorHora: 5 });
  assert.notEqual(r.mejor.hora, 3, 'una sola observacion no define la mejor hora');
  assert.equal(r.mejor.hora, 21);
  db.close();
});

test('el aviso de confianza escala con la cantidad de noches', () => {
  const muchas = Array.from({ length: 12 }, () => ({ series: 20 }));
  assert.equal(avisoDeConfianza(1, muchas).nivel, 'nada');
  assert.equal(avisoDeConfianza(3, muchas).nivel, 'poco');
  assert.equal(avisoDeConfianza(6, muchas).nivel, 'medio');
  assert.equal(avisoDeConfianza(20, muchas).nivel, 'bien');
  assert.equal(avisoDeConfianza(20, [{ series: 20 }]).nivel, 'poco', 'pocas horas cubiertas tambien baja la confianza');
});
