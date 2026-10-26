/* Panel: acceso, permisos y configuración. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, startApi, stopAll, http, adminSession, stub, reply, type Jar } from './helpers.ts';

before(async () => {
  await resetDb();
  await stub('google', (_r, res) => reply(res, 200, { items: [] }));
  await startApi();
});
after(stopAll);

test('sin sesión no se accede a los datos del panel', async () => {
  assert.equal((await http('/api/admin/bootstrap')).status, 401);
});

test('contraseña incorrecta no inicia sesión; la correcta sí', async () => {
  await adminSession('jefa@postural.test');
  const bad = await http('/api/admin/login', { body: { email: 'jefa@postural.test', password: 'mala' } });
  assert.equal(bad.status, 401);
  const jar: Jar = {};
  const ok = await http('/api/admin/login', { body: { email: 'jefa@postural.test', password: 'contraseña-larga-de-prueba' }, jar });
  assert.equal(ok.status, 200);
  assert.match(String(ok.headers.get('set-cookie')), /HttpOnly/);
  const me = await http('/api/admin/me', { jar });
  assert.equal(me.json.user.email, 'jefa@postural.test');
  await http('/api/admin/logout', { body: {}, jar: { ...jar, csrf: me.json.csrf } });
  assert.equal((await http('/api/admin/bootstrap', { jar })).status, 401, 'tras cerrar sesión la cookie deja de valer');
});

test('el panel recibe servicios, especialistas, clases y ajustes reales', async () => {
  const jar = await adminSession();
  const r = await http('/api/admin/bootstrap', { jar });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.services.map((s: any) => s.id).sort(), ['bruxismo', 'dolor', 'entreno', 'fisio', 'rehab', 'valoracion']);
  assert.equal(r.json.classTemplates.length, 41);
  assert.equal(r.json.center.phone, '639 71 15 17');
  assert.ok(r.json.specialists.some((s: any) => s.name === 'Dra. Emilia Pérez' && !s.active));
});

test('un usuario «staff» no puede cambiar la configuración ni los especialistas', async () => {
  const jar = await adminSession('recepcion@postural.test', 'staff');
  assert.equal((await http('/api/admin/settings', { method: 'PUT', body: { settings: { minNoticeMinutes: 30 } }, jar })).status, 403);
  assert.equal((await http('/api/admin/specialists', { body: { name: 'X Y' }, jar })).status, 403);
  assert.equal((await http('/api/admin/bootstrap', { jar })).status, 200);
});

test('guarda la configuración de reservas y recordatorios', async () => {
  const jar = await adminSession();
  const r = await http('/api/admin/settings', { method: 'PUT', body: { center: { publicHours: 'Lunes a viernes, 9 a 21 h' }, settings: { minNoticeMinutes: 60, reminders: { offsetsMinutes: [1440], instructions: 'Trae ropa cómoda.' } } }, jar });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cfg = await http('/api/public/config');
  assert.equal(cfg.json.center.publicHours, 'Lunes a viernes, 9 a 21 h');
  assert.equal(cfg.json.booking.minNoticeMinutes, 60);
});

test('crea, edita y elimina un paciente', async () => {
  const jar = await adminSession();
  const c = await http('/api/admin/patients', { body: { name: 'Nuevo Paciente Demo', phone: '611222333', email: 'n@ejemplo.com' }, jar });
  assert.equal(c.status, 200);
  assert.equal(c.json.phone, '+34611222333');
  const e = await http(`/api/admin/patients/${c.json.id}`, { method: 'PUT', body: { name: 'Nuevo Paciente Editado', phone: '611222333', email: 'n@ejemplo.com' }, jar });
  assert.equal(e.json.name, 'Nuevo Paciente Editado');
  assert.equal((await http(`/api/admin/patients/${c.json.id}`, { method: 'DELETE', jar })).status, 200);
});
