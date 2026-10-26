/* Reservas individuales de extremo a extremo contra PostgreSQL. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, startApi, stopAll, http, makeSpecialist, futureMonday, patient, adminSession, pool, stub, reply, WEEK } from './helpers.ts';

let A: any, B: any, day: string;
before(async () => {
  await resetDb();
  await stub('google', (_r, res) => reply(res, 200, { items: [] }));
  await stub('meta', (_r, res) => reply(res, 200, { messages: [{ id: 'wamid.x' }] }));
  await startApi();
  A = await makeSpecialist('Laura Vidal');
  B = await makeSpecialist('Marc Soler');
  day = futureMonday();
});
after(stopAll);

const book = (sp: any, start: string, n = 1, extra: Record<string, unknown> = {}) =>
  http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day, start, ...patient(n), ...extra } });
const { zonedToUtc, addDays } = await import('../src/lib/time.ts');

test('1. reserva con el especialista A', async () => {
  const r = await book(A, '09:00');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.appointment.start, '09:00');
  assert.equal(r.json.appointment.duration, 45);
  assert.match(r.json.manageUrl, /cita\.html\?t=/);
});

test('2. la cita aparece en el panel', async () => {
  const jar = await adminSession();
  const r = await http('/api/admin/bootstrap', { jar });
  assert.equal(r.status, 200);
  const b = r.json.bookings.find((x: any) => x.specialistId === A.id && x.date === day && x.start === '09:00');
  assert.ok(b, 'la cita debe estar en el panel');
  assert.ok(r.json.patients.find((p: any) => p.id === b.patientId));
});

test('3. el mismo horario con A queda bloqueado (y también las franjas que solapa)', async () => {
  assert.equal((await book(A, '09:00', 2)).status, 409);
  assert.equal((await book(A, '09:30', 3)).status, 409); // 09:00-09:45 ocupa la franja de 09:30
  const d = await http(`/api/public/availability/day?specialistId=${A.id}&serviceId=fisio&date=${day}`);
  assert.equal(d.json.slots.find((s: any) => s.start === '09:00').status, 'booked');
  assert.equal(d.json.slots.find((s: any) => s.start === '09:30').status, 'booked');
});

test('4. la misma hora con el especialista B sí está disponible', async () => {
  const r = await book(B, '09:00', 4);
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test('nunca hay dos reservas en la misma franja aunque lleguen a la vez', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => book(A, '12:00', 20 + i)));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.ok(results.filter(r => r.status === 409).length >= 6);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM appointments WHERE specialist_id = $1 AND status <> 'cancelada' AND starts_at = $2`, [A.id, zonedToUtc(day, '12:00', 'Europe/Madrid').toISOString()]);
  assert.equal(rows[0].n, 1);
});

test('rechaza horas fuera de horario, en la pausa o sin consentimiento de privacidad', async () => {
  assert.equal((await book(A, '14:00', 5)).status, 400);
  assert.equal((await book(A, '10:45', 5)).status, 400);
  const r = await book(A, '10:00', 5, { privacyAccepted: false });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /privacidad/);
  assert.equal((await book(A, '10:00', 5, { website: 'spam' })).status, 400);
});

test('5. cancelar desde el panel libera el horario', async () => {
  const jar = await adminSession();
  const boot = await http('/api/admin/bootstrap', { jar });
  const b = boot.json.bookings.find((x: any) => x.specialistId === A.id && x.date === day && x.start === '09:00');
  const noCsrf = await http(`/api/admin/appointments/${b.id}/status`, { body: { status: 'cancelada' }, jar: { cookie: jar.cookie } });
  assert.equal(noCsrf.status, 403, 'sin token CSRF no se permite');
  const r = await http(`/api/admin/appointments/${b.id}/status`, { body: { status: 'cancelada' }, jar });
  assert.equal(r.status, 200);
  const d = await http(`/api/public/availability/day?specialistId=${A.id}&serviceId=fisio&date=${day}`);
  assert.equal(d.json.slots.find((s: any) => s.start === '09:00').status, 'available');
  assert.equal((await book(A, '09:00', 6)).status, 200, 'el hueco liberado se puede volver a reservar');
  const re = await http(`/api/admin/appointments/${b.id}/status`, { body: { status: 'confirmada' }, jar });
  assert.equal(re.status, 409, 'no se puede reactivar sobre otra cita');
});

test('6. cambiar el horario del especialista actualiza el calendario público', async () => {
  const jar = await adminSession();
  const sched = JSON.parse(JSON.stringify(WEEK));
  sched['1'].on = false; // deja de trabajar los lunes
  const r = await http(`/api/admin/specialists/${B.id}`, { method: 'PUT', body: { ...B, schedule: sched }, jar });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const m = await http(`/api/public/availability/month?specialistId=${B.id}&serviceId=fisio&month=${day.slice(0, 7)}`);
  assert.equal(m.json.days[day], 'off');
  assert.equal((await book(B, '10:00', 7)).status, 400);
});

test('el paciente puede cambiar y cancelar su cita con el enlace', async () => {
  const tue = addDays(day, 1);
  const r = await book(A, '10:00', 8, { date: tue });
  const token = new URL(r.json.manageUrl).searchParams.get('t')!;
  const s = await http(`/api/public/manage/${token}`);
  assert.equal(s.json.canChange, true);
  assert.equal(s.json.patientFirstName, 'Paciente');
  const moved = await http(`/api/public/manage/${token}/reschedule`, { body: { date: tue, start: '11:30' } });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.equal(moved.json.start, '11:30');
  const d = await http(`/api/public/availability/day?specialistId=${A.id}&serviceId=fisio&date=${tue}`);
  assert.equal(d.json.slots.find((x: any) => x.start === '10:00').status, 'available');
  assert.equal(d.json.slots.find((x: any) => x.start === '11:30').status, 'booked');
  const c = await http(`/api/public/manage/${token}/cancel`, { body: {} });
  assert.equal(c.json.status, 'cancelada');
  assert.equal((await http('/api/public/manage/token-que-no-existe-xxxxxxxxxx')).status, 404);
});

test('no permite cancelar online dentro del plazo mínimo', async () => {
  const jar = await adminSession();
  const bad = await http('/api/admin/settings', { method: 'PUT', body: { settings: { cancelMinNoticeHours: 24 * 30 } }, jar });
  assert.equal(bad.status, 400, 'el panel valida los límites');
  await pool.query(`UPDATE settings SET value = jsonb_set(value, '{cancelMinNoticeHours}', '100000') WHERE key = 'booking'`);
  (await import('../src/modules/settings.ts')).clearSettingsCache();
  const r = await book(A, '09:00', 9, { date: addDays(day, 1) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const token = new URL(r.json.manageUrl).searchParams.get('t')!;
  const c = await http(`/api/public/manage/${token}/cancel`, { body: {} });
  assert.equal(c.status, 400);
  assert.match(c.json.message, /Llámanos/);
});
