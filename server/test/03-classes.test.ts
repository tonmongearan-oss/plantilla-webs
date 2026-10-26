/* Clases grupales: plazas y aforo. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, startApi, stopAll, http, futureMonday, patient, adminSession, stub, reply } from './helpers.ts';

let slot: any, day: string, jar: any;
before(async () => {
  await resetDb();
  await stub('meta', (_r, res) => reply(res, 200, { messages: [{ id: 'wamid.c' }] }));
  await startApi();
  jar = await adminSession();
  day = futureMonday();
  const r = await http('/api/admin/class-slots', { body: { typeId: 'especial', weekday: 1, start: '12:00', end: '13:00', capacity: 3 }, jar });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  slot = r.json;
});
after(stopAll);

const seats = async () => (await http(`/api/public/classes?from=${day}&days=1`)).json.sessions.find((s: any) => s.slotId === slot.id);

test('el horario publicado se ha cargado', async () => {
  const s = (await http(`/api/public/classes?from=${day}&days=5`)).json.sessions;
  assert.ok(s.some((x: any) => x.typeName === 'Postural Especial' && x.start === '10:30'));
});

test('7. reservar una plaza reduce las plazas libres', async () => {
  const before = await seats();
  assert.equal(before.free, 3);
  const r = await http('/api/public/class-bookings', { body: { slotId: slot.id, date: day, ...patient(1) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await seats()).free, 2);
  const dup = await http('/api/public/class-bookings', { body: { slotId: slot.id, date: day, ...patient(1) } });
  assert.equal(dup.status, 409, 'la misma persona no reserva dos veces');
});

test('8. al llegar al aforo no se admiten más reservas, aunque lleguen a la vez', async () => {
  const rs = await Promise.all([2, 3, 4, 5, 6].map(n => http('/api/public/class-bookings', { body: { slotId: slot.id, date: day, ...patient(n) } })));
  assert.equal(rs.filter(r => r.status === 200).length, 2);
  assert.ok(rs.filter(r => r.status === 409).every(r => /aforo/.test(r.json.message)));
  const s = await seats();
  assert.equal(s.full, true);
  assert.equal(s.taken, 3);
});

test('liberar una plaza desde el panel la vuelve a abrir', async () => {
  const boot = await http('/api/admin/bootstrap', { jar });
  const b = boot.json.classBookings.find((x: any) => x.templateId === slot.id && x.status !== 'cancelada');
  assert.equal((await http(`/api/admin/class-bookings/${b.id}/cancel`, { body: {}, jar })).status, 200);
  assert.equal((await seats()).free, 1);
});

test('rechaza un día en que no hay esa clase', async () => {
  const r = await http('/api/public/class-bookings', { body: { slotId: slot.id, date: day.replace(/\d\d$/, d => String(Number(d) + 1).padStart(2, '0')), ...patient(9) } });
  assert.equal(r.status, 400);
});
