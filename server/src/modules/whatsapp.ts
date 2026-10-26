/* WhatsApp: envío de plantillas aprobadas (WhatsApp Business Platform de Meta o Twilio)
   y recepción de webhooks (estado de entrega y bajas). */
import { createHmac } from 'node:crypto';
import { config } from '../config.ts';
import { pool, one } from '../db.ts';
import { RetryableError } from '../lib/errors.ts';
import { safeEqual } from '../lib/crypto.ts';
import { log } from '../lib/log.ts';
import { optOutByPhone } from './patients.ts';

export type TemplateKey = 'confirmation' | 'reminder' | 'cancelled' | 'rescheduled';

/** Variables de cada plantilla, en el orden {{1}}, {{2}}… (ver docs/WHATSAPP.md). */
export const TEMPLATE_VARS: Record<TemplateKey, string[]> = {
  confirmation: ['nombre', 'servicio', 'fecha', 'hora', 'profesional'],
  reminder: ['nombre', 'servicio', 'fecha', 'hora', 'instrucciones'],
  cancelled: ['nombre', 'servicio', 'fecha', 'hora'],
  rescheduled: ['nombre', 'servicio', 'fecha', 'hora', 'profesional']
};
/** Plantillas con botón «Gestionar mi cita» (URL dinámica con el token de la cita). */
export const TEMPLATE_HAS_BUTTON: Record<TemplateKey, boolean> = { confirmation: true, reminder: true, cancelled: false, rescheduled: true };

export type SendInput = { template: TemplateKey; to: string; vars: Record<string, string>; manageToken?: string };
export type SendResult = { provider: string; messageId: string; templateName: string };

const clean = (s: string) => String(s ?? '').replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 900) || '-';

export async function sendTemplate(m: SendInput): Promise<SendResult | null> {
  const provider = config.whatsapp.provider;
  const templateName = config.whatsapp.templates[m.template];
  const values = TEMPLATE_VARS[m.template].map(k => clean(m.vars[k]));
  if (provider === 'disabled') return null;
  if (provider === 'log') {
    log.info('whatsapp (modo log, no se envía)', { to: m.to, template: templateName, values, token: m.manageToken ? 'sí' : 'no' });
    return { provider, messageId: `log-${Date.now()}`, templateName };
  }
  if (provider === 'meta') return sendMeta(m, templateName, values);
  return sendTwilio(m, templateName, values);
}

async function sendMeta(m: SendInput, templateName: string, values: string[]): Promise<SendResult> {
  const c = config.whatsapp.meta;
  const components: any[] = [{ type: 'body', parameters: values.map(text => ({ type: 'text', text })) }];
  if (TEMPLATE_HAS_BUTTON[m.template] && m.manageToken) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.manageToken }] });
  const res = await fetch(`${c.graphBase}/${c.apiVersion}/${c.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${c.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: m.to.replace(/^\+/, ''), type: 'template',
      template: { name: templateName, language: { code: config.whatsapp.templateLang }, components }
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `WhatsApp (Meta) ${res.status}: ${data?.error?.message || res.statusText} [${data?.error?.code ?? ''}]`;
    if (res.status === 429 || res.status >= 500 || data?.error?.code === 131056 /* demasiados mensajes */) throw new RetryableError(msg);
    throw Object.assign(new Error(msg), { retryable: false });
  }
  return { provider: 'meta', messageId: data?.messages?.[0]?.id || '', templateName };
}

async function sendTwilio(m: SendInput, templateName: string, values: string[]): Promise<SendResult> {
  const c = config.whatsapp.twilio;
  const contentSid = c.contentSids[m.template];
  if (!contentSid) throw Object.assign(new Error(`Falta TWILIO_CONTENT_SID para la plantilla «${m.template}»`), { retryable: false });
  const vars: Record<string, string> = {};
  values.forEach((v, i) => { vars[String(i + 1)] = v; });
  if (TEMPLATE_HAS_BUTTON[m.template] && m.manageToken) vars[String(values.length + 1)] = m.manageToken;
  const body = new URLSearchParams({ From: c.from.startsWith('whatsapp:') ? c.from : `whatsapp:${c.from}`, To: `whatsapp:${m.to}`, ContentSid: contentSid, ContentVariables: JSON.stringify(vars) });
  if (process.env.TWILIO_STATUS_CALLBACK !== 'off') body.set('StatusCallback', `${config.publicBaseUrl}/webhooks/whatsapp/twilio`);
  const res = await fetch(`${c.apiBase}/2010-04-01/Accounts/${c.accountSid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    body, signal: AbortSignal.timeout(15_000)
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `WhatsApp (Twilio) ${res.status}: ${data?.message || res.statusText} [${data?.code ?? ''}]`;
    if (res.status === 429 || res.status >= 500) throw new RetryableError(msg);
    throw Object.assign(new Error(msg), { retryable: false });
  }
  return { provider: 'twilio', messageId: data?.sid || '', templateName };
}

/* ---------- Webhooks ---------- */
const OPT_OUT = /^\s*(baja|stop|parar|cancelar suscripci[oó]n|no quiero (mas|más) mensajes)\s*[.!]*\s*$/i;

export function verifyMetaSignature(raw: Buffer, header: string | undefined): boolean {
  if (!header || !config.whatsapp.meta.appSecret) return false;
  const expected = 'sha256=' + createHmac('sha256', config.whatsapp.meta.appSecret).update(raw).digest('hex');
  return safeEqual(expected, header);
}

export async function handleMetaWebhook(body: any) {
  for (const entry of body?.entry || []) for (const change of entry.changes || []) {
    const val = change.value || {};
    for (const st of val.statuses || []) {
      await pool.query(`UPDATE notifications SET status = $2, error = $3, updated_at = now() WHERE provider_message_id = $1`,
        [st.id, st.status, st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title}` : null]);
    }
    for (const msg of val.messages || []) {
      const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '';
      if (OPT_OUT.test(text)) {
        const n = await optOutByPhone('+' + String(msg.from).replace(/^\+/, ''));
        log.info('baja de WhatsApp recibida', { pacientes: n });
      }
    }
  }
}

/** Firma de Twilio: HMAC-SHA1 de la URL completa + parámetros ordenados. */
export function verifyTwilioSignature(url: string, params: Record<string, string>, header: string | undefined): boolean {
  if (!header || !config.whatsapp.twilio.authToken) return false;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expected = createHmac('sha1', config.whatsapp.twilio.authToken).update(Buffer.from(data, 'utf8')).digest('base64');
  return safeEqual(expected, header);
}

export async function handleTwilioWebhook(p: Record<string, string>) {
  if (p.MessageSid && p.MessageStatus) {
    await pool.query(`UPDATE notifications SET status = $2, error = $3, updated_at = now() WHERE provider_message_id = $1`, [p.MessageSid, p.MessageStatus, p.ErrorCode || null]);
  }
  if (p.Body && OPT_OUT.test(p.Body) && p.From) {
    const n = await optOutByPhone(p.From.replace(/^whatsapp:/, ''));
    log.info('baja de WhatsApp recibida', { pacientes: n });
  }
}

export async function lastNotifications(limit = 50) {
  const { rows } = await pool.query(
    `SELECT n.id, n.kind, n.template, n.to_phone, n.status, n.error, n.provider, n.created_at, p.name AS patient_name
     FROM notifications n LEFT JOIN patients p ON p.id = n.patient_id ORDER BY n.created_at DESC LIMIT $1`, [limit]);
  return rows;
}

export async function isPatientOptedIn(patientId: string) {
  const p = await one('SELECT whatsapp_opt_in FROM patients WHERE id = $1', [patientId]);
  return !!p?.whatsapp_opt_in;
}
