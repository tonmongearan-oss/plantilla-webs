/* WhatsApp: confirmación, recordatorios programados, consentimiento, webhooks y bajas.
   Se usan servidores que imitan la API de WhatsApp Cloud (Meta) y la de Twilio. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { resetDb, startApi, stopAll, http, makeSpecialist, futureMonday, patient, stub, reply, runWorker, dueNow, pool, PORTS, base } from './helpers.ts';

const { config } = await import('../src/config.ts');
let meta: Awaited<ReturnType<typeof stub>>, twilio: Awaited<ReturnType<typeof stub>>, sp: any, day: string;
let n = 0;
before(async () => {
  await resetDb();
  await stub('google', (_r, res) => reply(res, 200, { items: [] }));
  meta = await stub('meta', (_r, res) => reply(res, 200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.${++n}` }] }));
  twilio = await stub('twilio', (_r, res) => reply(res, 201, { sid: `SM${++n}` }));
  await startApi();
  sp = await makeSpecialist('Laura Vidal');
  day = futureMonday();
});
after(stopAll);

const sent = () => meta.calls.filter(c => c.path.endsWith('/messages')).map(c => c.json);

let token = '';
test('envía la confirmación con la plantilla aprobada y el enlace para gestionar la cita', async () => {
  const r = await http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day, start: '10:00', ...patient(1) } });
  assert.equal(r.status, 200);
  token = new URL(r.json.manageUrl).searchParams.get('t')!;
  await runWorker();
  const m = sent();
  assert.equal(m.length, 1);
  assert.equal(m[0].to, '34600000101');
  assert.equal(m[0].type, 'template');
  assert.equal(m[0].template.name, 'postural_cita_confirmada');
  assert.equal(m[0].template.language.code, 'es');
  const body = m[0].template.components.find((c: any) => c.type === 'body').parameters.map((p: any) => p.text);
  assert.deepEqual(body.slice(0, 2), ['Paciente', 'Fisioterapia']);
  assert.match(body[2], /^lunes \d+ de /);
  assert.equal(body[3], '10:00');
  assert.equal(body[4], 'Laura Vidal');
  const btn = m[0].template.components.find((c: any) => c.type === 'button');
  assert.equal(btn.parameters[0].text, token, 'el botón lleva el token para gestionar la cita');
  assert.equal(meta.calls[0].headers.authorization, 'Bearer meta-test-token');
  const nrow = (await pool.query('SELECT * FROM notifications')).rows[0];
  assert.equal(nrow.status, 'sent');
});

test('programa los recordatorios 24 h y 2 h antes, y los envía a su hora', async () => {
  const { rows } = await pool.query(`SELECT run_at, payload FROM jobs WHERE type = 'wa.send' AND status = 'pending' ORDER BY run_at`);
  assert.equal(rows.length, 2);
  const { zonedToUtc } = await import('../src/lib/time.ts');
  const start = zonedToUtc(day, '10:00', 'Europe/Madrid').getTime();
  assert.equal(new Date(rows[0].run_at).getTime(), start - 24 * 3600e3);
  assert.equal(new Date(rows[1].run_at).getTime(), start - 2 * 3600e3);
  await dueNow();
  await runWorker();
  const rem = sent().filter(m => m.template.name === 'postural_recordatorio_cita');
  assert.equal(rem.length, 2);
  const params = rem[0].template.components[0].parameters.map((p: any) => p.text);
  assert.match(params[4], /cancela o cambia/);
});

test('si la cita cambia de hora, se anulan los recordatorios antiguos y se avisa del cambio', async () => {
  const before = sent().length;
  const r = await http(`/api/public/manage/${token}/reschedule`, { body: { date: day, start: '12:00' } });
  assert.equal(r.status, 200);
  const pend = (await pool.query(`SELECT payload FROM jobs WHERE type = 'wa.send' AND status = 'pending' AND payload->>'template' = 'reminder'`)).rows;
  assert.equal(pend.length, 2);
  assert.ok(pend.every(p => p.payload.startsAt.endsWith('Z')));
  await runWorker();
  const after = sent().slice(before);
  assert.equal(after.length, 1);
  assert.equal(after[0].template.name, 'postural_cita_modificada');
  assert.equal(after[0].template.components[0].parameters[3].text, '12:00');
});

test('al cancelar se avisa y no se envían más recordatorios', async () => {
  const before = sent().length;
  await http(`/api/public/manage/${token}/cancel`, { body: {} });
  await dueNow();
  await runWorker();
  const after = sent().slice(before);
  assert.deepEqual(after.map(m => m.template.name), ['postural_cita_cancelada']);
});

test('sin consentimiento de WhatsApp no se envía nada', async () => {
  const before = sent().length;
  const r = await http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day, start: '09:00', ...patient(5, { whatsappOptIn: false }) } });
  assert.equal(r.status, 200);
  await dueNow();
  await runWorker();
  assert.equal(sent().length, before);
});

test('webhook de Meta: verifica la suscripción y la firma, y guarda el estado de entrega', async () => {
  const v = await fetch(`${base}/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
  assert.equal(await v.text(), '12345');
  const bad = await fetch(`${base}/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1`);
  assert.equal(bad.status, 403);
  const msgId = (await pool.query('SELECT provider_message_id FROM notifications ORDER BY id LIMIT 1')).rows[0].provider_message_id;
  const payload = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: msgId, status: 'read' }] } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'meta-app-secret').update(payload).digest('hex');
  const forged = await fetch(`${base}/webhooks/whatsapp/meta`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' }, body: payload });
  assert.equal(forged.status, 403);
  const ok = await fetch(`${base}/webhooks/whatsapp/meta`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: payload });
  assert.equal(ok.status, 200);
  assert.equal((await pool.query('SELECT status FROM notifications WHERE provider_message_id = $1', [msgId])).rows[0].status, 'read');
});

test('si el paciente responde BAJA, deja de recibir mensajes', async () => {
  const payload = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '34600000101', type: 'text', text: { body: 'BAJA' } }] } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'meta-app-secret').update(payload).digest('hex');
  await fetch(`${base}/webhooks/whatsapp/meta`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: payload });
  const p = (await pool.query(`SELECT whatsapp_opt_in, whatsapp_opt_out_at FROM patients WHERE phone = '+34600000101'`)).rows[0];
  assert.equal(p.whatsapp_opt_in, false);
  assert.ok(p.whatsapp_opt_out_at);
  const before = sent().length;
  await http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day, start: '12:00', ...patient(1, { whatsappOptIn: false }) } });
  await runWorker();
  assert.equal(sent().length, before);
});

test('un error temporal del proveedor se reintenta más tarde', async () => {
  let fails = 1;
  meta.handlers.push((_r, res) => { if (fails-- > 0) { reply(res, 503, { error: { message: 'temporal' } }); return; } return false; });
  const r = await http('/api/public/appointments', { body: { serviceId: 'fisio', specialistId: sp.id, date: day, start: '12:00', ...patient(7), date: day.replace(/\d\d$/, x => String(Number(x) + 1).padStart(2, '0')) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await runWorker();
  const job = (await pool.query(`SELECT status, attempts, last_error FROM jobs WHERE type = 'wa.send' AND payload->>'template' = 'confirmation' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(job.status, 'pending');
  assert.match(job.last_error, /503/);
  await dueNow("AND type = 'wa.send' AND payload->>'template' = 'confirmation'");
  await runWorker();
  const job2 = (await pool.query(`SELECT status FROM jobs WHERE type = 'wa.send' AND payload->>'template' = 'confirmation' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(job2.status, 'done');
});

test('también funciona con Twilio (plantillas de contenido y firma del webhook)', async () => {
  config.whatsapp.provider = 'twilio';
  try {
    const { sendTemplate, verifyTwilioSignature } = await import('../src/modules/whatsapp.ts');
    const res = await sendTemplate({ template: 'reminder', to: '+34600000101', vars: { nombre: 'Ana', servicio: 'Fisioterapia', fecha: 'lunes 1', hora: '10:00', instrucciones: 'x' }, manageToken: 'tok' });
    assert.equal(res!.provider, 'twilio');
    const call = twilio.calls.at(-1)!;
    assert.equal(call.path, '/2010-04-01/Accounts/ACtest/Messages.json');
    const p = new URLSearchParams(call.body);
    assert.equal(p.get('ContentSid'), 'HXrem');
    assert.equal(p.get('To'), 'whatsapp:+34600000101');
    assert.deepEqual(JSON.parse(p.get('ContentVariables')!), { 1: 'Ana', 2: 'Fisioterapia', 3: 'lunes 1', 4: '10:00', 5: 'x', 6: 'tok' });
    const url = `http://127.0.0.1:${PORTS.api}/webhooks/whatsapp/twilio`;
    const params = { Body: 'hola', From: 'whatsapp:+34600000999' };
    const sig = createHmac('sha1', 'twilio-secret').update(url + 'Body' + 'hola' + 'From' + 'whatsapp:+34600000999').digest('base64');
    assert.equal(verifyTwilioSignature(url, params, sig), true);
    assert.equal(verifyTwilioSignature(url, params, 'falsa'), false);
  } finally {
    config.whatsapp.provider = 'meta';
  }
});
