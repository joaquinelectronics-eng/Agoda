import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsearRespuesta, parsearPropiedad, mapaTipos } from '../src/parse.mjs';

const crudo = JSON.parse(fs.readFileSync(new URL('./fixtures/busqueda.json', import.meta.url), 'utf8'));

test('lee la respuesta completa de Agoda', () => {
  const r = parsearRespuesta(crudo);
  assert.equal(r.ciudad, 'Buenos Aires');
  assert.equal(r.ciudadId, 9294);
  assert.equal(r.propiedades.length, 3);
  assert.ok(r.totalDisponibles > 0);
});

test('traduce los ids de tipo de alojamiento a nombres', () => {
  const tipos = mapaTipos(crudo.data.citySearch);
  assert.equal(tipos.get(29), 'Apartamento/Piso');
  assert.equal(tipos.get(34), 'Hotel');
});

test('cada propiedad trae identidad y ubicacion', () => {
  for (const p of parsearRespuesta(crudo).propiedades) {
    assert.ok(p.propertyId > 0, 'id');
    assert.ok(p.nombre.length > 0, 'nombre');
    assert.match(p.url, /^https:\/\/www\.agoda\.com\//);
    assert.equal(typeof p.lat, 'number');
    assert.equal(p.ciudad, 'Buenos Aires');
    assert.ok(p.tipo, 'tipo traducido');
  }
});

test('las disponibles traen precio coherente; las agotadas quedan marcadas', () => {
  const props = parsearRespuesta(crudo).propiedades;
  const libres = props.filter((p) => p.disponible);
  const agotadas = props.filter((p) => !p.disponible);
  assert.ok(libres.length >= 2, 'hay disponibles en el fixture');
  for (const p of libres) {
    assert.equal(typeof p.porNoche, 'number');
    assert.ok(p.porNoche > 0, 'precio positivo');
    assert.ok(p.porNoche >= p.porNocheSinImp, 'con impuestos >= sin impuestos');
    assert.ok(p.moneda, 'moneda');
  }
  assert.ok(agotadas.length >= 1, 'el fixture incluye una sin disponibilidad');
  for (const p of agotadas) assert.equal(p.porNoche, null);
});

test('elige la oferta mas barata entre varias', () => {
  const prop = {
    propertyId: 1,
    content: { informationSummary: { displayName: 'X', address: {} } },
    pricing: {
      isAvailable: true,
      offers: [
        { roomOffers: [{ room: { pricing: [{ currency: 'ARS', price: { perRoomPerNight: { inclusive: { display: 90 }, exclusive: { display: 80 } } } }] } }] },
        { roomOffers: [{ room: { availableRooms: 2, pricing: [{ currency: 'ARS', price: { perRoomPerNight: { inclusive: { display: 70 }, exclusive: { display: 60 } } } }] }, payment: { cancellation: { cancellationType: 'FreeCancellation' } } }] },
      ],
    },
  };
  const p = parsearPropiedad(prop);
  assert.equal(p.porNoche, 70);
  assert.equal(p.porNocheSinImp, 60);
  assert.equal(p.cancelacion, 'FreeCancellation');
  assert.equal(p.habitacionesLibres, 2);
});

test('sobrevive a una propiedad sin precio', () => {
  const p = parsearPropiedad({ propertyId: 9, content: { informationSummary: { displayName: 'Sin stock', address: {} } }, pricing: { isAvailable: false, offers: [] } });
  assert.equal(p.porNoche, null);
  assert.equal(p.disponible, false);
});
