/* Google Calendar: OAuth, creación/cambio/borrado de eventos y disponibilidad real.
   Se usa un servidor que imita la API de Google (mismas rutas y formatos). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, startApi, stopAll, http, makeSpecialist, futureMonday, patient, adminSession, stub, reply, runWorker, pool, type Recorded } from './helpers.ts';

const { zonedToUtc } = await import('../src/lib/time.ts');
const { clearBusyCache } = await import('../src/modules/google.ts');
let g: Awaited<ReturnType<typeof stub>>, jar: any, sp: any, day: string;
const events = new Map<string, any>();
let externalEvents: any[] = [];
let failList = false;
let tokenCalls = 0;
let rejectFirstToken = false;
const idToken = 'h.' + Buffer.from(JSON.stringify({ email: 'agenda.laura@gmail.com' })).toString('base64url') + '.s';

before(async () => {
  await resetDb();
  g = await stub('google', (r: Recorded, res) => {
    if (r.path === '/token') {
      tokenCalls++;
      const p = new URLSearchParams(r.body);
      if (p.get('grant_type') === 'authorization_code') return reply(res, 200, { access_token: 'at-1', refresh_token: 'rt-secreto', expires_in: 3600, scope: 'calendar', id_token: idToken });
      return reply(res, 200, { access_token: 'at-2', expires_in: 3600 });
    }
    if (rejectFirstToken && r.headers.authorization === 'Bearer at-1') return reply(res, 401, { error: { message: 'token caducado' } });
    if (r.headers.authorization !== 'Bearer at-1' && r.headers.authorization !== 'Bearer at-2') return reply(res, 401, { error: { message: 'unauthorized' } });
    if (r.path.startsWith('/calendar/v3/users/me/calendarList')) return reply(res, 200, { items: [{ id: 'laura-cal@group.calendar.google.com', summary: 'Agenda Laura', accessRole: 'owner' }] });
    const m = r.path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^?]+))?/);
    if (m) {
      if (r.method === 'GET') {
        if (failList) return reply(res, 503, { error: { message: 'backend error' } });
        return reply(res, 200, { items: [...externalEvents, ...[...events.values()]] });
      }
      if (r.method === 'POST') { const id = 'ev' + (events.size + 1); events.set(id, { ...r.json, id }); return reply(res, 200, { id }); }
      if (r.method === 'PATCH') { const ev = events.get(m[2]); if (!ev) return reply(res, 404, { error: { message: 'Not Found' } }); Object.assign(ev, r.json); return reply(res, 200, ev); }
      if (r.method === 'DELETE') { events.delete(m[2]); res.writeHead(204); res.end(); return; }
    }
    return reply(res, 404, { error: { message: 'no route' } });
  });
  await stub('meta', (_r, res) => reply(res, 200, { messages: [{ id: 'wamid.g' }] }));
  await startApi();
  jar = await adminSession();
  sp = await makeSpecialist('Laura Vidal');
  day = futureMonday();
});
after(stopAll);

test('conecta una cuenta de Google con OAuth 2.0 y elige el calendario del especialista', async () => {
  const c = await http(`/api/admin/google/connect?specialistId=${sp.id}`, { jar });
  assert.equal(c.status, 200);
  const url = new URL(c.json.url);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.match(url.searchParams.get('scope')!, /calendar\.events/);
  const state = url.searchParams.get('state')!;
  const cb = await http(`/api/admin/google/callback?code=abc&state=${state}`, { jar });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location')!, /google=ok/);
  const acc = (await pool.query('SELECT * FROM google_accounts')).rows[0];
  assert.equal(acc.email, 'agenda.laura@gmail.com');
  assert.ok(!acc.refresh_token_enc.includes('rt-secreto'), 'el refresh token se guarda cifrado');
  const cals = await http(`/api/admin/google/accounts/${acc.id}/calendars`, { jar });
  assert.equal(cals.json.calendars[0].id, 'laura-cal@group.calendar.google.com');
  const set = await http(`/api/admin/specialists/${sp.id}/calendar`, { method: 'PUT', body: { accountId: acc.id, calendarId: cals.json.calendars[0].id, calendarName: 'Agenda Laura' }, jar });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal(set.json.google.calendarId, 'laura-cal@group.calendar.google.com');
  const replay = await http(`/api/admin/google/callback?code=abc&state=${state}`, { jar });
  assert.match(replay.headers.get('location')!, /google=error/, 'un state solo sirve una vez');
});

let apptId = '', token = '';
test('una reserva crea el evento en el Google Calendar del especialista', async () => {
  const r = await http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day, start: '10:00', ...patient(1) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  apptId = r.json.appointment.id;
  token = new URL(r.json.manageUrl).searchParams.get('t')!;
  await runWorker();
  const ev = [...events.values()].find(e => e.extendedProperties?.private?.posturalId === apptId);
  assert.ok(ev, 'evento creado');
  assert.equal(ev.start.dateTime, zonedToUtc(day, '10:00', 'Europe/Madrid').toISOString());
  assert.equal(ev.end.dateTime, zonedToUtc(day, '10:45', 'Europe/Madrid').toISOString());
  assert.match(ev.summary, /Paciente Prueba1 Apellido · Fisioterapia \(Laura Vidal\)/);
  assert.match(ev.description, /\+34600000101/);
  const a = (await pool.query('SELECT google_event_id, google_sync FROM appointments WHERE id = $1', [apptId])).rows[0];
  assert.equal(a.google_sync, 'synced');
  assert.equal(a.google_event_id, ev.id);
});

test('cambiar la hora actualiza el mismo evento', async () => {
  const r = await http(`/api/public/manage/${token}/reschedule`, { body: { date: day, start: '12:00' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await runWorker();
  assert.equal(events.size, 1);
  const ev = [...events.values()][0];
  assert.equal(ev.start.dateTime, zonedToUtc(day, '12:00', 'Europe/Madrid').toISOString());
  assert.ok(g.calls.some(c => c.method === 'PATCH'));
});

test('los eventos propios del especialista en Google bloquean la disponibilidad', async () => {
  externalEvents = [{ id: 'personal', status: 'confirmed', start: { dateTime: zonedToUtc(day, '09:00', 'Europe/Madrid').toISOString() }, end: { dateTime: zonedToUtc(day, '10:00', 'Europe/Madrid').toISOString() } }];
  clearBusyCache();
  const d = await http(`/api/public/availability/day?specialistId=${sp.id}&serviceId=fisio&date=${day}`);
  assert.equal(d.json.slots.find((s: any) => s.start === '09:00').status, 'booked');
  assert.equal(d.json.slots.find((s: any) => s.start === '10:00').status, 'available', 'la cita movida ya no ocupa las 10:00');
  assert.equal(d.json.slots.find((s: any) => s.start === '12:00').status, 'booked', 'la cita de la web sigue contando una sola vez');
  const r = await http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day, start: '09:00', ...patient(2) } });
  assert.equal(r.status, 409);
  externalEvents = [{ id: 'dia', status: 'confirmed', start: { date: day }, end: { date: day.replace(/\d\d$/, x => String(Number(x) + 1).padStart(2, '0')) } }];
  clearBusyCache();
  const m = await http(`/api/public/availability/month?specialistId=${sp.id}&serviceId=fisio&month=${day.slice(0, 7)}`);
  assert.equal(m.json.days[day], 'full', 'un evento de día completo ocupa todo el día');
  externalEvents = [];
  clearBusyCache();
});

test('si Google no responde, no se arriesga a duplicar: pide reintentar', async () => {
  failList = true; clearBusyCache();
  const r = await http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day, start: '09:30', ...patient(3) } });
  assert.equal(r.status, 503);
  failList = false; clearBusyCache();
});

test('cancelar la cita borra el evento', async () => {
  const r = await http(`/api/public/manage/${token}/cancel`, { body: {} });
  assert.equal(r.status, 200);
  await runWorker();
  assert.equal(events.size, 0);
});

test('renueva el token de acceso caducado con el refresh token', async () => {
  rejectFirstToken = true;
  const before = tokenCalls;
  const { listCalendars } = await import('../src/modules/google.ts');
  const acc = (await pool.query('SELECT id FROM google_accounts')).rows[0];
  const cals = await listCalendars(acc.id);
  assert.equal(cals.length, 1);
  assert.equal(tokenCalls, before + 1);
  const last = g.calls.filter(c => c.path === '/token').at(-1)!;
  assert.equal(new URLSearchParams(last.body).get('grant_type'), 'refresh_token');
  assert.equal(new URLSearchParams(last.body).get('refresh_token'), 'rt-secreto');
});
