#!/usr/bin/env node
// Punto de entrada del CLI.

// La zona horaria tiene que quedar fija ANTES del primer uso de Date: de eso
// dependen "hoy", la hora del dia de cada muestra y todo el analisis de horarios.
// En tu maquina no hace falta (usa la del sistema); en un servidor en UTC, si.
if (process.env.AGODA_TZ) process.env.TZ = process.env.AGODA_TZ;

// node:sqlite todavia avisa que es experimental en cada arranque; no aporta nada al usuario.
const emitir = process.emit;
process.emit = function (nombre, dato, ...resto) {
  if (nombre === 'warning' && dato?.name === 'ExperimentalWarning' && /SQLite/i.test(dato.message)) return false;
  return emitir.call(this, nombre, dato, ...resto);
};

import { parsear, AYUDA } from '../src/args.mjs';
import { abrirDb, rutaDb } from '../src/db.mjs';
import { c, die, log } from '../src/util.mjs';
import * as cmd from '../src/comandos.mjs';

const COMANDOS = {
  buscar: cmd.cmdBuscar, search: cmd.cmdBuscar,
  ver: cmd.cmdVer, list: cmd.cmdVer, lista: cmd.cmdVer,
  bajadas: cmd.cmdBajadas, drops: cmd.cmdBajadas,
  seguir: cmd.cmdSeguir, watch: cmd.cmdSeguir,
  historial: cmd.cmdHistorial, history: cmd.cmdHistorial,
  reporte: cmd.cmdReporte, report: cmd.cmdReporte,
  buscas: cmd.cmdBuscas, searches: cmd.cmdBuscas,
  destinos: cmd.cmdDestinos, destinations: cmd.cmdDestinos,
  programar: cmd.cmdProgramar, schedule: cmd.cmdProgramar,
  comparar: cmd.cmdComparar, compare: cmd.cmdComparar,
  horarios: cmd.cmdHorarios, hours: cmd.cmdHorarios,
  estado: cmd.cmdEstado, status: cmd.cmdEstado,
  sincronizar: cmd.cmdSincronizar, sync: cmd.cmdSincronizar,
};

const { comando, pos, op } = parsear(process.argv.slice(2));

if (op.version) { log('agoda-tracker 1.0.0'); process.exit(0); }
if (!comando || op.ayuda || op.help || comando === 'ayuda' || comando === 'help') {
  log(AYUDA);
  process.exit(comando && comando !== 'ayuda' && comando !== 'help' ? 1 : 0);
}

const fn = COMANDOS[comando];
if (!fn) {
  die(`No conozco el comando "${comando}".\nComandos: ${Object.keys(COMANDOS).filter((k, i, a) => a.indexOf(k) === i).join(', ')}\nProba: agoda --ayuda`);
}

if (op.db) process.env.AGODA_DB = op.db;
const db = abrirDb(rutaDb());

let saliendo = false;
process.on('SIGINT', () => {
  if (saliendo) process.exit(130);
  saliendo = true;
  log(c('gray', '\n  cortado por vos.'));
  try { db.close(); } catch { /* ya cerrada */ }
  process.exit(130);
});

try {
  await fn(db, op, pos);
} catch (e) {
  if (process.env.AGODA_DEBUG) console.error(e);
  die(e.message);
} finally {
  try { db.close(); } catch { /* ya cerrada */ }
}
