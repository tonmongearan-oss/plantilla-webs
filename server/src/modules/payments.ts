/* Señal online con Stripe Checkout.
   - Al reservar desde la web un servicio con precio, la cita queda «pendiente de pago» y el hueco
     reservado durante unos minutos. El paciente paga en la página segura de Stripe.
   - Al volver (o, si cierra el navegador, al caducar el plazo) el servidor consulta a Stripe:
     si está pagado, confirma la cita; si no, la cancela y libera el hueco.
   - Si el paciente cancela desde su enlace (solo se permite con antelación), se le devuelve la señal.
   No hace falta webhook: el servidor pregunta a Stripe por el estado del pago. */
import { config } from '../config.ts';
import { one, tx, audit, pool, type Db } from '../db.ts';
import { AppError, badRequest, notFound, RetryableError } from '../lib/errors.ts';
import { utcToZoned, longDateEs } from '../lib/time.ts';
import { log } from '../lib/log.ts';
import { getSettings } from './settings.ts';
import { enqueue } from './jobs.ts';

export type PaymentStatus = 'none' | 'pending' | 'paid' | 'refunded' | 'expired';

/** ¿Se cobra señal para este servicio en una reserva web? */
export async function depositFor(price: number | null | undefined): Promise<number | null> {
  if (!config.stripe.enabled) return null;
  const s = await getSettings();
  if (!s.payments.enabled || price == null || !(Number(price) > 0)) return null;
  const cents = Math.round(Number(price) * s.payments.depositPercent);   // precio € × % = céntimos
  return cents >= 50 ? cents : null;  // Stripe no admite cobros de menos de 0,50 €
}

export const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',') + ' €';

/* ---------- API de Stripe (sin SDK) ---------- */
function formEncode(obj: Record<string, unknown>, prefix = '', out: string[] = []): string[] {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => typeof item === 'object' ? formEncode(item as any, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`));
    else if (typeof v === 'object') formEncode(v as any, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

async function stripe(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<any> {
  if (!config.stripe.enabled) throw new AppError(503, 'payments_off', 'Los pagos online no están configurados.');
  const body = params && method === 'POST' ? formEncode(params).join('&') : undefined;
  const qs = params && method === 'GET' ? '?' + formEncode(params).join('&') : '';
  let res: Response;
  try {
    res = await fetch(`${config.stripe.apiBase}${path}${qs}`, {
      method,
      headers: {
        authorization: `Bearer ${config.stripe.secretKey}`,
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
      },
      body,
      signal: AbortSignal.timeout(15_000)
    });
  } catch (e) {
    throw new RetryableError(`Stripe no responde: ${(e as Error).message}`);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `Stripe ${res.status}: ${data?.error?.message || res.statusText}`;
    if (res.status === 429 || res.status >= 500) throw new RetryableError(msg);
    throw Object.assign(new Error(msg), { status: res.status, stripeCode: data?.error?.code, retryable: false });
  }
  return data;
}

/* ---------- inicio del pago ---------- */
/** Crea la sesión de pago de Stripe para una cita ya guardada como pendiente de pago. */
export async function startCheckout(appointmentId: string, manageToken: string): Promise<string> {
  const a = await one(`
    SELECT a.*, s.name AS service_name, s.price_eur, sp.name AS specialist_name, p.email AS patient_email
    FROM appointments a JOIN services s ON s.id = a.service_id JOIN specialists sp ON sp.id = a.specialist_id JOIN patients p ON p.id = a.patient_id
    WHERE a.id = $1`, [appointmentId]);
  if (!a || a.payment_status !== 'pending') throw badRequest('Esta cita no tiene ningún pago pendiente.');
  const settings = await getSettings();
  const loc = utcToZoned(new Date(a.starts_at), config.timezone);
  const rest = Math.max(0, Math.round(Number(a.price_eur) * 100) - a.payment_amount_cents);
  const back = `${config.publicBaseUrl}/cita.html?t=${encodeURIComponent(manageToken)}`;
  const session = await stripe('POST', '/v1/checkout/sessions', {
    mode: 'payment',
    locale: 'es',
    customer_email: a.patient_email || undefined,
    client_reference_id: a.id,
    expires_at: Math.floor(new Date(a.payment_expires_at).getTime() / 1000),
    success_url: `${back}&pago=ok`,
    cancel_url: `${back}&pago=cancelado`,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: a.payment_amount_cents,
        product_data: {
          name: `Señal (${settings.payments.depositPercent} %) · ${a.service_name}`,
          description: `Cita con ${a.specialist_name} el ${longDateEs(loc.date)} a las ${loc.time}. ${rest > 0 ? `El resto (${euros(rest)}) se paga en el centro.` : ''} Si cancelas con más de ${settings.booking.cancelMinNoticeHours} h de antelación, se te devuelve.`.trim()
        }
      }
    }],
    metadata: { appointment_id: a.id },
    payment_intent_data: { metadata: { appointment_id: a.id }, description: `Señal cita ${a.service_name} ${loc.date} ${loc.time}` }
  }, `checkout-${a.id}`);
  await pool.query('UPDATE appointments SET payment_session_id = $2, payment_url = $3 WHERE id = $1', [a.id, session.id, session.url]);
  return session.url;
}

/* ---------- confirmación ---------- */
/** Consulta a Stripe y, si la señal está pagada, confirma la cita. Devuelve el estado del pago. */
export async function syncPayment(appointmentId: string): Promise<PaymentStatus> {
  const a = await one('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
  if (!a) throw notFound('La cita no existe.');
  if (a.payment_status !== 'pending' || !a.payment_session_id) return a.payment_status;
  const session = await stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(a.payment_session_id)}`);
  if (session.payment_status !== 'paid') return 'pending';
  const { afterChange } = await import('./appointments.ts');
  const settings = await getSettings();
  await tx(async c => {
    const u = await one(
      `UPDATE appointments SET payment_status = 'paid', paid_at = now(), payment_intent_id = $2,
         status = CASE WHEN status = 'cancelada' THEN status ELSE $3 END, updated_at = now()
       WHERE id = $1 AND payment_status = 'pending' RETURNING *`,
      [a.id, typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null, settings.booking.onlineStatus], c);
    if (!u) return;
    if (u.status === 'cancelada') {
      // Pagó justo cuando caducaba el plazo y el hueco ya se liberó: se devuelve.
      await enqueue(c, { type: 'pay.refund', payload: { appointmentId: a.id, reason: 'pago tras caducar' }, appointmentId: a.id, dedupeKey: `refund:${a.id}` });
    } else {
      await afterChange(c, u, 'created');
    }
    await audit(c, 'stripe', 'pago.señal', { id: a.id, importe: euros(a.payment_amount_cents) });
  });
  return 'paid';
}

/** Tarea programada al caducar el plazo de pago: confirma si se pagó; si no, cancela y libera el hueco. */
export async function expireIfUnpaid(appointmentId: string): Promise<string> {
  const st = await syncPayment(appointmentId);
  if (st !== 'pending') return `pago ${st}`;
  const a = await one('SELECT payment_session_id FROM appointments WHERE id = $1', [appointmentId]);
  try { await stripe('POST', `/v1/checkout/sessions/${encodeURIComponent(a.payment_session_id)}/expire`); }
  catch (e) {
    // Si Stripe dice que ya no se puede caducar, puede que se haya pagado en el último segundo: se vuelve a mirar.
    if ((await syncPayment(appointmentId)) === 'paid') return 'pago paid';
    log.warn('no se pudo caducar la sesión de Stripe', { appointmentId, err: (e as Error).message });
  }
  if ((await syncPayment(appointmentId)) === 'paid') return 'pago paid';
  await tx(async c => {
    const u = await one(
      `UPDATE appointments SET payment_status = 'expired', status = 'cancelada', cancelled_at = now(), cancelled_by = 'sin pago', updated_at = now()
       WHERE id = $1 AND payment_status = 'pending' RETURNING id`, [appointmentId], c);
    if (!u) return;
    await enqueue(c, { type: 'gcal.upsert', payload: { appointmentId }, appointmentId });
    await audit(c, 'sistema', 'cita.sin_pago', { id: appointmentId });
  });
  return 'cita cancelada por no pagar';
}

/** El paciente cancela antes de pagar: se cierra la página de pago para que no se pueda pagar después. */
export async function cancelCheckout(appointmentId: string) {
  const a = await one('SELECT payment_session_id FROM appointments WHERE id = $1', [appointmentId]);
  await pool.query(`UPDATE appointments SET payment_status = 'expired', updated_at = now() WHERE id = $1 AND payment_status = 'pending'`, [appointmentId]);
  if (a?.payment_session_id) {
    try { await stripe('POST', `/v1/checkout/sessions/${encodeURIComponent(a.payment_session_id)}/expire`); }
    catch (e) { log.warn('no se pudo cerrar la sesión de Stripe', { appointmentId, err: (e as Error).message }); }
  }
}

/* ---------- devolución ---------- */
export async function refund(appointmentId: string, reason: string): Promise<string> {
  const a = await one('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
  if (!a) return 'cita eliminada';
  if (a.payment_status === 'refunded') return 'ya devuelta';
  if (a.payment_status !== 'paid' || !a.payment_intent_id) return `nada que devolver (${a.payment_status})`;
  const r = await stripe('POST', '/v1/refunds', { payment_intent: a.payment_intent_id, reason: 'requested_by_customer', metadata: { appointment_id: a.id, motivo: reason } }, `refund-${a.id}`);
  await pool.query(`UPDATE appointments SET payment_status = 'refunded', refunded_at = now(), refund_id = $2, updated_at = now() WHERE id = $1`, [a.id, r.id]);
  await audit(pool, 'stripe', 'pago.devuelto', { id: a.id, importe: euros(a.payment_amount_cents), motivo: reason });
  return `devuelto ${r.id}`;
}

/** Programa la devolución (con reintentos si Stripe falla). */
export async function queueRefund(db: Db, appointmentId: string, reason: string) {
  await enqueue(db, { type: 'pay.refund', payload: { appointmentId, reason }, appointmentId, dedupeKey: `refund:${appointmentId}` });
}

export function presentPayment(a: any) {
  if (!a.payment_status || a.payment_status === 'none') return null;
  return {
    status: a.payment_status as PaymentStatus,
    amountCents: a.payment_amount_cents as number,
    amount: euros(a.payment_amount_cents || 0),
    paidAt: a.paid_at ? new Date(a.paid_at).toISOString() : null,
    refundedAt: a.refunded_at ? new Date(a.refunded_at).toISOString() : null,
    expiresAt: a.payment_expires_at ? new Date(a.payment_expires_at).toISOString() : null
  };
}
