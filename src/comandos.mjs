// Los comandos del CLI.

import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as DB from './db.mjs';
import { abrirNavegador } from './browser.mjs';
import { construirUrl, leerUrl, ajustarUrl, resolverDestino, scrapear } from './agoda.mjs';
import { filtrar, enriquecer, ordenar, parsearCoords, idsDeTipo, MIS_FILTROS } from './filtros.mjs';
import { compararConDiaAnterior, indicePorPropiedad } from './comparar.mjs';
import { analizarHorarios, nochesDelPerfil } from './horarios.mjs';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { tomarCerrojo } from './cerrojo.mjs';
import { exportarMuestra, importarSerie } from './serie.mjs';
import * as OUT from './salida.mjs';
import { miniatura, incrustar, avisoProxy } from './imagenes.mjs';
import { crearServidor, portada } from './servidor.mjs';
import { descartar, recuperar, leerDescartados, idsDescartados, sinDescartados, rutaDescartados } from './descartados.mjs';
import {
  c, log, warn, parseFecha, isoDate, num, sleep, haceCuanto, horaCorta,
  fmtPrecio, fmtPct, recortar, sparkline, normalizar,
} from './util.mjs';

// --- helpers compartidos ----------------------------------------------------

const huella = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 10);

const TOPE_PAGINAS = 30; // 3000 alojamientos: mas que el inventario de cualquier ciudad

/** --paginas acepta un numero o "todas" (pagina hasta que no haya mas). */
function paginasPedidas(op, porDefecto = 3) {
  if (op.paginas === undefined) return porDefecto;
  const s = normalizar(op.paginas);
  if (s === 'todas' || s === 'todo' || s === 'all') return TOPE_PAGINAS;
  return Math.max(1, num(op.paginas, porDefecto));
}

/** "todas" ya no se pagina: se barre por ventanas de precio (ver scrapear). */
function barridoPedido(op) {
  if (op.paginas === undefined) return false;
  const s = normalizar(op.paginas);
  return s === 'todas' || s === 'todo' || s === 'all';
}

function opcionesBusqueda(op) {
  return {
    checkIn: parseFecha(op.noche),
    los: num(op.noches, 1),
    adultos: num(op.adultos, 2),
    ninos: num(op.ninos, 0),
    habitaciones: num(op.habitaciones, 1),
    moneda: String(op.moneda ?? 'ARS').toUpperCase(),
  };
}

function opcionesFiltro(op) {
  return {
    max: num(op.max), min: num(op.min), maxTotal: num(op['max-total']),
    minNota: num(op['min-nota']), minReviews: num(op['min-reviews']), minEstrellas: num(op['min-estrellas']),
    tipo: op.tipo, zona: op.zona, sinZona: op['sin-zona'], texto: op.texto,
    cerca: parsearCoords(op.cerca), radio: num(op.radio, 3),
    cancelacionGratis: op['cancelacion-gratis'] === true,
    incluirNoDisponibles: op.todos === true,
    incluirSinPrecio: op.todos === true,
  };
}

/** Resuelve el destino a un cityId, usando cache en la base antes de ir a la red. */
async function idDeCiudad(db, page, texto) {
  const cache = DB.destinoGuardado(db, texto);
  if (cache) return { ciudadId: cache.ciudad_id, nombre: cache.nombre };

  const { candidatos, todos } = await resolverDestino(page, texto);
  if (!candidatos.length) {
    const sug = todos.slice(0, 5).map((s) => `  · ${s.texto ?? s.nombre}`).join('\n');
    throw new Error(`No encontre ninguna ciudad para "${texto}".${sug ? `\nAgoda sugiere:\n${sug}` : ''}`);
  }
  const mejor = candidatos[0];
  const nombre = mejor.ciudad && mejor.ciudad !== mejor.nombre ? `${mejor.nombre} (${mejor.ciudad})` : mejor.nombre;
  DB.recordarDestino(db, texto, mejor.ciudadFinal, nombre);
  return { ciudadId: mejor.ciudadFinal, nombre };
}

/** Arma la URL de busqueda a partir de las opciones (o de la que paso el usuario). */
async function armarBusqueda(db, page, op, pos) {
  const base = opcionesBusqueda(op);

  if (op.url) {
    const leido = leerUrl(op.url);
    const final = { ...leido, ...base };
    // Si no pidieron fecha explicita, respetamos la de la URL.
    if (op.noche === undefined && leido.checkIn) final.checkIn = leido.checkIn;
    if (op.noches === undefined && leido.los) final.los = leido.los;
    // Hay URLs de Agoda que no llevan `city` (busquedas por landmark, con `asq`).
    // Sin ciudad, lo que identifica la busqueda es la URL misma.
    if (final.ciudadId == null) final.ciudadId = `url:${huella(op.url)}`;
    return { ...final, url: ajustarUrl(op.url, final), ciudad: null };
  }

  const destino = pos[0] ?? null;
  if (!destino) {
    const ultima = DB.buscarBusqueda(db);
    if (!ultima) throw new Error('Decime un destino: agoda buscar "Buenos Aires"');
    if (!op.silencioso) log(c('gray', `  (usando el destino de la ultima busqueda: ${ultima.ciudad ?? ultima.ciudad_id})`));
    return { ...base, ciudadId: ultima.ciudad_id, ciudad: ultima.ciudad, url: construirUrl({ ...base, cityId: ultima.ciudad_id }) };
  }

  const { ciudadId, nombre } = await idDeCiudad(db, page, destino);
  return { ...base, ciudadId, ciudad: nombre, url: construirUrl({ ...base, cityId: ciudadId }) };
}

/** Filas del ultimo snapshot con las estadisticas historicas pegadas. */
function filasConHistoria(db, busquedaId, snapshotId, { desdeHoras = null } = {}) {
  const filas = DB.filasSnapshot(db, snapshotId);
  const evo = new Map(DB.evolucion(db, busquedaId, { desdeHoras }).map((r) => [r.property_id, r]));
  return filas.map((f) => {
    const e = evo.get(f.property_id);
    return {
      ...f,
      precio_inicial: e?.precio_inicial ?? null,
      maximo: e?.maximo ?? null,
      minimo: e?.minimo ?? null,
      muestras: e?.muestras ?? 1,
      primera_vez: e?.primera_vez ?? null,
    };
  });
}

function preparar(filas, op) {
  const fo = opcionesFiltro(op);
  const vivas = op['con-descartados'] ? filtrar(filas, fo) : sinDescartados(filtrar(filas, fo));
  const ricas = enriquecer(vivas, { cerca: fo.cerca });
  return ordenar(ricas, op.orden ?? 'precio');
}

/** Historial de cada fila, para dibujar las curvas en el reporte. */
function historiales(db, busquedaId, filas) {
  const out = {};
  for (const f of filas) {
    const id = f.property_id ?? f.propertyId;
    if (id != null) out[id] = DB.historial(db, busquedaId, id);
  }
  return out;
}

function exportar(db, filas, op, { busqueda } = {}) {
  if (op.csv) log(c('gray', `  CSV: ${OUT.guardar(op.csv, OUT.aCsv(filas))}`));
  if (op.html) {
    const hist = busqueda ? historiales(db, busqueda.id, filas) : {};
    log(c('gray', `  HTML: ${OUT.guardar(op.html, OUT.reporteHtml(filas, { busqueda, historiales: hist }))}`));
  }
}

function encabezado(b, { snapshot, total } = {}) {
  const partes = [
    c('bold', b.ciudad ?? `ciudad ${b.ciudad_id ?? b.ciudadId}`),
    `${b.check_in ?? b.checkIn}`,
    `${b.los} noche${b.los > 1 ? 's' : ''}`,
    `${b.adultos ?? 2} adulto(s)`,
    b.moneda,
  ];
  log('\n' + partes.join(c('gray', ' · ')));
  if (snapshot) {
    log(c('gray', `${total ?? snapshot.n} alojamientos · muestra de ${horaCorta(snapshot.tomado)} (${haceCuanto(snapshot.tomado)})`));
  }
}

function resumen(filas, moneda) {
  const precios = filas.map((f) => f._precio).filter((p) => p != null).sort((a, b) => a - b);
  if (!precios.length) return;
  const mediana = precios[Math.floor(precios.length / 2)];
  log(c('gray', `\n  ${filas.length} resultados · mas barato ${fmtPrecio(precios[0], moneda)} · mediana ${fmtPrecio(mediana, moneda)}`));
}

// --- buscar -----------------------------------------------------------------

export async function cmdBuscar(db, op, pos) {
  // En modo programado, si la corrida anterior sigue viva nos vamos sin hacer nada.
  const cerrojo = op.silencioso ? tomarCerrojo(op.cerrojo ?? 'data/agoda.lock') : { tomado: true, soltar: () => {} };
  if (!cerrojo.tomado) {
    log(`${new Date().toISOString()} salteada: ya hay una corrida en curso (pid ${cerrojo.duenio.pid}, hace ${cerrojo.edadMin.toFixed(0)} min)`);
    return;
  }
  try {
    await buscarYGuardar(db, op, pos);
  } finally {
    cerrojo.soltar();
  }
}

async function buscarYGuardar(db, op, pos) {
  const { page, cerrar } = await abrirNavegador({ headful: op.headful === true });
  let ctx, datos;
  try {
    ctx = await armarBusqueda(db, page, op, pos);

    // Una noche que ya paso no se puede reservar. Con fecha fija, la tarea
    // programada se apaga sola: sigue disparando pero no hace nada.
    if (ctx.checkIn < isoDate()) {
      const aviso = `la noche del ${ctx.checkIn} ya paso`;
      if (op.silencioso) { log(`${new Date().toISOString()} nada que hacer: ${aviso}`); return; }
      throw new Error(`No puedo buscar ${aviso}. Usa --noche hoy o una fecha futura.`);
    }

    if (!op.silencioso) log(c('gray', `  buscando: ${ctx.url}`));
    datos = await scrapear(page, ctx.url, { paginas: paginasPedidas(op), barrido: barridoPedido(op), verboso: !op.silencioso });
  } finally {
    await cerrar();
  }

  const busqueda = DB.guardarBusqueda(db, {
    ...ctx, ciudad: datos.ciudad ?? ctx.ciudad, ciudadId: datos.ciudadId ?? ctx.ciudadId,
  });
  const { snapshotId } = op['sin-guardar']
    ? { snapshotId: null }
    : DB.guardarSnapshot(db, busqueda.id, datos.propiedades, { totalDisponibles: datos.totalDisponibles, paginas: datos.paginas });

  // Con --serie, ademas del sqlite queda un archivo por muestra: es lo que
  // sobrevive si la maquina donde corre es efimera.
  let archivoSerie = null;
  if (snapshotId && op.serie) archivoSerie = exportarMuestra(db, busqueda.id, snapshotId, op.serie === true ? 'datos' : op.serie);

  const filas = snapshotId
    ? filasConHistoria(db, busqueda.id, snapshotId)
    : datos.propiedades.map((p) => ({ ...p, property_id: p.propertyId, por_noche: p.porNoche, tipo_id: p.tipoId }));

  const listas = preparar(filas, op);
  if (op.json) { log(JSON.stringify(listas, null, 2)); return; }

  // Modo para tareas programadas: una linea con fecha, y el HTML al dia.
  if (op.silencioso) {
    let extra = '';
    if (op.html && snapshotId) {
      const { destino } = await generarReporte(db, busqueda, op, { silencioso: true });
      extra = ` · ${destino}`;
    }
    const bajaron = listas.filter((f) => f._bajadaPct != null && f._bajadaPct < -0.5).length;
    log(`${new Date().toISOString()} ${busqueda.ciudad ?? busqueda.ciudad_id} ${busqueda.check_in} · ` +
        `${datos.propiedades.length} alojamientos · ${bajaron} bajaron${extra}` +
        (archivoSerie ? ` · ${archivoSerie}` : ''));
    return;
  }

  encabezado(busqueda, { total: datos.propiedades.length });
  log(c('gray', `${datos.totalDisponibles ?? '?'} disponibles en Agoda · bajamos ${datos.propiedades.length} (${datos.paginas} pagina/s)`));
  log('');
  const limite = num(op.limite, 30);
  log(OUT.tablaResultados(listas.slice(0, limite), {
    moneda: busqueda.moneda, noches: busqueda.los,
    mostrarBajada: listas.some((f) => f.muestras > 1),
    mostrarDistancia: Boolean(op.cerca),
  }));
  resumen(listas, busqueda.moneda);
  if (listas.length > limite) log(c('gray', `  (mostrando ${limite} de ${listas.length}; usa --limite)`));

  if (op.html && snapshotId) {
    const { destino } = await generarReporte(db, busqueda, op);
    log(c('gray', `  HTML: ${destino}`));
    if (op.csv) log(c('gray', `  CSV: ${OUT.guardar(op.csv, OUT.aCsv(listas))}`));
  } else {
    exportar(db, listas, op, { busqueda });
  }
}

// --- ver --------------------------------------------------------------------

export async function cmdVer(db, op, pos) {
  const busqueda = elegirBusqueda(db, op, pos);
  const snap = DB.ultimoSnapshot(db, busqueda.id);
  if (!snap) throw new Error('Esa busqueda no tiene ninguna muestra todavia. Corre "agoda buscar" primero.');

  const filas = filasConHistoria(db, busqueda.id, snap.id, { desdeHoras: num(op.desde) });
  const listas = preparar(filas, op);
  if (op.json) { log(JSON.stringify(listas, null, 2)); return; }

  encabezado(busqueda, { snapshot: snap });
  log('');
  const limite = num(op.limite, 30);
  log(OUT.tablaResultados(listas.slice(0, limite), {
    moneda: busqueda.moneda, noches: busqueda.los,
    mostrarBajada: listas.some((f) => f.muestras > 1),
    mostrarDistancia: Boolean(op.cerca),
  }));
  resumen(listas, busqueda.moneda);
  if (listas.length > limite) log(c('gray', `  (mostrando ${limite} de ${listas.length}; usa --limite)`));
  exportar(db, listas, op, { busqueda });
}

// --- bajadas ----------------------------------------------------------------

export async function cmdBajadas(db, op, pos) {
  const busqueda = elegirBusqueda(db, op, pos);
  const evo = DB.evolucion(db, busqueda.id, { desdeHoras: num(op.desde) });
  if (!evo.length) throw new Error('No hay datos guardados para esa busqueda.');

  const conHistoria = evo.filter((f) => f.muestras > 1);
  if (!conHistoria.length) {
    warn('Solo hay una muestra: todavia no hay con que comparar.');
    log(c('gray', '  Corre "agoda seguir" o "agoda buscar" de nuevo dentro de un rato.'));
    return;
  }

  const listas = ordenar(enriquecer(filtrar(conHistoria, opcionesFiltro(op)), { cerca: parsearCoords(op.cerca) }), op.orden ?? 'bajada')
    .filter((f) => (op['solo-bajaron'] === false ? true : f._bajada != null && f._bajada < 0));

  if (op.json) { log(JSON.stringify(listas, null, 2)); return; }

  const snaps = DB.listarSnapshots(db, busqueda.id, 500);
  encabezado(busqueda);
  log(c('gray', `${snaps.length} muestras entre ${horaCorta(snaps.at(-1).tomado)} y ${horaCorta(snaps[0].tomado)}`));
  log('');
  const limite = num(op.limite, 25);
  log(OUT.tablaBajadas(listas.slice(0, limite), { moneda: busqueda.moneda }));
  if (!listas.length) log(c('gray', '  Nadie bajo todavia.'));
  else {
    const mejor = listas[0];
    log(c('green', `\n  Mayor bajada: ${recortar(mejor.nombre, 50)} ${fmtPrecio(mejor.maximo)} -> ${fmtPrecio(mejor._precio)} ${busqueda.moneda} (${fmtPct(mejor._bajadaPct)})`));
  }
  exportar(db, listas, op, { busqueda });
}

// --- historial --------------------------------------------------------------

export async function cmdHistorial(db, op, pos) {
  const busqueda = elegirBusqueda(db, op, pos.slice(1));
  const ref = pos[0];
  if (!ref) throw new Error('Decime que alojamiento: agoda historial <id o parte del nombre>');

  let propertyId = /^\d+$/.test(ref) ? Number(ref) : null;
  if (!propertyId) {
    const cand = DB.buscarPropiedades(db, ref);
    if (!cand.length) throw new Error(`No tengo guardado nada que se llame "${ref}".`);
    if (cand.length > 1) {
      log(c('gray', `  ${cand.length} coincidencias, uso la primera:`));
      for (const p of cand.slice(0, 8)) log(c('gray', `   ${p.property_id}  ${recortar(p.nombre, 45)}  ${p.zona ?? ''}`));
      log('');
    }
    propertyId = cand[0].property_id;
  }

  const puntos = DB.historial(db, busqueda.id, propertyId);
  if (!puntos.length) throw new Error('No hay historial para ese alojamiento en esta busqueda.');

  const prop = db.prepare('SELECT * FROM propiedades WHERE property_id = ?').get(propertyId);
  const precios = puntos.map((p) => p.por_noche).filter((x) => x != null);
  encabezado(busqueda);
  log(`\n  ${c('bold', prop.nombre)} ${c('gray', `· ${prop.tipo ?? ''} · ${prop.zona ?? ''} · nota ${prop.nota ?? '-'}`)}`);
  if (prop.url) log(c('gray', `  ${prop.url}`));
  const rango = `min ${fmtPrecio(Math.min(...precios))} · max ${fmtPrecio(Math.max(...precios))} ${busqueda.moneda}`;
  log(`\n  ${c('cyan', sparkline(precios))}  ${c('gray', rango)}`);
  log('');
  log(OUT.tablaHistorial(puntos, { moneda: busqueda.moneda }));
}

// --- seguir -----------------------------------------------------------------

export async function cmdSeguir(db, op, pos) {
  const cada = Math.max(5, num(op.cada, 20));
  const veces = num(op.veces, Infinity);
  const avisarSi = num(op['avisar-si'], 10);
  const avisarBajo = num(op['avisar-bajo']);
  const hastaHora = op['hasta-hora'];
  const limite = hastaHora ? horaLimite(hastaHora) : null;
  const fo = opcionesFiltro(op);

  log(c('bold', `\nSiguiendo precios cada ${cada} min${limite ? ` hasta las ${hastaHora}` : ''}. Ctrl+C para cortar.\n`));

  let previos = new Map();
  let busqueda = null;

  for (let i = 1; i <= veces; i++) {
    if (limite && Date.now() > limite) { log(c('gray', '\nLlegue a la hora limite.')); break; }

    const marca = new Date();
    let datos, ctx;
    const { page, cerrar } = await abrirNavegador({ headful: op.headful === true });
    try {
      ctx = await armarBusqueda(db, page, op, pos);
      datos = await scrapear(page, ctx.url, { paginas: paginasPedidas(op), barrido: barridoPedido(op), verboso: false });
    } catch (e) {
      warn(`muestra ${i} fallo: ${e.message}`);
      await cerrar();
      if (i >= veces) break;
      await esperar(cada, limite);
      continue;
    } finally {
      await cerrar();
    }

    busqueda = DB.guardarBusqueda(db, { ...ctx, ciudad: datos.ciudad ?? ctx.ciudad, ciudadId: datos.ciudadId ?? ctx.ciudadId });
    DB.guardarSnapshot(db, busqueda.id, datos.propiedades, { totalDisponibles: datos.totalDisponibles, paginas: datos.paginas });

    const actuales = new Map(
      enriquecer(filtrar(datos.propiedades, fo), { cerca: fo.cerca }).map((f) => [f.propertyId, f])
    );

    log(c('bold', `[${horaCorta(marca.toISOString())}] muestra ${i} · ${actuales.size} que cumplen tus filtros de ${datos.propiedades.length} bajados`));

    if (previos.size) {
      const cambios = compararMuestras(previos, actuales);
      mostrarCambios(cambios, busqueda.moneda);
      for (const ch of cambios.bajaron) {
        const pct = (ch.delta / ch.antes) * 100;
        if (-pct >= avisarSi || (avisarBajo != null && ch.ahora <= avisarBajo)) {
          avisar(ch, busqueda, op['avisar-con']);
        }
      }
      if (avisarBajo != null) {
        for (const [id, f] of actuales) {
          if (!previos.has(id) && f._precio != null && f._precio <= avisarBajo) {
            avisar({ nombre: f.nombre, ahora: f._precio, antes: null, delta: 0, url: f.url, nuevo: true }, busqueda, op['avisar-con']);
          }
        }
      }
    } else {
      const baratos = [...actuales.values()].sort((a, b) => (a._precio ?? 1e12) - (b._precio ?? 1e12)).slice(0, 5);
      for (const f of baratos) log(c('gray', `    ${fmtPrecio(f._precio, busqueda.moneda).padStart(14)}  ${recortar(f.nombre, 46)}`));
    }

    previos = actuales;
    if (i >= veces) break;
    log(c('gray', `    proxima muestra en ${cada} min\n`));
    await esperar(cada, limite);
  }

  if (busqueda) {
    log(c('gray', `\nListo. Mira el resumen con:  agoda bajadas`));
  }
}

function horaLimite(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function esperar(minutos, limite) {
  const fin = Date.now() + minutos * 60_000;
  while (Date.now() < fin) {
    if (limite && Date.now() > limite) return;
    await sleep(Math.min(5_000, fin - Date.now()));
  }
}

export function compararMuestras(antes, ahora) {
  const bajaron = [], subieron = [], nuevos = [], perdidos = [];
  for (const [id, f] of ahora) {
    const p = antes.get(id);
    if (!p) { nuevos.push(f); continue; }
    const a = p._precio, b = f._precio;
    if (a == null || b == null || a === b) continue;
    const ch = { id, nombre: f.nombre, antes: a, ahora: b, delta: b - a, url: f.url, zona: f.zona };
    (b < a ? bajaron : subieron).push(ch);
  }
  for (const [id, f] of antes) if (!ahora.has(id)) perdidos.push(f);
  bajaron.sort((x, y) => x.delta / x.antes - y.delta / y.antes);
  subieron.sort((x, y) => y.delta / y.antes - x.delta / x.antes);
  return { bajaron, subieron, nuevos, perdidos };
}

function mostrarCambios({ bajaron, subieron, nuevos, perdidos }, moneda) {
  if (!bajaron.length && !subieron.length && !nuevos.length && !perdidos.length) {
    log(c('gray', '    sin cambios'));
    return;
  }
  for (const ch of bajaron.slice(0, 10)) {
    const pct = ((ch.delta / ch.antes) * 100).toFixed(0);
    log(c('green', `    ▼ ${fmtPrecio(ch.antes)} → ${fmtPrecio(ch.ahora)} ${moneda} (${pct}%)  `) + recortar(ch.nombre, 42));
  }
  if (bajaron.length > 10) log(c('gray', `      … y ${bajaron.length - 10} bajadas mas`));
  for (const ch of subieron.slice(0, 3)) {
    const pct = ((ch.delta / ch.antes) * 100).toFixed(0);
    log(c('red', `    ▲ ${fmtPrecio(ch.antes)} → ${fmtPrecio(ch.ahora)} ${moneda} (+${pct}%)  `) + c('gray', recortar(ch.nombre, 42)));
  }
  if (subieron.length > 3) log(c('gray', `      … y ${subieron.length - 3} subidas`));
  if (nuevos.length) log(c('cyan', `    + ${nuevos.length} publicaciones nuevas`));
  if (perdidos.length) log(c('gray', `    − ${perdidos.length} ya no aparecen`));
}

function avisar(ch, busqueda, comando) {
  const pct = ch.antes ? ((ch.delta / ch.antes) * 100).toFixed(0) + '%' : 'nuevo';
  process.stdout.write('\x07'); // campanita
  log(c('bold', c('green', `    *** BAJADA: ${recortar(ch.nombre, 44)} → ${fmtPrecio(ch.ahora, busqueda.moneda)} (${pct}) ***`)));
  if (ch.url) log(c('gray', `        ${ch.url}`));
  if (!comando) return;
  const env = {
    ...process.env,
    AGODA_NOMBRE: ch.nombre, AGODA_PRECIO: String(ch.ahora ?? ''), AGODA_ANTES: String(ch.antes ?? ''),
    AGODA_PCT: pct, AGODA_URL: ch.url ?? '', AGODA_MONEDA: busqueda.moneda ?? '',
    AGODA_CIUDAD: busqueda.ciudad ?? '', AGODA_FECHA: busqueda.check_in ?? '',
  };
  spawn(comando, { shell: true, env, stdio: 'ignore', detached: true }).unref();
}

// --- reporte / listados -----------------------------------------------------

/**
 * Los filtros que se pasan al reporte no recortan la tabla: dejan los chips
 * marcados al abrir, para que se puedan destildar desde la pagina.
 */
function preseleccionar(filas, op, { silencioso = false } = {}) {
  const pre = {
    tipos: [], zonas: [],
    max: num(op.max), minNota: num(op['min-nota']), minReviews: num(op['min-reviews']),
    cancelacionGratis: op['cancelacion-gratis'] === true,
  };

  // Sin --tipo/--zona valen los de siempre: que la pagina abra util aunque el
  // reporte se genere a mano.
  const tipoPedido = op.tipo ?? MIS_FILTROS.tipo;
  const zonaPedida = op.zona ?? MIS_FILTROS.zona;

  const ids = idsDeTipo(tipoPedido);
  if (ids) {
    const nombres = new Set();
    for (const f of filas) if (ids.has(f.tipo_id ?? f.tipoId)) nombres.add(OUT.tipoCorto(f.tipo));
    pre.tipos = [...nombres];
  }

  if (zonaPedida) {
    const pedidas = String(zonaPedida).split(',').map(normalizar).filter(Boolean);
    const nombres = new Set();
    for (const f of filas) {
      if (f.zona && pedidas.some((t) => normalizar(f.zona).includes(t))) nombres.add(f.zona);
    }
    pre.zonas = [...nombres];
    const sinDatos = pedidas.filter((t) => ![...nombres].some((z) => normalizar(z).includes(t)));
    if (sinDatos.length && !silencioso) {
      warn(`No hay alojamientos guardados en: ${sinDatos.join(', ')}. Proba con --paginas todas.`);
    }
  }
  return pre;
}

/**
 * --fotos url (por defecto) deja las miniaturas apuntando al CDN de Agoda.
 * --fotos incrustadas las baja y las mete adentro del HTML: el archivo queda
 * autonomo (sirve sin internet, y es lo unico que funciona si lo publicas en
 * algun lado que bloquee imagenes de otros dominios).
 */
async function resolverFotos(filas, op, anchoFoto, { silencioso = false } = {}) {
  const modo = normalizar(op.fotos ?? 'url');
  if (modo === 'url') return null;
  if (modo === 'ninguna' || modo === 'sin') return new Map();
  if (modo !== 'incrustadas' && modo !== 'incrustar') {
    throw new Error(`--fotos acepta: url, incrustadas o ninguna (recibi "${op.fotos}")`);
  }

  const aviso = avisoProxy();
  if (aviso && !silencioso) log(aviso);

  // Mismo ancho que va a pedir la pagina, si no las claves no coinciden.
  const urls = filas.map((f) => miniatura(f.imagen, anchoFoto)).filter(Boolean);
  if (!silencioso) log(c('gray', `  bajando ${new Set(urls).size} miniaturas...`));
  const { fotos, total, fallidas, bytes } = await incrustar(urls, {
    alProgreso: silencioso ? null : (hechas, cuantas) => process.stderr.write(c('gray', `\r  ${hechas}/${cuantas}   `)),
  });
  if (!silencioso) {
    process.stderr.write('\r                              \r');
    log(c('gray', `  ${total - fallidas}/${total} fotos incrustadas (${(bytes / 1e6).toFixed(1)} MB)` +
      (fallidas ? `, ${fallidas} fallaron` : '')));
  }
  return fotos;
}

/** Prepara los datos de una busqueda para el reporte. */
function armarVista(db, busqueda, op) {
  const snap = DB.ultimoSnapshot(db, busqueda.id);
  if (!snap) return null;

  // A la pagina le mandamos todo lo disponible; filtrar es cosa suya.
  const crudas = filasConHistoria(db, busqueda.id, snap.id);
  // Por defecto va todo y los filtros solo dejan los chips marcados. Con
  // --recortar se aplican de verdad: sirve para publicar o compartir el archivo,
  // que con las fotos incrustadas se va de tamano rapido.
  const recorte = op.recortar ? opcionesFiltro(op) : { incluirNoDisponibles: op.todos === true };
  // Los descartados no llegan ni a la pagina: la cruz es para no volver a verlos.
  const visibles = op['con-descartados'] ? filtrar(crudas, recorte) : sinDescartados(filtrar(crudas, recorte));
  const filas = enriquecer(visibles, {});

  // Contra la noche anterior a la misma hora, si esa noche esta guardada.
  const comparacion = compararConDiaAnterior(db, busqueda, {
    diasAtras: num(op.contra, 1),
    toleranciaMin: num(op.tolerancia, 90),
    hora: op.hora === undefined ? null : num(op.hora),
  });

  return {
    busqueda,
    filas,
    historiales: historiales(db, busqueda.id, filas),
    muestras: DB.listarSnapshots(db, busqueda.id, 999).length,
    comparacion,
    contraAyer: comparacion.hermana ? indicePorPropiedad(comparacion) : null,
  };
}

/**
 * --pestanas 2026-09-04,15 -> las busquedas que van como solapas extra.
 *
 * Una solapa que todavia no tiene datos se avisa y se saltea, no revienta: esto
 * corre cada hora sin nadie mirando, y para cuando se arma el HTML la muestra de
 * la noche principal ya esta guardada. Tirar aca solo perderia la pagina.
 */
export function pestanasPedidas(db, op) {
  if (!op.pestanas) return [];
  const pedidas = String(op.pestanas).split(',').map((x) => x.trim()).filter(Boolean);
  const salida = [];
  for (const ref of pedidas) {
    const b = /^\d+$/.test(ref)
      ? DB.buscarBusqueda(db, { id: Number(ref) })
      : DB.listarBusquedas(db).find((x) => x.check_in === parseFecha(ref));
    if (b) salida.push(b);
    else warn(`Sin solapa para "${ref}": todavia no hay ninguna busqueda guardada con esa noche.`);
  }
  return salida;
}

/**
 * Arma el HTML. Con --pestanas mete varias busquedas en el mismo archivo, cada
 * una en su solapa; las fotos se bajan una sola vez para todas, porque el mismo
 * alojamiento suele aparecer en varias noches.
 */
async function generarReporte(db, busqueda, op, { ruta = null, silencioso = false } = {}) {
  const busquedas = [busqueda, ...pestanasPedidas(db, op)]
    .filter((b, i, a) => a.findIndex((x) => x.id === b.id) === i);

  const vistas = busquedas.map((b) => armarVista(db, b, op)).filter(Boolean);
  if (!vistas.length) throw new Error('Esa busqueda no tiene muestras.');

  const pre = preseleccionar(vistas.flatMap((v) => v.filas), op, { silencioso });
  const anchoFoto = num(op['fotos-ancho'], vistas.length > 1 ? 320 : 400);
  const fotos = await resolverFotos(vistas.flatMap((v) => v.filas), op, anchoFoto, { silencioso });

  const destino = OUT.guardar(ruta || op.html || `reportes/agoda-${busqueda.check_in}.html`,
    OUT.reporteHtml(vistas, { preseleccion: pre, fotos, anchoFoto }));

  return { destino, filas: vistas[0].filas, pre, comp: vistas[0].comparacion, vistas };
}

export async function cmdReporte(db, op, pos) {
  const busqueda = elegirBusqueda(db, op, pos);
  const { destino, filas, pre, comp, vistas } = await generarReporte(db, busqueda, op);

  log(`\n  Reporte con ${filas.length} alojamientos: ${c('bold', destino)}`);
  if (vistas.length > 1) {
    log(c('gray', `  ${vistas.length} solapas: ${vistas.map((v) => `${v.busqueda.check_in} (${v.filas.length})`).join(', ')}`));
  }
  if (comp?.hermana) {
    log(c('gray', `  Comparado contra la noche del ${comp.hermana.check_in} a las ~${comp.referencia?.etiqueta} (${comp.filas.length} en comun)`));
  }
  if (pre.tipos.length || pre.zonas.length) {
    log(c('gray', `  Filtros ya marcados al abrir: ${[...pre.tipos, ...pre.zonas].join(', ')}`));
  }
  if (op.csv) log(c('gray', `  CSV: ${OUT.guardar(op.csv, OUT.aCsv(filas))}`));
}

export async function cmdBuscas(db) {
  const lista = DB.listarBusquedas(db);
  if (!lista.length) { log(c('gray', '  Todavia no seguis ninguna busqueda.')); return; }
  log('');
  for (const b of lista) {
    log(`  ${c('bold', String(b.id).padStart(3))}  ${c('bold', (b.ciudad ?? String(b.ciudad_id)).padEnd(24))} ` +
        `${b.check_in}  ${String(b.los)}n  ${String(b.adultos)}ad  ${(b.moneda ?? '').padEnd(4)} ` +
        c('gray', `${b.snapshots} muestra(s)${b.ultimo_snapshot ? `, ultima ${haceCuanto(b.ultimo_snapshot)}` : ''}`));
  }
  log(c('gray', '\n  Usa --busqueda <id> para trabajar sobre una en particular.'));
}

export async function cmdDestinos(db, op, pos) {
  const texto = pos.join(' ');
  if (!texto) throw new Error('Decime que buscar: agoda destinos "bariloche"');
  const { page, cerrar } = await abrirNavegador({ headful: op.headful === true });
  try {
    const { candidatos, todos } = await resolverDestino(page, texto);
    log('');
    if (!candidatos.length) {
      warn('Ninguna ciudad; esto es lo que sugiere Agoda:');
      for (const s of todos.slice(0, 10)) log(c('gray', `   ${s.texto ?? s.nombre}`));
      return;
    }
    for (const s of candidatos.slice(0, 10)) {
      log(`  ${c('bold', String(s.ciudadFinal).padStart(8))}  ${(s.texto ?? s.nombre).padEnd(44)} ${c('gray', `${s.hoteles ?? 0} alojamientos`)}`);
    }
    log(c('gray', '\n  El primero es el que usa "agoda buscar". Podes pasar el id con --url o buscar por nombre.'));
  } finally {
    await cerrar();
  }
}

// --- seleccion de busqueda --------------------------------------------------

function elegirBusqueda(db, op, pos) {
  if (op.busqueda) {
    const b = DB.buscarBusqueda(db, { id: Number(op.busqueda) });
    if (!b) throw new Error(`No existe la busqueda ${op.busqueda}. Mirá "agoda buscas".`);
    return b;
  }
  // Si dieron fecha/ciudad, buscamos la que coincida.
  const todas = DB.listarBusquedas(db);
  if (!todas.length) throw new Error('No hay nada guardado todavia. Empeza con: agoda buscar "Buenos Aires"');

  let cand = todas;
  if (op.noche !== undefined) {
    const f = parseFecha(op.noche);
    cand = cand.filter((b) => b.check_in === f);
  }
  const destino = pos?.[0];
  if (destino) {
    const t = normalizar(destino);
    cand = cand.filter((b) => normalizar(b.ciudad).includes(t));
  }
  if (!cand.length) throw new Error('Ninguna busqueda guardada coincide con eso. Mirá "agoda buscas".');
  return cand[0];
}

// --- reconstruir la base desde los archivos ----------------------------------

export async function cmdSincronizar(db, op, pos) {
  const dir = pos[0] ?? (op.serie === true || op.serie === undefined ? 'datos' : op.serie);
  const r = importarSerie(db, dir);
  if (op.silencioso) {
    log(`${new Date().toISOString()} sincronizado ${dir}: ${r.importadas} nuevas, ${r.salteadas} ya estaban${r.rotas ? `, ${r.rotas} ilegibles` : ''}`);
    return;
  }
  log('');
  if (!r.archivos) {
    log(c('gray', `  No hay muestras guardadas en ${dir}/`));
    log(c('gray', '  Se crean solas con:  agoda buscar ... --serie datos'));
    return;
  }
  log(`  ${c('bold', String(r.importadas))} muestras nuevas importadas de ${r.archivos} archivos en ${dir}/`);
  if (r.salteadas) log(c('gray', `  ${r.salteadas} ya estaban en la base`));
  if (r.rotas) log(c('yellow', `  ! ${r.rotas} archivos ilegibles, salteados`));
  const b = DB.buscarBusqueda(db);
  if (b) log(c('gray', `  Ultima busqueda: ${b.ciudad ?? b.ciudad_id} ${b.check_in}`));
}

// --- a que hora conviene reservar --------------------------------------------

export async function cmdHorarios(db, op, pos) {
  const busqueda = elegirBusqueda(db, op, pos);

  // Si filtraron (por ejemplo solo deptos), analizamos solo esas propiedades.
  let propiedades = null;
  const fo = opcionesFiltro(op);
  const hayFiltro = op.tipo || op.zona || op['sin-zona'] || op.max || op['min-nota'] || op.cerca;
  if (hayFiltro) {
    const snap = DB.ultimoSnapshot(db, busqueda.id);
    if (snap) propiedades = new Set(filtrar(DB.filasSnapshot(db, snap.id), fo).map((f) => f.property_id));
  }

  const minSeries = num(op['min-muestras'], 5);
  const criterio = normalizar(op.criterio ?? 'mediana');
  const r = analizarHorarios(db, busqueda, {
    noches: num(op.noches_atras ?? op.dias, 30), propiedades, minSeriesPorHora: minSeries, criterio,
  });

  if (!r.horas.length) {
    throw new Error('No hay suficientes muestras guardadas todavia. Dejalo corriendo con "agoda programar".');
  }
  if (op.json) { log(JSON.stringify(r, null, 2)); return; }

  encabezado(busqueda);
  log(c('gray', `${r.nochesAnalizadas} noches · ${r.series} series (alojamiento en una noche) · ${r.observaciones} observaciones${propiedades ? ` · solo ${propiedades.size} alojamientos que pasan tus filtros` : ''}`));
  log(c('gray', `horas en ${zonaHoraria()}`));
  log('');
  log(OUT.tablaHorarios(r.horas, { minSeries, mejor: r.mejor, grafica: criterio === 'promedio' ? 'promedio' : 'mediana' }));
  log('');

  const hh = (h) => `${String(h.hora).padStart(2, '0')}:00`;
  const valorDe = { mediana: (h) => h.indicePct, promedio: (h) => h.promedioPct, minimos: (h) => h.indicePct }[criterio];

  if (r.mejor) {
    const v = valorDe(r.mejor);
    if (criterio === 'minimos') {
      log(`  ${c('bold', c('green', `A las ${hh(r.mejor)} es cuando mas seguido cae el precio mas bajo del dia`))} (${r.mejor.vecesMinimo} veces).`);
    } else if (v < -1) {
      log(`  ${c('bold', c('green', `La mejor hora suele ser a las ${hh(r.mejor)}`))}: ${fmtPct(v)} respecto de lo que vale el resto del dia.`);
    } else {
      log(`  ${c('bold', 'No se ve una hora claramente mejor')}: la mas baja es ${hh(r.mejor)} y apenas ${fmtPct(v)}.`);
    }
    if (r.peor && r.peor.indicePct > 1) {
      log(c('gray', `  La peor suele ser a las ${hh(r.peor)} (${fmtPct(r.peor.indicePct)}).`));
    }
  }

  // Si los criterios no coinciden, decirlo: significa que unos pocos se desploman
  // a una hora mientras el resto baja parejo a otra.
  if (!r.coinciden) {
    const c1 = r.porCriterio;
    log(c('yellow', '  ! Los criterios no coinciden:'));
    if (c1.mediana) log(c('gray', `      tipico   → ${hh(c1.mediana)} (${fmtPct(c1.mediana.indicePct)}): la hora mas barata para un alojamiento cualquiera`));
    if (c1.promedio) log(c('gray', `      promedio → ${hh(c1.promedio)} (${fmtPct(c1.promedio.promedioPct)}): la hora con mayor descuento promedio, la mueven las bajadas fuertes`));
    if (c1.minimos) log(c('gray', `      minimos  → ${hh(c1.minimos)}: donde mas seguido cae el precio mas bajo (${c1.minimos.vecesMinimo} veces)`));
    log(c('gray', '      Elegí con --criterio mediana|promedio|minimos.'));
  } else if (r.mejor) {
    log(c('gray', '  Los tres criterios (tipico, promedio y minimos) apuntan a la misma hora.'));
  }

  const color = { nada: 'red', poco: 'yellow', medio: 'yellow', bien: 'green' }[r.aviso.nivel];
  log(c(color, `  ${r.aviso.nivel === 'bien' ? '' : '! '}${r.aviso.texto}`));
  log(c('gray', '  Cada alojamiento se compara consigo mismo esa noche, asi que no lo desvian los caros.'));
  log(c('gray', '  "tipico" es la mediana; "promedio" es el promedio geometrico, que es el que corresponde para ratios.'));
}

// --- descartados -------------------------------------------------------------

/**
 * agoda descartar 12345 67890     -> no los muestres mas
 * agoda descartar --quitar 12345  -> volvelos a mostrar
 * agoda descartar                 -> cuales hay
 */
export async function cmdDescartar(db, op, pos) {
  const ids = pos.map((x) => String(x).trim()).filter(Boolean);

  if (op.quitar) {
    if (!ids.length) throw new Error('Decime cual: agoda descartar --quitar 12345');
    const sacados = recuperar(ids);
    log(sacados.length
      ? c('green', `  Vuelven a aparecer: ${sacados.join(', ')}`)
      : c('gray', '  Ninguno de esos estaba descartado.'));
    return;
  }

  if (ids.length) {
    // El nombre es solo para que la lista se pueda leer despues.
    const nombres = new Map();
    for (const id of ids) {
      const p = db.prepare('SELECT nombre FROM propiedades WHERE property_id = ?').get(Number(id));
      if (p?.nombre) nombres.set(id, p.nombre);
    }
    const nuevos = descartar(ids.map((id) => ({ id, nombre: nombres.get(id) ?? null })));
    const repetidos = ids.length - nuevos.length;
    log(nuevos.length
      ? c('green', `  Descartados ${nuevos.length}: no van a volver a aparecer.`)
      : c('gray', '  Ya estaban todos descartados.'));
    if (repetidos && nuevos.length) log(c('gray', `  (${repetidos} ya estaban)`));
  }

  const lista = leerDescartados();
  const claves = Object.keys(lista);
  log('');
  if (!claves.length) {
    log(c('gray', '  No hay ninguno descartado.'));
    log(c('gray', '  Se descartan con la cruz de la pagina, o con: agoda descartar <id>'));
    return;
  }
  log(c('bold', `  ${claves.length} descartado${claves.length > 1 ? 's' : ''}`));
  for (const id of claves) log(`    ${String(id).padStart(9)}  ${lista[id].nombre ?? c('gray', 'sin nombre')}`);
  log(c('gray', `\n  El archivo: ${rutaDescartados()}`));
  log(c('gray', '  Para que vuelva alguno:  agoda descartar --quitar <id>'));
}

// --- servir la pagina --------------------------------------------------------

/** Las IPs por las que se puede llegar a esta maquina, para decirte que abrir. */
export function direcciones(puerto) {
  const salida = [];
  for (const [nombre, redes] of Object.entries(os.networkInterfaces())) {
    for (const r of redes ?? []) {
      if (r.family !== 'IPv4' || r.internal) continue;
      salida.push({ nombre, url: `http://${r.address}:${puerto}` });
    }
  }
  return salida;
}

/**
 * Deja la pagina servida por HTTP. Es para cuando el seguimiento corre en un
 * servidor: la tarea de cada hora reescribe el html y vos lo abris del celular.
 */
export async function cmdServir(db, op, pos) {
  const carpeta = pos[0] ?? op.carpeta ?? 'reportes';
  const puerto = num(op.puerto, 8080);
  const host = op.host ?? '0.0.0.0';
  const clave = typeof op.clave === 'string' && op.clave ? op.clave : null;

  if (!existsSync(carpeta)) {
    throw new Error(`No existe la carpeta "${carpeta}". La pagina se genera con:\n` +
      `  agoda buscar "Buenos Aires" --html ${path.join(carpeta, 'hoy.html')}`);
  }

  const servidor = crearServidor({
    carpeta,
    clave,
    alPedido: (codigo, metodo, url) => log(c('gray', `  ${new Date().toISOString()} ${codigo} ${metodo} ${recortar(url, 60)}`)),
  });

  await new Promise((listo, error) => {
    servidor.once('error', (e) => {
      error(e.code === 'EADDRINUSE'
        ? new Error(`El puerto ${puerto} ya esta ocupado. Proba con --puerto ${puerto + 1}.`)
        : e);
    });
    servidor.listen(puerto, host, listo);
  });

  const tapa = portada(path.resolve(carpeta));
  const sufijo = clave ? `/?k=${encodeURIComponent(clave)}` : '/';
  log('');
  log(c('green', `  Sirviendo ${path.resolve(carpeta)} en el puerto ${puerto}`));
  log(c('gray', `  La raiz "/" te da ${tapa ?? 'nada todavia: falta generar el html'}`));
  for (const d of direcciones(puerto)) log(`    ${d.url}${sufijo}  ${c('gray', `(${d.nombre})`)}`);
  if (!clave) log(c('gray', '  Sin clave: cualquiera que sepa la IP y el puerto puede verla. Con --clave <palabra> se pide.'));
  log(c('gray', '  Cortalo con Ctrl-C.'));
  log('');

  // No termina: se queda escuchando hasta que lo mates.
  await new Promise(() => {});
}

// --- salud de la automatizacion ----------------------------------------------

/** En que zona horaria se estan leyendo las horas. Importa si corre en un servidor. */
export function zonaHoraria() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'la del sistema'; } catch { return 'la del sistema'; }
}

/**
 * La zona de la maquina, ignorando AGODA_TZ: es con la que cron decide a que
 * hora dispara. Un servidor recien hecho viene en UTC, asi que "de 11 a 23"
 * terminaria siendo de 8 a 20 hora de Buenos Aires.
 */
export function zonaDelSistema() {
  const previa = process.env.TZ;
  try {
    delete process.env.TZ;
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'la del sistema';
  } catch {
    return 'la del sistema';
  } finally {
    if (previa !== undefined) process.env.TZ = previa;
  }
}

export async function cmdEstado(db, op, pos) {
  log('');
  log(c('gray', `  Horas en ${zonaHoraria()} (cambiala con AGODA_TZ)`));
  log(c('bold', '  Tareas programadas'));
  for (const t of estadoCron()) {
    log(`    ${t.icono} ${t.texto}`);
    if (t.linea) log(c('gray', `       ${recortar(t.linea, 108)}`));
  }

  const registro = op.registro ?? 'data/agoda.log';
  log('');
  log(c('bold', `  Registro (${registro})`));
  for (const l of estadoRegistro(registro)) log(`    ${l}`);

  const busqueda = (() => { try { return elegirBusqueda(db, op, pos); } catch { return null; } })();
  if (!busqueda) { log(c('gray', '\n  Todavia no hay busquedas guardadas.')); return; }

  log('');
  log(c('bold', '  Muestras guardadas'));
  const noches = nochesDelPerfil(db, busqueda, { noches: 14 })
    .map((n) => ({ noche: n, snaps: DB.listarSnapshots(db, n.id, 999) }))
    .filter((x) => x.snaps.length);

  if (!noches.length) { log(c('gray', '    ninguna todavia')); return; }

  for (const { noche, snaps } of noches.slice(0, 7)) {
    const horas = [...new Set(snaps.map((s) => new Date(s.tomado).getHours()))].sort((a, b) => a - b);
    log(`    ${noche.check_in}  ${String(snaps.length).padStart(3)} muestras  ${c('gray', franjaHoraria(horas))}`);
  }

  const ultima = noches[0].snaps[0];
  const horasDesde = (Date.now() - new Date(ultima.tomado).getTime()) / 3600_000;
  log('');
  if (horasDesde > 3) {
    log(c('yellow', `  ! La ultima muestra es de hace ${horasDesde.toFixed(1)} h. Si esperabas una por hora, algo no esta corriendo.`));
  } else {
    log(c('green', `  Ultima muestra hace ${horasDesde < 1 ? Math.round(horasDesde * 60) + ' min' : horasDesde.toFixed(1) + ' h'}.`));
  }

  const huecos = huecosEntreMuestras(noches[0].snaps);
  if (huecos.maximo != null) {
    log(c('gray', `  Hoy: ${noches[0].snaps.length} muestras, hueco mas largo ${huecos.maximo.toFixed(1)} h, tipico ${huecos.mediano.toFixed(1)} h.`));
  }
}

/** Dibuja que horas del dia estan cubiertas: una barra de 24 casilleros. */
function franjaHoraria(horas) {
  const set = new Set(horas);
  let s = '';
  for (let h = 0; h < 24; h++) s += set.has(h) ? '▪' : '·';
  return `${s}  ${String(Math.min(...horas)).padStart(2, '0')}-${String(Math.max(...horas)).padStart(2, '0')}h`;
}

function huecosEntreMuestras(snaps) {
  const t = snaps.map((s) => new Date(s.tomado).getTime()).sort((a, b) => a - b);
  if (t.length < 2) return { maximo: null, mediano: null };
  const dif = [];
  for (let i = 1; i < t.length; i++) dif.push((t[i] - t[i - 1]) / 3600_000);
  dif.sort((a, b) => a - b);
  return { maximo: dif[dif.length - 1], mediano: dif[Math.floor(dif.length / 2)] };
}

function estadoCron() {
  if (process.platform === 'win32') {
    return [{ icono: '?', texto: 'En Windows revisalo con:  schtasks /query | findstr agoda' }];
  }
  let texto;
  try {
    texto = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return [{ icono: c('yellow', '!'), texto: 'No pude leer el crontab (o no hay ninguno). Instala con: agoda programar ... --instalar' }];
  }
  const tareas = tareasEnCrontab(texto);
  if (!tareas.length) {
    return [{ icono: c('yellow', '!'), texto: 'No hay ninguna instalada. Ponela con: agoda programar ... --instalar' }];
  }
  return tareas.map((t) => ({
    icono: c('green', '✓'),
    texto: `${c('bold', t.nombre)} — ${(t.linea ?? '').split(' ').slice(0, 5).join(' ')}`,
    linea: t.linea,
  }));
}

function estadoRegistro(ruta) {
  if (!existsSync(ruta)) {
    return [c('gray', 'todavia no existe (se crea en la primera corrida programada)')];
  }
  const lineas = readFileSync(ruta, 'utf8').split('\n').filter((l) => l.trim());
  if (!lineas.length) return [c('gray', 'vacio')];

  const corridas = lineas.filter((l) => /^\d{4}-\d{2}-\d{2}T/.test(l));
  const errores = lineas.filter((l) => /error|Error|ERR_|Cannot|no encontr/i.test(l));
  const salida = [`${corridas.length} corridas registradas`];
  if (corridas.length) salida.push(c('gray', `ultima: ${recortar(corridas[corridas.length - 1], 100)}`));
  salida.push(errores.length ? c('red', `${errores.length} lineas con errores; la ultima:`) : c('green', 'sin errores'));
  if (errores.length) salida.push(c('gray', `  ${recortar(errores[errores.length - 1], 100)}`));
  return salida;
}

// --- comparar contra la noche anterior ---------------------------------------

export async function cmdComparar(db, op, pos) {
  const busqueda = elegirBusqueda(db, op, pos);
  const diasAtras = num(op.contra, 1);
  const r = compararConDiaAnterior(db, busqueda, {
    diasAtras,
    hora: op.hora === undefined ? null : num(op.hora),
    toleranciaMin: num(op.tolerancia, 90),
    base: normalizar(op.base ?? 'auto'),
  });

  if (!r.hermana) {
    throw new Error(
      `No tengo guardada la noche del ${r.checkInAnterior} para esa misma busqueda.\n` +
      `La comparacion necesita haber muestreado las dos noches: dejala corriendo con "agoda programar".`
    );
  }
  if (!r.filas.length) {
    warn(`Las dos noches estan guardadas pero no hay con que cruzarlas.`);
    log(c('gray', '  Proba con --hora <h>, subiendo --tolerancia, o --base mejor.'));
    return;
  }

  const conFiltros = filtrar(
    r.filas.map((f) => ({ ...f, ...(db.prepare('SELECT * FROM propiedades WHERE property_id = ?').get(f.property_id) ?? {}), por_noche: f.hoy, disponible: 1 })),
    opcionesFiltro(op),
  );
  const listas = conFiltros
    .map((f) => ({ ...f, _precio: f.hoy }))
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));

  if (op.json) { log(JSON.stringify(listas, null, 2)); return; }

  encabezado(busqueda);
  if (r.porBase.hora && !r.porBase.mejor) {
    log(c('gray', `contra la noche del ${r.hermana.check_in}, cruzando cada uno a las ~${r.referencia.etiqueta}`));
  } else if (r.porBase.mejor && !r.porBase.hora) {
    log(c('gray', `contra el mejor precio que toco cada uno la noche del ${r.hermana.check_in}`));
    log(c('yellow', '! Ojo: ese mejor precio es el piso de toda esa noche, asi que la comparacion tira para arriba.'));
  } else {
    log(c('gray', `contra la noche del ${r.hermana.check_in}: ${r.porBase.hora} a las ~${r.referencia.etiqueta}, ${r.porBase.mejor} contra el mejor precio de esa noche`));
  }
  log('');
  const limite = num(op.limite, 25);
  log(OUT.tablaComparacion(listas.slice(0, limite), { moneda: busqueda.moneda }));

  const bajaron = listas.filter((f) => f.delta < 0);
  const subieron = listas.filter((f) => f.delta > 0);
  const medianaPct = mediana(listas.map((f) => f.pct).filter((x) => x != null));
  log('');
  // El texto tiene que decir contra que se comparo, o el numero enganna.
  const soloPiso = r.porBase.mejor && !r.porBase.hora;
  const contraQue = soloPiso
    ? `lo mejor de ${diasAtras === 1 ? 'anoche' : 'esa noche'}`
    : (diasAtras === 1 ? 'anoche' : 'esa noche');
  const iguales = listas.length - bajaron.length - subieron.length;
  log(`  ${c('bold', String(listas.length))} comparables · ${c('green', `${bajaron.length} mas baratos que ${contraQue}`)} · ` +
      `${c('red', `${subieron.length} mas caros`)}` + (iguales ? c('gray', ` · ${iguales} igual`) : ''));
  if (medianaPct != null) {
    const signo = medianaPct < 0 ? c('green', fmtPct(medianaPct)) : c('red', fmtPct(medianaPct));
    const base = soloPiso ? 'del piso de esa noche' : 'de la anterior a la misma hora';
    log(`  En conjunto, la noche esta ${signo} respecto ${base}.`);
  }
  if (r.porBase.mejor && r.porBase.hora) {
    log(c('gray', `  ${r.porBase.mejor} de esas comparan contra el mejor precio de la noche (marcadas "mejor"), no contra la misma hora.`));
  }
  if (r.sinPar) log(c('gray', `  ${r.sinPar} publicaciones de hoy no estaban esa noche (no se pueden comparar).`));
  if (listas.length > limite) log(c('gray', `  (mostrando ${limite} de ${listas.length}; usa --limite)`));
}

function mediana(xs) {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

// --- programar ---------------------------------------------------------------

// Cada tarea programada lleva nombre: asi se puede seguir mas de una busqueda a
// la vez (la noche de hoy y, por ejemplo, un finde puntual) sin que una pise a la
// otra al instalarse.
const MARCA_INICIO = (nombre) => `# >>> agoda-tracker:${nombre}`;
const MARCA_FIN = (nombre) => `# <<< agoda-tracker:${nombre}`;
const RE_MARCA_INICIO = /^#\s*>>>\s*agoda-tracker(?::(.+))?$/;
const RE_MARCA_FIN = /^#\s*<<<\s*agoda-tracker(?::(.+))?$/;

/** Nombre de tarea usable en un crontab y en un nombre de archivo. */
export function nombreDeTarea(txt) {
  const limpio = normalizar(txt ?? 'hoy').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!limpio) throw new Error(`Nombre de tarea invalido: "${txt}"`);
  return limpio;
}

// Opciones que tiene sentido arrastrar a la tarea programada.
const HEREDABLES = [
  'moneda', 'paginas', 'adultos', 'ninos', 'habitaciones', 'noches', 'noche', 'url',
  'tipo', 'zona', 'sin-zona', 'max', 'min', 'max-total', 'min-nota', 'min-reviews',
  'min-estrellas', 'cerca', 'radio', 'cancelacion-gratis', 'texto', 'todos',
  'fotos', 'fotos-ancho', 'db', 'pestanas', 'serie',
];

function raizProyecto() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

const entrecomillar = (v) => (/^[\w.,:\/@+-]+$/.test(String(v)) ? String(v) : `"${String(v).replace(/(["$`\\])/g, '\\$1')}"`);

/** Reconstruye la linea de comando que va a correr cada hora. */
function comandoProgramado(op, destino, { html, registro, entorno = false }) {
  const raiz = raizProyecto();
  const partes = [entrecomillar(process.execPath), 'bin/agoda.mjs', 'buscar'];
  if (destino) partes.push(entrecomillar(destino));
  for (const clave of HEREDABLES) {
    const v = op[clave];
    if (v === undefined) continue;
    if (v === true) partes.push(`--${clave}`);
    else partes.push(`--${clave}`, entrecomillar(v));
  }
  if (op.paginas === undefined) partes.push('--paginas', 'todas');
  if (op.noche === undefined) partes.push('--noche', 'hoy');
  partes.push('--silencioso', '--html', entrecomillar(html));
  // En cron la zona va delante del comando: el proceso hereda la del sistema, que
  // en un servidor recien hecho es UTC, y ahi "hoy" seria otra noche.
  const zona = entorno ? `AGODA_TZ=${entrecomillar(zonaHoraria())} ` : '';
  return { raiz, linea: `cd ${entrecomillar(raiz)} && ${zona}${partes.join(' ')} >> ${entrecomillar(registro)} 2>&1` };
}

/** Los tres primeros campos del cron: minutos, horas, y el resto todos los dias. */
export function horarioCron(cada, desde, hasta) {
  const minutos = cada === 60 ? '0' : `*/${cada}`;
  const horas = desde === hasta ? String(desde) : `${desde}-${hasta}`;
  return `${minutos} ${horas} * * *`;
}

export function horaDe(txt, porDefecto) {
  const s = String(txt ?? porDefecto).trim();
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new Error(`Hora invalida: "${s}". Usa por ejemplo 12 o 12:00.`);
  const h = Number(m[1]);
  if (h < 0 || h > 23) throw new Error(`Hora fuera de rango: ${h}`);
  return h;
}

function leerCrontab() {
  try {
    return execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return ''; // todavia no hay crontab, o no existe el comando
  }
}

function escribirCrontab(texto) {
  try {
    execFileSync('crontab', ['-'], { input: texto.endsWith('\n') ? texto : texto + '\n', stdio: ['pipe', 'ignore', 'pipe'] });
  } catch (e) {
    // Hay imagenes de servidor que vienen sin cron. Sin esto sale un
    // "spawnSync crontab ENOENT" que no le dice nada a nadie.
    if (e.code === 'ENOENT') {
      throw new Error('No hay comando "crontab" en esta maquina, asi que no puedo programar nada.\n' +
        '  En Ubuntu/Debian:  sudo apt-get install -y cron && sudo systemctl enable --now cron');
    }
    throw e;
  }
}

/**
 * Saca del crontab el bloque de una tarea (o todos los de agoda si nombre es null).
 * Los bloques viejos sin nombre cuentan como la tarea "hoy", para no dejar
 * huerfano lo que ya estaba instalado.
 */
export function sinBloque(texto, nombre = null) {
  const lineas = texto.split('\n');
  const salida = [];
  let dentro = false;
  for (const l of lineas) {
    const t = l.trim();
    const abre = RE_MARCA_INICIO.exec(t);
    if (abre) {
      const suyo = abre[1] ?? 'hoy';
      if (nombre === null || suyo === nombre) { dentro = true; continue; }
    }
    const cierra = RE_MARCA_FIN.exec(t);
    if (cierra && dentro) { dentro = false; continue; }
    if (!dentro) salida.push(l);
  }
  return salida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Las tareas de agoda que hay instaladas: nombre -> linea de cron. */
export function tareasEnCrontab(texto) {
  const lineas = texto.split('\n');
  const tareas = [];
  let actual = null;
  for (const l of lineas) {
    const t = l.trim();
    const abre = RE_MARCA_INICIO.exec(t);
    if (abre) { actual = { nombre: abre[1] ?? 'hoy', linea: null }; continue; }
    if (RE_MARCA_FIN.test(t)) { if (actual) tareas.push(actual); actual = null; continue; }
    if (actual && t && !t.startsWith('#') && !actual.linea) actual.linea = t;
  }
  return tareas;
}

export async function cmdProgramar(db, op, pos) {
  const cada = num(op.cada, 60);
  if (cada < 5 || cada > 60 || 60 % cada !== 0) {
    throw new Error(`--cada tiene que dividir a 60 (5, 10, 12, 15, 20, 30 o 60). Recibi ${cada}.`);
  }
  const desde = horaDe(op['desde-hora'], 12);
  const hasta = horaDe(op['hasta-hora'], 23);
  if (hasta < desde) throw new Error(`--hasta-hora (${hasta}) no puede ser antes que --desde-hora (${desde}).`);

  const nombre = nombreDeTarea(op.nombre ?? (op.noche && normalizar(op.noche) !== 'hoy' ? op.noche : 'hoy'));

  if (op.quitar) {
    if (process.platform === 'win32') {
      log(`  En Windows:  schtasks /delete /tn "agoda-${nombre}" /f`);
      return;
    }
    const actual = leerCrontab();
    const cuales = op.quitar === true && op.todo ? null : nombre;
    const previas = tareasEnCrontab(actual);
    escribirCrontab(sinBloque(actual, cuales));
    const quedan = tareasEnCrontab(leerCrontab());
    log(c('green', `  Listo, saque ${cuales === null ? 'todas las tareas' : `la tarea "${nombre}"`} del crontab.`));
    if (previas.length && quedan.length) log(c('gray', `  Siguen instaladas: ${quedan.map((t) => t.nombre).join(', ')}`));
    return;
  }

  const destino = pos[0] ?? DB.buscarBusqueda(db)?.ciudad ?? null;
  if (!destino && !op.url) throw new Error('Decime un destino: agoda programar "Buenos Aires"');

  const html = op.html ?? `reportes/${nombre}.html`;
  const registro = op.registro ?? 'data/agoda.log';
  // La linea de cron lleva la zona adelante; la de Windows no, que la pone el .cmd.
  const { raiz, linea } = comandoProgramado(op, destino, { html, registro, entorno: process.platform !== 'win32' });
  const cron = `${horarioCron(cada, desde, hasta)} ${linea}`;

  const porDia = Math.floor(60 / cada) * (hasta - desde + 1);
  log('');
  log(`  Tarea ${c('bold', nombre)} · ${c('bold', `cada ${cada} min, de ${desde}:00 a ${hasta}:59`)} ${c('gray', `(${porDia} muestras por dia)`)}`);
  log(c('gray', `  Cada corrida guarda una muestra y regenera ${html}`));
  log('');

  // cron dispara con la hora de la maquina, no con AGODA_TZ.
  const zona = zonaHoraria();
  const sistema = zonaDelSistema();
  if (process.platform !== 'win32' && sistema !== zona) {
    warn(`La maquina esta en ${sistema} y vos medis en ${zona}.`);
    log(c('gray', `  cron dispara con la hora de la maquina, asi que "de ${desde} a ${hasta}" seria hora ${sistema}.`));
    log(c('gray', `  Emparejalas con:  sudo timedatectl set-timezone ${zona}`));
    log('');
  }

  if (process.platform === 'win32') {
    // /ri con /du cubre una franja horaria; /sc minute correria las 24 horas.
    const horas = Math.max(1, hasta - desde);
    const tarea = `schtasks /create /tn "agoda-${nombre}" /tr ${entrecomillar(linea)} ` +
      `/sc DAILY /st ${String(desde).padStart(2, '0')}:00 /ri ${cada} /du ${String(horas).padStart(2, '0')}:00 /f`;
    log(c('bold', '  Windows:'));
    log(`\n${tarea}\n`);
    log(c('gray', '  Mas simple:  powershell -ExecutionPolicy Bypass -File scripts\\instalar.ps1'));
    log(c('gray', `  Para sacarla:  schtasks /delete /tn "agoda-${nombre}" /f`));
    return;
  }

  log(c('bold', '  Linea de crontab:'));
  log(`\n${MARCA_INICIO(nombre)}\n${cron}\n${MARCA_FIN(nombre)}\n`);

  if (!op.instalar) {
    log(c('gray', '  Para ponerla:   agoda programar ... --instalar'));
    log(c('gray', '  O a mano:       crontab -e   y pegá la línea de arriba'));
    log(c('gray', `  El registro queda en ${path.join(raiz, registro)}`));
    if (process.platform === 'darwin') {
      log(c('yellow', '  ! En macOS, cron necesita permiso de Disco Completo para tu terminal'));
      log(c('gray', '    (Ajustes → Privacidad y seguridad → Acceso total al disco).'));
    }
    return;
  }

  const actual = leerCrontab();
  // sinBloque(actual, nombre) saca solo ESTA tarea: las otras quedan intactas.
  const nuevo = [sinBloque(actual, nombre), MARCA_INICIO(nombre), cron, MARCA_FIN(nombre)].filter(Boolean).join('\n');
  escribirCrontab(nuevo);
  const todas = tareasEnCrontab(leerCrontab());
  log(c('green', `  Tarea "${nombre}" instalada en el crontab.`));
  if (todas.length > 1) log(c('gray', `  Tareas de agoda instaladas: ${todas.map((t) => t.nombre).join(', ')}`));
  log(c('gray', `  Verificala con:  agoda estado`));
  log(c('gray', `  Sacala con:      agoda programar --quitar --nombre ${nombre}`));
  log(c('gray', `  El registro queda en ${path.join(raiz, registro)}`));
}
