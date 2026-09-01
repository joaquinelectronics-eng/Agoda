import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tomarCerrojo } from '../src/cerrojo.mjs';

const rutaTemporal = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agoda-lock-')), 'sub', 'agoda.lock');

test('el primero lo toma y el segundo se queda afuera', () => {
  const ruta = rutaTemporal();
  const a = tomarCerrojo(ruta);
  assert.equal(a.tomado, true);
  assert.equal(fs.existsSync(ruta), true, 'crea el archivo, y el directorio si no estaba');

  const b = tomarCerrojo(ruta);
  assert.equal(b.tomado, false);
  assert.equal(b.duenio.pid, process.pid);

  a.soltar();
  assert.equal(fs.existsSync(ruta), false);
  assert.equal(tomarCerrojo(ruta).tomado, true, 'una vez suelto, el siguiente pasa');
});

test('soltar dos veces no rompe', () => {
  const ruta = rutaTemporal();
  const a = tomarCerrojo(ruta);
  a.soltar();
  a.soltar();
  assert.equal(fs.existsSync(ruta), false);
});

test('un cerrojo de un proceso muerto se pisa', () => {
  const ruta = rutaTemporal();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  // pid 2^22 + 1: por encima del maximo habitual, seguro no existe
  fs.writeFileSync(ruta, JSON.stringify({ pid: 4194305, desde: new Date().toISOString() }));
  assert.equal(tomarCerrojo(ruta).tomado, true);
});

test('un cerrojo demasiado viejo se pisa aunque el proceso viva', () => {
  const ruta = rutaTemporal();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const hace2h = new Date(Date.now() - 2 * 3600_000).toISOString();
  fs.writeFileSync(ruta, JSON.stringify({ pid: process.pid, desde: hace2h }));
  assert.equal(tomarCerrojo(ruta, { maxEdadMin: 55 }).tomado, true, 'un cuelgue no puede trabar todo para siempre');
  // pero dentro de la ventana, no se pisa
  fs.writeFileSync(ruta, JSON.stringify({ pid: process.pid, desde: new Date().toISOString() }));
  assert.equal(tomarCerrojo(ruta, { maxEdadMin: 55 }).tomado, false);
});

test('un archivo corrupto no traba la corrida', () => {
  const ruta = rutaTemporal();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, 'no es json');
  assert.equal(tomarCerrojo(ruta).tomado, true);
});
