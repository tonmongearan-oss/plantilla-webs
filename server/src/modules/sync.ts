/* Ejecución de las tareas en segundo plano: sincronización con Google Calendar,
   mensajes de WhatsApp y mantenimiento. */
import { config } from '../config.ts';
import { shortName } from '../site.ts';
import { pool, one } from '../db.ts';
import { decrypt } from '../lib/crypto.ts';
import { longDateEs, utcToZoned } from '../lib/time.ts';
import { log } from '../lib/log.ts';
import * as google from './google.ts';
import { sendTemplate, type TemplateKey } from './whatsapp.ts';
import { getSettings } from './settings.ts';
import { enqueue, type Job } from './jobs.ts';
import { expireIfUnpaid, refund, euros } from './payments.ts';

const LABEL_SOURCE: Record<string, string> = { web: 'web', chatbot: 'asistente web', panel: 'panel', telefono: 'teléfono' };

/* ---------- Texto del evento de Google Calendar ---------- */
const STATUS_LABEL: Record<string, string> = { pendiente: '⏳ Pendiente de confirmar', confirmada: '✅ Confirmada', completada: '✔️ Completada', cancelada: '❌ Cancelada' };
// Color del especialista en el panel → color de Google Calendar (colorId)
const GCAL_COLOR: Record<string, string> = { sage: '2', blue: '9', sand: '5', plum: '3', teal: '7', rose: '4' };
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function calendarEventText(a: any, center: { name: string; address: string; city: string }) {
  const start = utcToZoned(new Date(a.starts_at), config.timezone);
  const end = utcToZoned(new Date(a.ends_at), config.timezone);
  const phone = String(a.patient_phone || '');
  const waNumber = phone.replace(/[^0-9]/g, '');
  const firstVisit = Number(a.previous_visits || 0) === 0;
  const waStatus = a.patient_wa_out ? 'Se dio de baja' : a.patient_wa ? 'Sí, recibe confirmación y recordatorios' : 'No (no dio su consentimiento)';
  const panel = `${config.publicBaseUrl}/admin/`;
  const lines = [
    `<b>${esc(STATUS_LABEL[a.status] || a.status)}</b>${firstVisit ? ' · <b>🆕 Primera visita</b>' : ` · Visita n.º ${Number(a.previous_visits) + 1}`}`,
    '',
    '<b>👤 Paciente</b>',
    esc(a.patient_name),
    `📞 <a href="tel:${esc(phone)}">${esc(phone)}</a>`,
    waNumber ? `💬 <a href="https://wa.me/${waNumber}">Escribir por WhatsApp</a>` : null,
    a.patient_email ? `✉️ <a href="mailto:${esc(a.patient_email)}">${esc(a.patient_email)}</a>` : null,
    '',
    '<b>🩺 Cita</b>',
    `Servicio: ${esc(a.service_name)}${a.service_minutes ? ` (${a.service_minutes} min)` : ''}${a.service_price != null ? ` · ${Number(a.service_price).toFixed(2).replace('.', ',')} €` : ''}`,
    `Especialista: ${esc(a.specialist_name)}${a.specialist_role ? ` · ${esc(a.specialist_role)}` : ''}`,
    `Fecha: ${longDateEs(start.date)}, de ${start.time} a ${end.time}`,
    `Reservada desde: ${esc(LABEL_SOURCE[a.source] || a.source)}`,
    `Recordatorios por WhatsApp: ${waStatus}`,
    a.payment_status && a.payment_status !== 'none' ? `💳 Señal online: ${euros(a.payment_amount_cents || 0)} · ${({ pending: 'pendiente de pago', paid: 'pagada', refunded: 'devuelta', expired: 'no pagada' } as Record<string, string>)[a.payment_status] || a.payment_status}` : null,
    '',
    `<a href="${esc(panel)}">Abrir el panel de ${esc(shortName())}</a> · Ref. ${esc(String(a.id).slice(0, 8).toUpperCase())}`,
    '<i>Para cambiar o cancelar la cita, hazlo desde el panel: así el paciente recibe el aviso.</i>'
  ];
  return {
    summary: `${a.patient_name} · ${a.service_name} (${a.specialist_name})${a.payment_status === 'pending' ? ' · PENDIENTE DE PAGO' : a.status === 'pendiente' ? ' · PENDIENTE' : ''}`,
    description: lines.filter(l => l !== null).join('<br>'),
    location: [center.name, center.address, center.city].filter(Boolean).join(', '),
    colorId: GCAL_COLOR[a.specialist_color]
  };
}

/** Crea, actualiza o borra el evento de Google Calendar de una cita según su estado actual. */
async function gcalSync(appointmentId: string): Promise<string> {
  const a = await one(`
    SELECT a.*, s.name AS service_name, s.duration_min AS service_minutes, s.price_eur AS service_price,
           sp.name AS specialist_name, sp.role AS specialist_role, sp.color AS specialist_color,
           sp.google_account_id AS sp_account, sp.google_calendar_id AS sp_calendar,
           p.name AS patient_name, p.phone AS patient_phone, p.email AS patient_email,
           p.whatsapp_opt_in AS patient_wa, p.whatsapp_opt_out_at AS patient_wa_out,
           (SELECT count(*) FROM appointments x WHERE x.patient_id = a.patient_id AND x.status <> 'cancelada' AND x.starts_at < a.starts_at) AS previous_visits
    FROM appointments a JOIN services s ON s.id = a.service_id JOIN specialists sp ON sp.id = a.specialist_id JOIN patients p ON p.id = a.patient_id
    WHERE a.id = $1`, [appointmentId]);
  if (!a) return 'cita eliminada';
  const target = a.sp_account && a.sp_calendar ? { account: a.sp_account as string, calendar: a.sp_calendar as string } : null;
  const current = a.google_event_id && a.google_account_id && a.google_calendar_id ? { account: a.google_account_id as string, calendar: a.google_calendar_id as string, event: a.google_event_id as string } : null;
  try {
    // El evento está en otro calendario (se cambió la configuración) o la cita está cancelada: se borra.
    if (current && (a.status === 'cancelada' || !target || target.account !== current.account || target.calendar !== current.calendar)) {
      await google.deleteEvent(current.account, current.calendar, current.event);
      await pool.query(`UPDATE appointments SET google_event_id = NULL, google_account_id = NULL, google_calendar_id = NULL WHERE id = $1`, [a.id]);
      if (a.status === 'cancelada' || !target) {
        await pool.query(`UPDATE appointments SET google_sync = $2, google_sync_error = NULL WHERE id = $1`, [a.id, target ? 'synced' : 'not_connected']);
        return 'evento borrado';
      }
    }
    if (a.status === 'cancelada') { await pool.query(`UPDATE appointments SET google_sync = 'synced', google_sync_error = NULL WHERE id = $1`, [a.id]); return 'nada que borrar'; }
    if (!target) { await pool.query(`UPDATE appointments SET google_sync = 'not_connected' WHERE id = $1`, [a.id]); return 'especialista sin calendario'; }
    const sameCal = current && target.account === current.account && target.calendar === current.calendar;
    const eventId = await google.upsertEvent(target.account, target.calendar, sameCal ? current!.event : null, {
      appointmentId: a.id,
      ...calendarEventText(a, (await getSettings()).center),
      startIso: new Date(a.starts_at).toISOString(),
      endIso: new Date(a.ends_at).toISOString(),
      timeZone: config.timezone
    });
    await pool.query(`UPDATE appointments SET google_event_id = $2, google_account_id = $3, google_calendar_id = $4, google_sync = 'synced', google_sync_error = NULL WHERE id = $1`,
      [a.id, eventId, target.account, target.calendar]);
    return `evento ${eventId}`;
  } catch (e) {
    await pool.query(`UPDATE appointments SET google_sync = 'error', google_sync_error = $2 WHERE id = $1`, [a.id, String((e as Error).message).slice(0, 500)]);
    throw e;
  }
}

/** Datos de una cita o una plaza para componer el mensaje. */
async function messageContext(p: { appointmentId?: string; classBookingId?: string }) {
  if (p.appointmentId) {
    const a = await one(`
      SELECT a.id, a.status, a.starts_at, a.manage_token_enc, s.name AS service, sp.name AS professional, pt.id AS patient_id, pt.name, pt.phone, pt.whatsapp_opt_in
      FROM appointments a JOIN services s ON s.id = a.service_id JOIN specialists sp ON sp.id = a.specialist_id JOIN patients pt ON pt.id = a.patient_id
      WHERE a.id = $1`, [p.appointmentId]);
    return a && { ...a, startsAt: new Date(a.starts_at), active: a.status === 'pendiente' || a.status === 'confirmada' };
  }
  const b = await one(`
    SELECT cb.id, cb.status, cb.session_date, cs.start_time, cb.manage_token_enc, ct.name AS type_name, pt.id AS patient_id, pt.name, pt.phone, pt.whatsapp_opt_in
    FROM class_bookings cb JOIN class_slots cs ON cs.id = cb.class_slot_id JOIN class_types ct ON ct.id = cs.class_type_id JOIN patients pt ON pt.id = cb.patient_id
    WHERE cb.id = $1`, [p.classBookingId]);
  if (!b) return undefined;
  const { zonedToUtc } = await import('../lib/time.ts');
  return { ...b, service: `Clase de ${b.type_name}`, professional: `el equipo de ${shortName()}`, startsAt: zonedToUtc(b.session_date, String(b.start_time).slice(0, 5), config.timezone), active: b.status === 'confirmada' };
}

async function waSend(payload: { template: TemplateKey; appointmentId?: string; classBookingId?: string; startsAt?: string }): Promise<string> {
  if (config.whatsapp.provider === 'disabled') return 'WhatsApp desactivado';
  const ctx = await messageContext(payload);
  if (!ctx) return 'reserva eliminada';
  if (!ctx.whatsapp_opt_in) return 'sin consentimiento de WhatsApp';
  if (payload.template !== 'cancelled') {
    if (!ctx.active) return 'reserva no activa';
    if (payload.startsAt && new Date(payload.startsAt).getTime() !== ctx.startsAt.getTime()) return 'la hora ha cambiado';
    if (ctx.startsAt.getTime() < Date.now()) return 'la cita ya ha pasado';
  }
  const settings = await getSettings();
  const loc = utcToZoned(ctx.startsAt, config.timezone);
  const res = await sendTemplate({
    template: payload.template,
    to: ctx.phone,
    vars: {
      nombre: String(ctx.name).split(/\s+/)[0],
      servicio: ctx.service,
      fecha: longDateEs(loc.date),
      hora: loc.time,
      profesional: ctx.professional,
      instrucciones: settings.reminders.instructions
    },
    manageToken: ctx.manage_token_enc ? decrypt(ctx.manage_token_enc) : undefined
  });
  if (!res) return 'WhatsApp desactivado';
  await pool.query(
    `INSERT INTO notifications (patient_id, appointment_id, class_booking_id, kind, provider, template, to_phone, provider_message_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ctx.patient_id, payload.appointmentId || null, payload.classBookingId || null, payload.template, res.provider, res.templateName, ctx.phone, res.messageId]);
  return `enviado ${res.messageId}`;
}

async function retention(): Promise<string> {
  const r1 = await pool.query(`DELETE FROM contact_messages WHERE created_at < now() - interval '12 months'`);
  const r2 = await pool.query(`DELETE FROM jobs WHERE status IN ('done','cancelled') AND created_at < now() - interval '90 days'`);
  const r3 = await pool.query(`DELETE FROM notifications WHERE created_at < now() - interval '12 months'`);
  await pool.query(`DELETE FROM sessions WHERE expires_at < now()`);
  await pool.query(`DELETE FROM oauth_states WHERE expires_at < now()`);
  return `mensajes ${r1.rowCount}, tareas ${r2.rowCount}, notificaciones ${r3.rowCount}`;
}

export async function runJob(job: Job): Promise<string> {
  switch (job.type) {
    case 'gcal.upsert': return gcalSync(job.payload.appointmentId);
    case 'gcal.delete': await google.deleteEvent(job.payload.accountId, job.payload.calendarId, job.payload.eventId); return 'evento borrado';
    case 'wa.send': return waSend(job.payload);
    case 'maintenance.retention': return retention();
    case 'pay.expire': return expireIfUnpaid(job.payload.appointmentId);
    case 'pay.refund': return refund(job.payload.appointmentId, job.payload.reason || '');
    default: throw Object.assign(new Error(`Tipo de tarea desconocido: ${job.type}`), { retryable: false });
  }
}

export async function scheduleDailyMaintenance() {
  const day = new Date().toISOString().slice(0, 10);
  await enqueue(pool, { type: 'maintenance.retention', dedupeKey: `retention:${day}`, runAt: new Date() });
}
export { log };
