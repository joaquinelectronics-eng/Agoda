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
