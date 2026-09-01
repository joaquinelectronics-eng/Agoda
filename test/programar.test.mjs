import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horarioCron, horaDe, sinBloque } from '../src/comandos.mjs';

test('el horario de cron sale bien para los intervalos utiles', () => {
  assert.equal(horarioCron(60, 12, 23), '0 12-23 * * *');
  assert.equal(horarioCron(30, 12, 23), '*/30 12-23 * * *');
  assert.equal(horarioCron(15, 0, 23), '*/15 0-23 * * *');
  assert.equal(horarioCron(60, 20, 20), '0 20 * * *', 'una sola hora no se escribe como rango');
});

test('horaDe acepta 12 y 12:00, y rechaza lo que no es una hora', () => {
  assert.equal(horaDe('12'), 12);
  assert.equal(horaDe('12:00'), 12);
  assert.equal(horaDe('7:30'), 7);
  assert.equal(horaDe(undefined, 12), 12);
  assert.throws(() => horaDe('mediodia'), /Hora invalida/);
  assert.throws(() => horaDe('25'), /fuera de rango/);
});

test('sinBloque saca solo nuestra parte del crontab y no toca el resto', () => {
  const crontab = [
    '0 3 * * * /usr/bin/backup.sh',
    '# >>> agoda-tracker',
    '0 12-23 * * * node bin/agoda.mjs buscar',
    '# <<< agoda-tracker',
    '@reboot /usr/bin/otra-cosa',
  ].join('\n');
  const limpio = sinBloque(crontab);
  assert.ok(limpio.includes('/usr/bin/backup.sh'), 'no toca lo de antes');
  assert.ok(limpio.includes('/usr/bin/otra-cosa'), 'no toca lo de despues');
  assert.ok(!limpio.includes('agoda'), 'saca nuestra linea');
  assert.ok(!limpio.includes('>>>'), 'saca las marcas');
});

test('sinBloque es idempotente y aguanta un crontab vacio', () => {
  assert.equal(sinBloque(''), '');
  const sano = '0 3 * * * /usr/bin/backup.sh';
  assert.equal(sinBloque(sano), sano);
  assert.equal(sinBloque(sinBloque(sano)), sano);
});

test('reinstalar no duplica el bloque', () => {
  const con = ['# >>> agoda-tracker', '0 12-23 * * * viejo', '# <<< agoda-tracker'].join('\n');
  const nuevo = [sinBloque(con), '# >>> agoda-tracker', '0 12-23 * * * nuevo', '# <<< agoda-tracker'].filter(Boolean).join('\n');
  assert.equal((nuevo.match(/>>> agoda-tracker/g) || []).length, 1);
  assert.ok(!nuevo.includes('viejo'));
  assert.ok(nuevo.includes('nuevo'));
});

// --- varias tareas a la vez -------------------------------------------------

import { tareasEnCrontab, nombreDeTarea } from '../src/comandos.mjs';

const bloque = (nombre, linea) => `# >>> agoda-tracker:${nombre}\n${linea}\n# <<< agoda-tracker:${nombre}`;

test('instalar una segunda tarea no pisa la primera', () => {
  const conUna = ['0 3 * * * /usr/bin/backup.sh', bloque('hoy', '0 12-23 * * * agoda buscar hoy')].join('\n');
  // Asi instala cmdProgramar: saca solo el bloque de esa tarea y agrega el nuevo.
  const conDos = [sinBloque(conUna, 'viernes'), bloque('viernes', '0 9-23 * * * agoda buscar 2026-09-04')].join('\n');

  const tareas = tareasEnCrontab(conDos);
  assert.deepEqual(tareas.map((t) => t.nombre), ['hoy', 'viernes']);
  assert.ok(conDos.includes('/usr/bin/backup.sh'), 'no toca lo ajeno');
  assert.ok(conDos.includes('agoda buscar hoy'), 'la primera sigue ahi');
});

test('reinstalar una tarea reemplaza solo la suya', () => {
  const con = [bloque('hoy', '0 12-23 * * * viejo-hoy'), bloque('viernes', '0 9-23 * * * viernes')].join('\n');
  const nuevo = [sinBloque(con, 'hoy'), bloque('hoy', '0 10-23 * * * nuevo-hoy')].join('\n');
  const tareas = tareasEnCrontab(nuevo);
  assert.equal(tareas.length, 2);
  assert.ok(nuevo.includes('nuevo-hoy'));
  assert.ok(!nuevo.includes('viejo-hoy'));
  assert.ok(nuevo.includes('0 9-23 * * * viernes'), 'la otra queda intacta');
});

test('quitar una tarea deja las demas', () => {
  const con = [bloque('hoy', 'A'), bloque('viernes', 'B'), '0 3 * * * ajeno'].join('\n');
  const sinViernes = sinBloque(con, 'viernes');
  assert.deepEqual(tareasEnCrontab(sinViernes).map((t) => t.nombre), ['hoy']);
  assert.ok(sinViernes.includes('ajeno'));
  assert.deepEqual(tareasEnCrontab(sinBloque(con, null)).length, 0, 'sin nombre saca todas');
  assert.ok(sinBloque(con, null).includes('ajeno'));
});

test('un bloque viejo sin nombre cuenta como la tarea "hoy"', () => {
  const viejo = ['# >>> agoda-tracker', '0 12-23 * * * viejo', '# <<< agoda-tracker'].join('\n');
  assert.deepEqual(tareasEnCrontab(viejo).map((t) => t.nombre), ['hoy']);
  assert.equal(sinBloque(viejo, 'hoy'), '', 'se puede reemplazar sin dejar basura');
  assert.ok(sinBloque(viejo, 'viernes').includes('viejo'), 'y no lo borra otra tarea');
});

test('los nombres se normalizan para el crontab y los archivos', () => {
  assert.equal(nombreDeTarea('viernes'), 'viernes');
  assert.equal(nombreDeTarea('2026-09-04'), '2026-09-04');
  assert.equal(nombreDeTarea('Finde Largo!'), 'finde-largo');
  assert.equal(nombreDeTarea(undefined), 'hoy');
  assert.throws(() => nombreDeTarea('!!!'), /invalido/);
});
