import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuando } from '../src/salida.mjs';
import { parseFecha, addDays, distanciaKm, normalizar, sparkline, fmtPrecio } from '../src/util.mjs';
import { leerUrl, ajustarUrl, construirUrl } from '../src/agoda.mjs';

const HOY = '2026-08-31'; // lunes

test('parseFecha entiende las formas que uno escribe apurado', () => {
  assert.equal(parseFecha(undefined, HOY), HOY);
  assert.equal(parseFecha('hoy', HOY), HOY);
  assert.equal(parseFecha('manana', HOY), '2026-09-01');
  assert.equal(parseFecha('mañana', HOY), '2026-09-01');
  assert.equal(parseFecha('+3', HOY), '2026-09-03');
  assert.equal(parseFecha('viernes', HOY), '2026-09-04');
  assert.equal(parseFecha('lunes', HOY), '2026-09-07', 'el lunes que viene, no hoy');
  assert.equal(parseFecha('05/09', HOY), '2026-09-05');
  assert.equal(parseFecha('2026-12-24', HOY), '2026-12-24');
  assert.throws(() => parseFecha('cuando sea', HOY), /No entiendo la fecha/);
});

test('una fecha dia/mes ya pasada se entiende como del ano que viene', () => {
  assert.equal(parseFecha('02/01', HOY), '2027-01-02');
});

test('addDays cruza fin de mes', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('distanciaKm da valores creibles', () => {
  const obelisco = [-34.6037, -58.3816];
  const palermo = [-34.5780, -58.4250];
  const d = distanciaKm(...obelisco, ...palermo);
  assert.ok(d > 4 && d < 6, `esperaba ~5 km, dio ${d}`);
  assert.equal(distanciaKm(1, 2, null, 4), null);
});

test('normalizar saca acentos y mayusculas', () => {
  assert.equal(normalizar('San Nicolás'), 'san nicolas');
  assert.equal(normalizar(null), '');
});

test('sparkline necesita al menos dos puntos', () => {
  assert.equal(sparkline([5]), '');
  assert.equal(sparkline([1, 2, 3]).length, 3);
});

test('fmtPrecio usa formato local', () => {
  assert.equal(fmtPrecio(null), '-');
  assert.equal(fmtPrecio(45231.5), '45.232');
});

test('las URLs de busqueda se arman y se leen igual', () => {
  const url = construirUrl({ cityId: 9294, checkIn: '2026-09-01', los: 2, adultos: 3, ninos: 1, habitaciones: 2, moneda: 'USD' });
  const leido = leerUrl(url);
  assert.deepEqual(leido, { cityId: 9294, checkIn: '2026-09-01', los: 2, adultos: 3, ninos: 1, habitaciones: 2, moneda: 'USD' });
});

test('ajustarUrl respeta los filtros que ya trae la URL del usuario', () => {
  const suya = 'https://www.agoda.com/es-ar/search?city=9294&checkIn=2026-09-10&los=3&rooms=1&adults=2&children=0&currency=ARS&hotelStarRating=4&ds=viejo';
  const nueva = new URL(ajustarUrl(suya, { checkIn: '2026-08-31', los: 1 }));
  assert.equal(nueva.searchParams.get('checkIn'), '2026-08-31');
  assert.equal(nueva.searchParams.get('los'), '1');
  assert.equal(nueva.searchParams.get('hotelStarRating'), '4', 'no perdimos su filtro');
  assert.equal(nueva.searchParams.get('ds'), null, 'el token viejo se descarta');
});

// --- miniaturas -------------------------------------------------------------

const { miniatura } = await import('../src/imagenes.mjs');

test('las fotos de Agoda se piden en miniatura, no a tamano completo', () => {
  const u = miniatura('https://pix8.agoda.net/hotelImages/1311/0/abc.jpeg');
  assert.equal(new URL(u).searchParams.get('s'), '120x90');
});

test('la miniatura no pisa los parametros que ya traia la URL', () => {
  const u = new URL(miniatura('https://pix8.agoda.net/hotelImages/2205/0/abc.jpg?ca=7&ce=1'));
  assert.equal(u.searchParams.get('ca'), '7');
  assert.equal(u.searchParams.get('ce'), '1');
  assert.equal(u.searchParams.get('s'), '120x90');
});

test('bstatic codifica el tamano en la ruta', () => {
  assert.match(miniatura('https://q-xx.bstatic.com/xdata/images/hotel/max500/1.jpg?k=a&o='), /\/max150\/1\.jpg\?k=a&o=$/);
  assert.match(miniatura('https://q-xx.bstatic.com/xdata/images/hotel/square200/1.jpg'), /\/max150\//);
  assert.match(miniatura('https://q-xx.bstatic.com/xdata/images/hotel/max500/1.jpg', 100), /\/max100\//);
});

test('un host desconocido o una URL rota se devuelven tal cual', () => {
  assert.equal(miniatura('https://otro.cdn.com/foto.jpg'), 'https://otro.cdn.com/foto.jpg');
  assert.equal(miniatura('no-es-una-url'), 'no-es-una-url');
  assert.equal(miniatura(null), null);
  assert.equal(miniatura(''), null);
});

// --- links a la ficha de Agoda ----------------------------------------------

const { urlConFechas } = await import('../src/salida.mjs');

test('el link a la propiedad lleva las fechas y la ocupacion de la busqueda', () => {
  const u = new URL(urlConFechas('https://www.agoda.com/hotel-x/hotel/all/buenos-aires-ar.html', {
    check_in: '2026-09-01', los: 2, adultos: 3, ninos: 1, habitaciones: 2, moneda: 'ARS',
  }));
  assert.equal(u.searchParams.get('checkIn'), '2026-09-01');
  assert.equal(u.searchParams.get('los'), '2');
  assert.equal(u.searchParams.get('adults'), '3');
  assert.equal(u.searchParams.get('children'), '1');
  assert.equal(u.searchParams.get('rooms'), '2');
  assert.equal(u.searchParams.get('currency'), 'ARS');
});

test('urlConFechas no rompe con datos faltantes', () => {
  assert.equal(urlConFechas(null, { check_in: '2026-09-01' }), null);
  assert.equal(urlConFechas('https://www.agoda.com/x.html', null), 'https://www.agoda.com/x.html');
  assert.equal(urlConFechas('no-es-url', { los: 1 }), 'no-es-url');
  const u = new URL(urlConFechas('https://www.agoda.com/x.html', { check_in: '2026-09-01', los: 1 }));
  assert.equal(u.searchParams.get('checkIn'), '2026-09-01');
  assert.equal(u.searchParams.get('adults'), null, 'lo que no hay no se inventa');
});

test('la hora de la pagina va en 24 horas y con la zona', () => {
  const tarde = new Date('2026-09-02T18:58:18Z');   // 15:58 en Buenos Aires
  const previa = process.env.TZ;
  process.env.TZ = 'America/Argentina/Buenos_Aires';
  try {
    const texto = cuando(tarde);
    // El formato por defecto de es-AR sale en 12 horas y sin am/pm: "03:58" no
    // deja saber si la muestra es de la tarde o de la madrugada.
    assert.match(texto, /15:58/, `salio "${texto}"`);
    assert.doesNotMatch(texto, /03:58/);
    assert.match(texto, /ART|GMT-3/, 'la zona tiene que estar a la vista');
  } finally {
    if (previa === undefined) delete process.env.TZ; else process.env.TZ = previa;
  }
});
