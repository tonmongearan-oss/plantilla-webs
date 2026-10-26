/* Pruebas unitarias del motor de disponibilidad, zona horaria y validación. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.ENV_FILE = '/dev/null';
const { daySlots, checkFits, dayPlan, normalizeSchedule } = await import('../src/lib/availability.ts');
const { zonedToUtc, utcToZoned, longDateEs } = await import('../src/lib/time.ts');
const { phone } = await import('../src/lib/validate.ts');

const sp = {
  name: 'Laura', active: true, slotStep: 30, vacations: [{ from: '2030-01-08', to: '2030-01-09', label: 'Vacaciones' }],
  schedule: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(d => [String(d), { on: d <= 4, blocks: [{ s: '09:00', e: '13:00' }, { s: '16:00', e: '19:00' }], breaks: [{ s: '11:00', e: '11:30' }] }]))
};
const opts = { today: '2030-01-01', nowMin: 600, noticeMin: 60 };

test('divide la jornada en franjas y marca la pausa', () => {
  const { slots } = daySlots(sp, '2030-01-07', 30, [], opts); // lunes
  assert.equal(slots.length, 8 + 6);
  assert.equal(slots.find(s => s.start === '11:00')!.status, 'break');
  assert.equal(slots.find(s => s.start === '16:00')!.status, 'available');
});

test('una cita de 45 minutos bloquea todas las franjas que solapa', () => {
  const busy = [{ s: 9 * 60 + 30, e: 10 * 60 + 15, kind: 'booking' as const }];
  const { slots } = daySlots(sp, '2030-01-07', 45, busy, opts);
  const st = (t: string) => slots.find(s => s.start === t)!.status;
  assert.equal(st('09:30'), 'booked');
  assert.equal(st('10:00'), 'booked');
  assert.equal(st('09:00'), 'unavailable'); // 09:00-09:45 pisaría la cita
  assert.equal(st('10:30'), 'unavailable'); // 10:30-11:15 pisaría la pausa
  assert.equal(st('11:30'), 'available');
});

test('no ofrece horas que no caben antes del final de la jornada', () => {
  const { slots } = daySlots(sp, '2030-01-07', 60, [], opts);
  assert.equal(slots.find(s => s.start === '12:30')!.status, 'unavailable');
  assert.equal(slots.find(s => s.start === '18:00')!.status, 'available');
});

test('respeta días libres, vacaciones y agenda desactivada', () => {
  assert.equal(dayPlan(sp, '2030-01-11').working, false); // viernes libre
  assert.equal(dayPlan(sp, '2030-01-08').reason, 'vacation');
  assert.equal(dayPlan({ ...sp, active: false }, '2030-01-07').reason, 'inactive');
});

test('marca como pasadas las horas dentro de la antelación mínima', () => {
  const { slots } = daySlots(sp, '2030-01-07', 30, [], { today: '2030-01-07', nowMin: 600, noticeMin: 60 });
  assert.equal(slots.find(s => s.start === '10:30')!.status, 'past');
  assert.equal(slots.find(s => s.start === '11:30')!.status, 'available');
});

test('checkFits explica por qué no se puede reservar', () => {
  assert.match(checkFits(sp, '2030-01-07', '10:45', 30, [])!, /descanso/);
  assert.match(checkFits(sp, '2030-01-11', '10:00', 30, [])!, /no trabaja/);
  assert.match(checkFits(sp, '2030-01-07', '10:00', 30, [{ s: 600, e: 630, kind: 'external' }])!, /ocupado en la agenda/);
  assert.equal(checkFits(sp, '2030-01-07', '16:00', 60, []), null);
});

test('valida el horario semanal', () => {
  assert.match(normalizeSchedule({ 1: { on: true, blocks: [{ s: '13:00', e: '09:00' }] } }) as string, /posterior/);
  const ok = normalizeSchedule({ 1: { on: true, blocks: [{ s: '09:00', e: '13:00' }] } }) as any;
  assert.equal(ok['1'].on, true);
  assert.equal(ok['2'].on, false);
});

test('convierte la hora local de Madrid a UTC, también en los cambios de hora', () => {
  assert.equal(zonedToUtc('2026-07-01', '10:00', 'Europe/Madrid').toISOString(), '2026-07-01T08:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01', '10:00', 'Europe/Madrid').toISOString(), '2026-12-01T09:00:00.000Z');
  assert.equal(zonedToUtc('2026-03-29', '10:00', 'Europe/Madrid').toISOString(), '2026-03-29T08:00:00.000Z');
  assert.equal(zonedToUtc('2026-10-25', '10:00', 'Europe/Madrid').toISOString(), '2026-10-25T09:00:00.000Z');
  assert.deepEqual(utcToZoned(new Date('2026-10-25T09:00:00Z'), 'Europe/Madrid').time, '10:00');
  assert.equal(longDateEs('2026-10-22'), 'jueves 22 de octubre');
});

test('normaliza teléfonos a formato internacional', () => {
  assert.equal(phone('600 12 34 56'), '+34600123456');
  assert.equal(phone('0034 600-123-456'), '+34600123456');
  assert.equal(phone('+44 7700 900123'), '+447700900123');
  assert.throws(() => phone('1234'));
});
