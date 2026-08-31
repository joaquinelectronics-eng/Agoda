// Los comandos del CLI.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as DB from './db.mjs';
import { abrirNavegador } from './browser.mjs';
import { construirUrl, leerUrl, ajustarUrl, resolverDestino, scrapear } from './agoda.mjs';
import { filtrar, enriquecer, ordenar, parsearCoords } from './filtros.mjs';
import * as OUT from './salida.mjs';
import {
  c, log, warn, parseFecha, isoDate, num, sleep, haceCuanto, horaCorta,
  fmtPrecio, fmtPct, recortar, sparkline, normalizar,
} from './util.mjs';

// --- helpers compartidos ----------------------------------------------------

const huella = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 10);

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
    log(c('gray', `  (usando el destino de la ultima busqueda: ${ultima.ciudad ?? ultima.ciudad_id})`));
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
  const vivas = filtrar(filas, fo);
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
  const { page, cerrar } = await abrirNavegador({ headful: op.headful === true });
  let ctx, datos;
  try {
    ctx = await armarBusqueda(db, page, op, pos);
    log(c('gray', `  buscando: ${ctx.url}`));
    datos = await scrapear(page, ctx.url, { paginas: num(op.paginas, 3) });
  } finally {
    await cerrar();
  }

  const busqueda = DB.guardarBusqueda(db, {
    ...ctx, ciudad: datos.ciudad ?? ctx.ciudad, ciudadId: datos.ciudadId ?? ctx.ciudadId,
  });
  const { snapshotId } = op['sin-guardar']
    ? { snapshotId: null }
    : DB.guardarSnapshot(db, busqueda.id, datos.propiedades, { totalDisponibles: datos.totalDisponibles, paginas: datos.paginas });

  const filas = snapshotId
    ? filasConHistoria(db, busqueda.id, snapshotId)
    : datos.propiedades.map((p) => ({ ...p, property_id: p.propertyId, por_noche: p.porNoche, tipo_id: p.tipoId }));

  const listas = preparar(filas, op);
  if (op.json) { log(JSON.stringify(listas, null, 2)); return; }

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
  exportar(db, listas, op, { busqueda });
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
      datos = await scrapear(page, ctx.url, { paginas: num(op.paginas, 3), verboso: false });
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

export async function cmdReporte(db, op, pos) {
  const busqueda = elegirBusqueda(db, op, pos);
  const snap = DB.ultimoSnapshot(db, busqueda.id);
  if (!snap) throw new Error('Esa busqueda no tiene muestras.');

  const filas = preparar(filasConHistoria(db, busqueda.id, snap.id), op);
  const historiales = {};
  for (const f of filas) historiales[f.property_id] = DB.historial(db, busqueda.id, f.property_id);

  const ruta = op.html || `reportes/agoda-${busqueda.check_in}.html`;
  const destino = OUT.guardar(ruta, OUT.reporteHtml(filas, { busqueda, historiales }));
  log(`\n  Reporte con ${filas.length} alojamientos: ${c('bold', destino)}`);
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
