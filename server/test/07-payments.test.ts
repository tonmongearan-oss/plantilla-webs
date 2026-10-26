/* Señal online con Stripe: reserva pendiente de pago, confirmación al pagar, caducidad y devoluciones.
   Se usa un servidor que imita la API de Stripe. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, startApi, stopAll, http, makeSpecialist, futureMonday, patient, stub, reply, runWorker, dueNow, pool, adminSession } from './helpers.ts';

type Session = { id: string; url: string; payment_status: 'unpaid' | 'paid'; status: 'open' | 'complete' | 'expired'; payment_intent: string | null; params: URLSearchParams };
const sessions = new Map<string, Session>();
let stripe: Awaited<ReturnType<typeof stub>>, meta: Awaited<ReturnType<typeof stub>>, google: Awaited<ReturnType<typeof stub>>;
let sp: any, day: string, n = 0, failCreate = false;
const events = new Map<string, any>();

before(async () => {
  await resetDb();
  google = await stub('google', (r, res) => {
    if (r.path === '/token') return reply(res, 200, { access_token: 'at-1', expires_in: 3600 });
    const m = r.path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^?]+))?/);
    if (!m) return reply(res, 404, { error: { message: 'no route' } });
    if (r.method === 'GET') return reply(res, 200, { items: [] });
    if (r.method === 'POST') { const id = `ev${++n}`; events.set(id, { ...r.json, id }); return reply(res, 200, { id }); }
    if (r.method === 'PATCH') { const ev = events.get(m[2]); if (!ev) return reply(res, 404, { error: { message: 'Not Found' } }); Object.assign(ev, r.json); return reply(res, 200, ev); }
    if (r.method === 'DELETE') { events.delete(m[2]); res.writeHead(204); res.end(); return; }
  });
  meta = await stub('meta', (_r, res) => reply(res, 200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.${++n}` }] }));
  stripe = await stub('stripe', (r, res) => {
    const auth = r.headers.authorization;
    if (auth !== 'Bearer sk_test_pruebas') return reply(res, 401, { error: { message: 'Invalid API Key' } });
    if (r.method === 'POST' && r.path === '/v1/checkout/sessions') {
      if (failCreate) return reply(res, 500, { error: { message: 'Stripe caído' } });
      const id = `cs_test_${++n}`;
      const s: Session = { id, url: `https://checkout.stripe.test/c/${id}`, payment_status: 'unpaid', status: 'open', payment_intent: null, params: new URLSearchParams(r.body) };
      sessions.set(id, s);
      return reply(res, 200, { id, url: s.url, payment_status: s.payment_status, status: s.status });
    }
    let m = r.path.match(/^\/v1\/checkout\/sessions\/([^/?]+)(\/expire)?$/);
    if (m) {
      const s = sessions.get(decodeURIComponent(m[1]));
      if (!s) return reply(res, 404, { error: { message: 'No such checkout.session' } });
      if (m[2]) {
        if (s.status !== 'open') return reply(res, 400, { error: { message: 'Only open sessions can be expired' } });
        s.status = 'expired';
      }
      return reply(res, 200, { id: s.id, url: s.url, payment_status: s.payment_status, status: s.status, payment_intent: s.payment_intent });
    }
    if (r.method === 'POST' && r.path === '/v1/refunds') return reply(res, 200, { id: `re_${++n}`, status: 'succeeded', payment_intent: new URLSearchParams(r.body).get('payment_intent') });
    return reply(res, 404, { error: { message: 'not found' } });
  });
  await startApi();
  sp = await makeSpecialist('Laura Vidal');
  const { encrypt } = await import('../src/lib/crypto.ts');
  const acc = (await pool.query(`INSERT INTO google_accounts (email, refresh_token_enc) VALUES ('laura@ejemplo.com', $1) RETURNING id`, [encrypt('rt-secreto')])).rows[0];
  await pool.query('UPDATE specialists SET google_account_id = $2, google_calendar_id = $3 WHERE id = $1', [sp.id, acc.id, 'laura-cal']);
  await pool.query(`UPDATE services SET price_eur = 45 WHERE id = 'fisio'`);   // valoracion queda sin precio
  day = futureMonday();
});
after(stopAll);

const pay = (sessionId: string) => { const s = sessions.get(sessionId)!; s.payment_status = 'paid'; s.status = 'complete'; s.payment_intent = `pi_${sessionId}`; };
const waSent = () => meta.calls.filter(c => c.path.endsWith('/messages')).map(c => c.json);
const row = async (id: string) => (await pool.query('SELECT * FROM appointments WHERE id = $1', [id])).rows[0];
const tokenOf = (r: any) => new URL(r.json.manageUrl).searchParams.get('t')!;
const book = (start: string, n = 1, svc = 'fisio', date = day) => http('/api/public/appointments', { body: { serviceId: svc, specialistId: sp.id, date, start, ...patient(n) } });

test('la configuración pública anuncia la señal del 40 %', async () => {
  const r = await http('/api/public/config');
  assert.equal(r.json.payments.enabled, true);
  assert.equal(r.json.payments.depositPercent, 40);
});

let apptId = '', token = '', sessionId = '';
test('reservar un servicio con precio deja la cita pendiente de pago y abre Stripe con la señal', async () => {
  const r = await book('10:00');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.checkoutUrl, /^https:\/\/checkout\.stripe\.test\//);
  apptId = r.json.appointment.id; token = tokenOf(r);
  const a = await row(apptId);
  assert.equal(a.status, 'pendiente');
  assert.equal(a.payment_status, 'pending');
  assert.equal(a.payment_amount_cents, 1800);           // 40 % de 45 €
  sessionId = a.payment_session_id;
  const p = sessions.get(sessionId)!.params;
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '1800');
  assert.equal(p.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(p.get('mode'), 'payment');
  assert.equal(p.get('metadata[appointment_id]'), apptId);
  assert.match(p.get('success_url')!, /cita\.html\?t=.+&pago=ok$/);
  const exp = Number(p.get('expires_at')) * 1000 - Date.now();
  assert.ok(exp > 30 * 60e3 && exp < 33 * 60e3, 'la sesión caduca a los ~31 minutos');
});

test('mientras no paga: sin WhatsApp de confirmación, evento marcado como pendiente de pago y hueco bloqueado', async () => {
  await runWorker();
  assert.equal(waSent().length, 0);
  const ev = [...events.values()].find(e => e.extendedProperties?.private?.posturalId === apptId);
  assert.ok(ev);
  assert.match(ev.summary, /PENDIENTE DE PAGO/);
  const other = await book('10:00', 2);
  assert.equal(other.status, 409);
});

test('si vuelve de Stripe sin pagar, puede reintentar el pago', async () => {
  const r = await http(`/api/public/manage/${token}/payment`, { body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.payment.status, 'pending');
  assert.equal(r.json.payment.url, sessions.get(sessionId)!.url);
  assert.equal(r.json.canChange, false, 'no se puede cambiar de hora sin pagar');
  assert.equal(r.json.canCancel, true);
});

test('al pagar y volver, la cita se confirma, se envía el WhatsApp y el evento deja de estar pendiente', async () => {
  pay(sessionId);
  const r = await http(`/api/public/manage/${token}/payment`, { body: {} });
  assert.equal(r.json.status, 'confirmada');
  assert.equal(r.json.payment.status, 'paid');
  assert.equal(r.json.payment.amount, '18,00 €');
  const a = await row(apptId);
  assert.equal(a.payment_intent_id, `pi_${sessionId}`);
  await runWorker();
  const m = waSent();
  assert.equal(m.length, 1);
  assert.equal(m[0].template.name, 'postural_cita_confirmada');
  const rem = await pool.query(`SELECT count(*)::int AS n FROM jobs WHERE appointment_id = $1 AND status = 'pending' AND payload->>'template' = 'reminder'`, [apptId]);
  assert.equal(rem.rows[0].n, 2, 'recordatorios programados');
  const ev = [...events.values()].find(e => e.extendedProperties?.private?.posturalId === apptId);
  assert.doesNotMatch(ev.summary, /PENDIENTE/);
  assert.match(ev.description, /Señal online: 18,00 € · pagada/);
  // volver otra vez no duplica nada
  await http(`/api/public/manage/${token}/payment`, { body: {} });
  await runWorker();
  assert.equal(waSent().length, 1);
});

test('si el paciente cancela con antelación desde su enlace, se le devuelve la señal', async () => {
  const r = await http(`/api/public/manage/${token}/cancel`, { body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'cancelada');
  await runWorker();
  const refunds = stripe.calls.filter(c => c.path === '/v1/refunds');
  assert.equal(refunds.length, 1);
  assert.equal(new URLSearchParams(refunds[0].body).get('payment_intent'), `pi_${sessionId}`);
  assert.equal(refunds[0].headers['idempotency-key'], `refund-${apptId}`);
  const a = await row(apptId);
  assert.equal(a.payment_status, 'refunded');
  assert.ok(a.refund_id);
});

test('si no paga a tiempo, la reserva se cancela, la sesión de Stripe se cierra y el hueco queda libre', async () => {
  const r = await book('11:30', 3);
  const id = r.json.appointment.id;
  const sid = (await row(id)).payment_session_id;
  await runWorker();
  await dueNow(`AND type = 'pay.expire'`);
  await runWorker();
  const a = await row(id);
  assert.equal(a.status, 'cancelada');
  assert.equal(a.payment_status, 'expired');
  assert.equal(sessions.get(sid)!.status, 'expired');
  assert.ok(![...events.values()].some(e => e.extendedProperties?.private?.posturalId === id), 'evento borrado del calendario');
  const again = await book('11:30', 4);
  assert.equal(again.status, 200, 'el hueco se puede volver a reservar');
});

test('si paga en el último momento aunque no vuelva a la web, la tarea de caducidad confirma la cita', async () => {
  const { addDays } = await import('../src/lib/time.ts');
  const r = await book('12:00', 5, 'fisio', addDays(day, 1));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.appointment.id;
  pay((await row(id)).payment_session_id);
  await dueNow(`AND type = 'pay.expire'`);
  await runWorker();
  const a = await row(id);
  assert.equal(a.status, 'confirmada');
  assert.equal(a.payment_status, 'paid');
});

test('un servicio sin precio se reserva como siempre, sin pago', async () => {
  const r = await book('09:00', 6, 'valoracion');
  assert.equal(r.status, 200);
  assert.equal(r.json.checkoutUrl, null);
  const a = await row(r.json.appointment.id);
  assert.equal(a.status, 'confirmada');
  assert.equal(a.payment_status, 'none');
});

test('si Stripe no responde, la reserva no se guarda y el hueco no queda bloqueado', async () => {
  failCreate = true;
  const day2 = futureMonday(3);
  const r = await http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day2, start: '10:00', ...patient(7) } });
  failCreate = false;
  assert.equal(r.status, 502);
  const ok = await http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day2, start: '10:00', ...patient(8) } });
  assert.equal(ok.status, 200);
});

test('las reservas desde el panel no piden pago, y el administrador puede devolver una señal', async () => {
  const jar = await adminSession();
  const p = await http('/api/admin/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: futureMonday(4), start: '10:00', ...patient(9) }, jar });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const pid = p.json.appointment?.id || p.json.id;
  assert.equal((await row(pid)).payment_status, 'none');
  // cita pagada de la prueba anterior (12:00)
  const paid = (await pool.query(`SELECT id FROM appointments WHERE payment_status = 'paid' LIMIT 1`)).rows[0];
  const staff = await adminSession('staff@postural.test', 'staff');
  assert.equal((await http(`/api/admin/appointments/${paid.id}/refund`, { body: {}, jar: staff })).status, 403);
  const r = await http(`/api/admin/appointments/${paid.id}/refund`, { body: {}, jar });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.payment.status, 'refunded');
  assert.equal((await http(`/api/admin/appointments/${paid.id}/refund`, { body: {}, jar })).status, 400, 'no se devuelve dos veces');
  const boot = await http('/api/admin/bootstrap', { jar });
  assert.equal(boot.json.integrations.stripe.configured, true);
  assert.ok(boot.json.bookings.some((b: any) => b.payment?.status === 'refunded'));
});
