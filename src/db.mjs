// Persistencia en SQLite (modulo nativo de Node, sin dependencias).

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ahoraISO } from './util.mjs';

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS busquedas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  clave        TEXT UNIQUE NOT NULL,
  ciudad_id    INTEGER,
  ciudad       TEXT,
  check_in     TEXT NOT NULL,
  los          INTEGER NOT NULL,
  adultos      INTEGER,
  ninos        INTEGER,
  habitaciones INTEGER,
  moneda       TEXT,
  url          TEXT,
  creada       TEXT,
  ultima       TEXT
);

CREATE TABLE IF NOT EXISTS propiedades (
  property_id  INTEGER PRIMARY KEY,
  nombre       TEXT,
  tipo_id      INTEGER,
  tipo         TEXT,
  familia      TEXT,
  estrellas    REAL,
  zona         TEXT,
  ciudad       TEXT,
  ciudad_id    INTEGER,
  pais         TEXT,
  lat          REAL,
  lon          REAL,
  url          TEXT,
  imagen       TEXT,
  nota         REAL,
  reviews      INTEGER,
  actualizada  TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  busqueda_id       INTEGER NOT NULL REFERENCES busquedas(id),
  tomado            TEXT NOT NULL,
  n                 INTEGER,
  total_disponibles INTEGER,
  paginas           INTEGER
);

CREATE TABLE IF NOT EXISTS precios (
  snapshot_id         INTEGER NOT NULL REFERENCES snapshots(id),
  property_id         INTEGER NOT NULL REFERENCES propiedades(property_id),
  por_noche           REAL,
  por_noche_sin_imp   REAL,
  total               REAL,
  tachado             REAL,
  moneda              TEXT,
  disponible          INTEGER,
  cancelacion         TEXT,
  habitaciones_libres INTEGER,
  PRIMARY KEY (snapshot_id, property_id)
);

CREATE TABLE IF NOT EXISTS destinos (
  texto     TEXT PRIMARY KEY,
  ciudad_id INTEGER,
  nombre    TEXT,
  guardado  TEXT
);

CREATE INDEX IF NOT EXISTS ix_snapshots_busqueda ON snapshots(busqueda_id, tomado);
CREATE INDEX IF NOT EXISTS ix_precios_prop ON precios(property_id);
`;

export function rutaDb() {
  if (process.env.AGODA_DB) return process.env.AGODA_DB;
  const dir = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'agoda.db');
}

export function abrirDb(ruta = rutaDb()) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(ESQUEMA);
  return db;
}

export function claveBusqueda({ ciudadId, checkIn, los, adultos, ninos, habitaciones, moneda }) {
  return [ciudadId, checkIn, los, adultos, ninos, habitaciones, moneda].join('|');
}

export function guardarBusqueda(db, b) {
  const clave = claveBusqueda(b);
  const ahora = ahoraISO();
  db.prepare(`
    INSERT INTO busquedas (clave, ciudad_id, ciudad, check_in, los, adultos, ninos, habitaciones, moneda, url, creada, ultima)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(clave) DO UPDATE SET ultima = excluded.ultima, url = excluded.url, ciudad = COALESCE(excluded.ciudad, busquedas.ciudad)
  `).run(clave, b.ciudadId ?? null, b.ciudad ?? null, b.checkIn, b.los, b.adultos ?? null,
         b.ninos ?? null, b.habitaciones ?? null, b.moneda ?? null, b.url ?? null, ahora, ahora);
  return db.prepare('SELECT * FROM busquedas WHERE clave = ?').get(clave);
}

export function buscarBusqueda(db, { clave, id } = {}) {
  if (id) return db.prepare('SELECT * FROM busquedas WHERE id = ?').get(id);
  if (clave) return db.prepare('SELECT * FROM busquedas WHERE clave = ?').get(clave);
  return db.prepare('SELECT * FROM busquedas ORDER BY ultima DESC LIMIT 1').get();
}

export function listarBusquedas(db) {
  return db.prepare(`
    SELECT b.*, COUNT(s.id) AS snapshots, MAX(s.tomado) AS ultimo_snapshot
    FROM busquedas b LEFT JOIN snapshots s ON s.busqueda_id = b.id
    GROUP BY b.id ORDER BY COALESCE(MAX(s.tomado), b.ultima) DESC
  `).all();
}

const b2i = (v) => (v ? 1 : 0);

/** Guarda un snapshot completo (propiedades + precios) en una transaccion. */
export function guardarSnapshot(db, busquedaId, propiedades, { totalDisponibles = null, paginas = null } = {}) {
  const tomado = ahoraISO();
  const upProp = db.prepare(`
    INSERT INTO propiedades (property_id, nombre, tipo_id, tipo, familia, estrellas, zona, ciudad, ciudad_id, pais, lat, lon, url, imagen, nota, reviews, actualizada)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(property_id) DO UPDATE SET
      nombre=excluded.nombre, tipo=COALESCE(excluded.tipo, propiedades.tipo), estrellas=excluded.estrellas,
      zona=COALESCE(excluded.zona, propiedades.zona), url=COALESCE(excluded.url, propiedades.url),
      imagen=COALESCE(excluded.imagen, propiedades.imagen),
      nota=COALESCE(excluded.nota, propiedades.nota), reviews=COALESCE(excluded.reviews, propiedades.reviews),
      actualizada=excluded.actualizada
  `);
  const insPrecio = db.prepare(`
    INSERT OR REPLACE INTO precios
      (snapshot_id, property_id, por_noche, por_noche_sin_imp, total, tachado, moneda, disponible, cancelacion, habitaciones_libres)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);

  db.exec('BEGIN');
  try {
    const info = db.prepare('INSERT INTO snapshots (busqueda_id, tomado, n, total_disponibles, paginas) VALUES (?,?,?,?,?)')
      .run(busquedaId, tomado, propiedades.length, totalDisponibles, paginas);
    const snapshotId = Number(info.lastInsertRowid);

    for (const p of propiedades) {
      upProp.run(p.propertyId, p.nombre, p.tipoId, p.tipo, p.familia, p.estrellas, p.zona, p.ciudad,
                 p.ciudadId, p.pais, p.lat, p.lon, p.url, p.imagen, p.nota, p.reviews, tomado);
      insPrecio.run(snapshotId, p.propertyId, p.porNoche, p.porNocheSinImp, p.total, p.tachado,
                    p.moneda, b2i(p.disponible), p.cancelacion, p.habitacionesLibres);
    }
    db.prepare('UPDATE busquedas SET ultima = ? WHERE id = ?').run(tomado, busquedaId);
    db.exec('COMMIT');
    return { snapshotId, tomado };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function ultimoSnapshot(db, busquedaId) {
  return db.prepare('SELECT * FROM snapshots WHERE busqueda_id = ? ORDER BY tomado DESC, id DESC LIMIT 1').get(busquedaId);
}

export function listarSnapshots(db, busquedaId, limite = 50) {
  return db.prepare('SELECT * FROM snapshots WHERE busqueda_id = ? ORDER BY tomado DESC, id DESC LIMIT ?').all(busquedaId, limite);
}

/** Filas de un snapshot, con los datos de la propiedad ya pegados. */
export function filasSnapshot(db, snapshotId) {
  return db.prepare(`
    SELECT pr.*, p.nombre, p.tipo, p.tipo_id, p.familia, p.estrellas, p.zona, p.ciudad,
           p.lat, p.lon, p.url, p.imagen, p.nota, p.reviews
    FROM precios pr JOIN propiedades p USING (property_id)
    WHERE pr.snapshot_id = ?
  `).all(snapshotId);
}

/**
 * Resumen de evolucion por propiedad para una busqueda:
 * primer precio visto, maximo, minimo, ultimo, y cuanto bajo.
 */
export function evolucion(db, busquedaId, { desdeHoras = null } = {}) {
  const corte = desdeHoras ? new Date(Date.now() - desdeHoras * 3600_000).toISOString() : null;
  return db.prepare(`
    WITH obs AS (
      SELECT pr.property_id, pr.por_noche, pr.total, pr.moneda, pr.disponible, pr.cancelacion,
             pr.habitaciones_libres, s.tomado,
             ROW_NUMBER() OVER (PARTITION BY pr.property_id ORDER BY s.tomado ASC, s.id ASC)   AS rn_ini,
             ROW_NUMBER() OVER (PARTITION BY pr.property_id ORDER BY s.tomado DESC, s.id DESC) AS rn_fin
      FROM precios pr
      JOIN snapshots s ON s.id = pr.snapshot_id
      WHERE s.busqueda_id = ? AND pr.por_noche IS NOT NULL
        AND (? IS NULL OR s.tomado >= ?)
    ),
    agg AS (
      SELECT property_id, MIN(por_noche) AS minimo, MAX(por_noche) AS maximo,
             COUNT(*) AS muestras, MIN(tomado) AS primera_vez, MAX(tomado) AS ultima_vez
      FROM obs GROUP BY property_id
    )
    SELECT p.property_id, p.nombre, p.tipo, p.tipo_id, p.familia, p.estrellas, p.zona, p.ciudad,
           p.lat, p.lon, p.url, p.imagen, p.nota, p.reviews,
           ini.por_noche AS precio_inicial, fin.por_noche AS por_noche, fin.total, fin.moneda,
           fin.disponible, fin.cancelacion, fin.habitaciones_libres,
           agg.minimo, agg.maximo, agg.muestras, agg.primera_vez, agg.ultima_vez
    FROM agg
    JOIN propiedades p ON p.property_id = agg.property_id
    JOIN obs ini ON ini.property_id = agg.property_id AND ini.rn_ini = 1
    JOIN obs fin ON fin.property_id = agg.property_id AND fin.rn_fin = 1
  `).all(busquedaId, corte, corte);
}

export function historial(db, busquedaId, propertyId) {
  return db.prepare(`
    SELECT s.tomado, pr.por_noche, pr.total, pr.moneda, pr.disponible, pr.habitaciones_libres
    FROM precios pr JOIN snapshots s ON s.id = pr.snapshot_id
    WHERE s.busqueda_id = ? AND pr.property_id = ?
    ORDER BY s.tomado ASC, s.id ASC
  `).all(busquedaId, propertyId);
}

/** Todas las observaciones de una busqueda, para cruzarlas entre dias. */
export function observaciones(db, busquedaId) {
  return db.prepare(`
    SELECT pr.property_id, pr.por_noche, pr.por_noche_sin_imp, pr.total, pr.disponible, s.tomado
    FROM precios pr JOIN snapshots s ON s.id = pr.snapshot_id
    WHERE s.busqueda_id = ? AND pr.por_noche IS NOT NULL
    ORDER BY s.tomado ASC, s.id ASC
  `).all(busquedaId);
}

/**
 * La misma busqueda pero para otra noche: mismo destino, misma gente, misma
 * moneda, distinto check_in. Es lo que permite comparar noche contra noche.
 */
export function busquedaHermana(db, busqueda, checkIn) {
  return db.prepare(`
    SELECT * FROM busquedas
    WHERE check_in = ? AND los = ? AND moneda = ?
      AND IFNULL(ciudad_id, '') = IFNULL(?, '')
      AND IFNULL(adultos, 0) = IFNULL(?, 0)
      AND IFNULL(ninos, 0) = IFNULL(?, 0)
      AND IFNULL(habitaciones, 0) = IFNULL(?, 0)
    LIMIT 1
  `).get(checkIn, busqueda.los, busqueda.moneda, busqueda.ciudad_id,
         busqueda.adultos, busqueda.ninos, busqueda.habitaciones);
}

export function buscarPropiedades(db, texto) {
  return db.prepare(`
    SELECT property_id, nombre, zona, ciudad, tipo, nota FROM propiedades
    WHERE nombre LIKE ? ORDER BY nombre LIMIT 25
  `).all(`%${texto}%`);
}

export function recordarDestino(db, texto, ciudadId, nombre) {
  db.prepare('INSERT OR REPLACE INTO destinos (texto, ciudad_id, nombre, guardado) VALUES (?,?,?,?)')
    .run(texto.toLowerCase(), ciudadId, nombre, ahoraISO());
}

export function destinoGuardado(db, texto) {
  return db.prepare('SELECT * FROM destinos WHERE texto = ?').get(texto.toLowerCase());
}
