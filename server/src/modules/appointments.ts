/* Citas individuales: disponibilidad, reserva, cambios y cancelaciones. */
import { config } from '../config.ts';
import { shortName } from '../site.ts';
import { q, one, tx, audit, pool, type Db } from '../db.ts';
import { AppError, badRequest, conflict, notFound, isOverlapError } from '../lib/errors.ts';
import { daySlots, checkFits, dayPlan, type Busy, type Slot, type DayPlan } from '../lib/availability.ts';
import { addDays, zonedToUtc, utcToZoned, nowLocal, tmin, daysInMonth } from '../lib/time.ts';
import { randomToken, sha256, encrypt } from '../lib/crypto.ts';
import * as v from '../lib/validate.ts';
import { getService, getSpecialist, specialistsForService, type Specialist, type Service } from './catalog.ts';
import { findOrCreatePatient, patientRow } from './patients.ts';
import { getSettings } from './settings.ts';
import { busyIntervals } from './google.ts';
import { enqueue, cancelPending } from './jobs.ts';
import { depositFor, startCheckout, syncPayment, queueRefund, presentPayment, cancelCheckout } from './payments.ts';

export const STATUSES = ['pendiente', 'confirmada', 'completada', 'cancelada'] as const;
export type Status = typeof STATUSES[number];
const SOURCES = ['web', 'chatbot', 'panel', 'telefono'] as const;
const TZ = () => config.timezone;

/* ---------- ocupación ---------- */
const dayStartUtc = (date: string) => zonedToUtc(date, '00:00', TZ());

function toLocalBusy(intervals: { start: number; end: number; kind: Busy['kind']; id?: string }[], date: string): Busy[] {
  const d0 = dayStartUtc(date).getTime(), d1 = dayStartUtc(addDays(date, 1)).getTime();
  const out: Busy[] = [];
  for (const i of intervals) {
    if (i.end <= d0 || i.start >= d1) continue;
    const s = i.start <= d0 ? 0 : utcToZoned(new Date(i.start), TZ()).minutes;
    const e = i.end >= d1 ? 24 * 60 : utcToZoned(new Date(i.end), TZ()).minutes;
    if (e > s) out.push({ s, e, kind: i.kind, id: i.id });
  }
  return out;
}

/** Citas activas (y, si se pide, eventos de Google) del especialista entre dos fechas locales. */
async function busyRange(sp: Specialist, fromDate: string, toDate: string, opts: { excludeId?: string; external?: boolean; db?: Db } = {}) {
  const from = dayStartUtc(fromDate), to = dayStartUtc(addDays(toDate, 1));
  const rows = await q<{ id: string; starts_at: Date; ends_at: Date }>(
    `SELECT id, starts_at, ends_at FROM appointments
     WHERE specialist_id = $1 AND status <> 'cancelada' AND starts_at < $3 AND ends_at > $2 AND ($4::uuid IS NULL OR id <> $4::uuid)`,
    [sp.id, from.toISOString(), to.toISOString(), opts.excludeId || null], opts.db || pool);
  const items: { start: number; end: number; kind: Busy['kind']; id?: string }[] = rows.map(r => ({ start: new Date(r.starts_at).getTime(), end: new Date(r.ends_at).getTime(), kind: 'booking' as const, id: r.id }));
  if (opts.external !== false) for (const g of await busyIntervals(sp, from, to)) items.push({ ...g, kind: 'external' });
  return items;
}

function slotOpts(settings: Awaited<ReturnType<typeof getSettings>>, ignoreNotice = false) {
  const n = nowLocal(TZ());
  return { today: n.date, nowMin: n.minutes, noticeMin: settings.booking.minNoticeMinutes, ignoreNotice };
}

async function load(spId: string, svcId: string) {
  const sp = await getSpecialist(v.uuid(spId, 'especialista'));
  if (!sp) throw notFound('El especialista no existe.');
  const svc = await getService(v.slug(svcId, 'servicio'));
  if (!svc) throw notFound('El servicio no existe.');
  return { sp, svc };
}

export type DayResult = { date: string; plan: DayPlan; slots: Slot[] };

/** Huecos de varios días seguidos, consultando la ocupación una sola vez. */
export async function rangeSlots(sp: Specialist, svc: Service, fromDate: string, toDate: string, opts: { excludeId?: string; ignoreNotice?: boolean; external?: boolean } = {}): Promise<DayResult[]> {
  const settings = await getSettings();
  const busy = await busyRange(sp, fromDate, toDate, opts);
  const o = slotOpts(settings, opts.ignoreNotice);
  const out: DayResult[] = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    const r = daySlots({ ...sp, slotStep: sp.slotStep }, d, svc.duration, toLocalBusy(busy, d), o);
    out.push({ date: d, ...r });
  }
  return out;
}

export async function daySlotsFor(spId: string, svcId: string, date: string, excludeId?: string) {
  const { sp, svc } = await load(spId, svcId);
  v.date(date);
  const [r] = await rangeSlots(sp, svc, date, date, { excludeId });
  return { plan: r.plan, slots: r.slots.filter(s => s.status !== 'break').map(s => ({ start: s.start, status: s.status })) };
}

export type DayStatus = 'available' | 'full' | 'off' | 'vacation' | 'past' | 'closed';
export async function monthStatus(spId: string, svcId: string, ym: string, excludeId?: string): Promise<Record<string, DayStatus>> {
  if (!/^\d{4}-\d{2}$/.test(ym)) throw badRequest('Mes no válido.');
  const { sp, svc } = await load(spId, svcId);
  const settings = await getSettings();
  const today = nowLocal(TZ()).date;
  const horizon = addDays(today, settings.booking.horizonDays);
  const days = daysInMonth(ym);
  const out: Record<string, DayStatus> = {};
  const from = days.find(d => d >= today && d <= horizon);
  const to = [...days].reverse().find(d => d >= today && d <= horizon);
  const res = from && to ? await rangeSlots(sp, svc, from, to, { excludeId }) : [];
  for (const d of days) {
    if (d < today) { out[d] = 'past'; continue; }
    if (d > horizon) { out[d] = 'closed'; continue; }
    const r = res.find(x => x.date === d)!;
    if (!r.plan.working) { out[d] = r.plan.reason === 'vacation' ? 'vacation' : 'off'; continue; }
    out[d] = r.slots.some(s => s.status === 'available') ? 'available' : r.slots.some(s => s.status === 'booked') ? 'full' : 'past';
  }
  return out;
}

/** Próximas horas libres de un servicio, con uno o varios especialistas. */
export async function nextAvailable(svcId: string, spIds: string[] | null, limit: number) {
  const svc = await getService(v.slug(svcId, 'servicio'));
  if (!svc || !svc.active) throw notFound('El servicio no existe.');
  const settings = await getSettings();
  const today = nowLocal(TZ()).date;
  const all = (await specialistsForService(svc.id)).filter(s => !spIds || spIds.includes(s.id));
  const out: { date: string; start: string; specialistId: string }[] = [];
  for (const sp of all) {
    // Se busca por tramos de 14 días para no consultar todo el horizonte si hay huecos pronto.
    let found = 0;
    for (let f = today; f <= addDays(today, settings.booking.horizonDays) && found < limit; f = addDays(f, 14)) {
      const t = addDays(f, 13) < addDays(today, settings.booking.horizonDays) ? addDays(f, 13) : addDays(today, settings.booking.horizonDays);
      for (const r of await rangeSlots(sp, svc, f, t)) for (const s of r.slots) {
        if (s.status === 'available' && found < limit) { out.push({ date: r.date, start: s.start, specialistId: sp.id }); found++; }
      }
    }
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, limit);
}

/* ---------- reserva ---------- */
export type CreateInput = {
  serviceId: unknown; specialistId: unknown; date: unknown; start: unknown;
  patientId?: unknown; name?: unknown; phone?: unknown; email?: unknown; whatsappOptIn?: unknown; privacyAccepted?: unknown;
  status?: unknown; source?: unknown;
};

async function assertBookable(sp: Specialist, svc: Service, date: string, start: string, opts: { panel: boolean; excludeId?: string; db?: Db }) {
  if (!svc.active && !opts.panel) throw badRequest('Este servicio no está disponible para reserva online.');
  if (!sp.active) throw badRequest(`${sp.name} no tiene agenda disponible en este momento.`);
  if (!sp.serviceIds.includes(svc.id)) throw badRequest(`${sp.name} no ofrece ${svc.name}.`);
  const settings = await getSettings();
  const now = nowLocal(TZ());
  const startMin = tmin(start);
  if (date < now.date || (date === now.date && startMin < now.minutes)) throw badRequest('No se pueden reservar horas pasadas.');
  if (!opts.panel) {
    if (date > addDays(now.date, settings.booking.horizonDays)) throw badRequest('Esa fecha todavía no está abierta a reservas.');
    if (date === now.date && startMin < now.minutes + settings.booking.minNoticeMinutes) throw badRequest('Esa hora está demasiado cerca. Elige otra o llama al centro.');
  }
  const busy = await busyRange(sp, date, date, { excludeId: opts.excludeId, db: opts.db });
  const err = checkFits(sp, date, start, svc.duration, toLocalBusy(busy, date));
  if (err) throw /reservado|ocupado/.test(err) ? conflict(err, 'slot_taken') : badRequest(err);
}

export async function createAppointment(input: CreateInput, actor: string, opts: { panel: boolean }) {
  const { sp, svc } = await load(String(input.specialistId ?? ''), String(input.serviceId ?? ''));
  const date = v.date(input.date), start = v.time(input.start);
  await assertBookable(sp, svc, date, start, { panel: opts.panel });
  const settings = await getSettings();
  // Señal online: solo en reservas desde la web, si Stripe está configurado y el servicio tiene precio.
  const deposit = opts.panel ? null : await depositFor(svc.price);
  const status: Status = deposit ? 'pendiente'
    : opts.panel && STATUSES.includes(input.status as Status) && input.status !== 'cancelada' ? input.status as Status : settings.booking.onlineStatus;
  const source = opts.panel ? (SOURCES.includes(input.source as any) ? input.source as string : 'panel') : (input.source === 'chatbot' ? 'chatbot' : 'web');
  const startsAt = zonedToUtc(date, start, TZ());
  const endsAt = new Date(startsAt.getTime() + svc.duration * 60000);
  // Stripe exige que la sesión de pago dure al menos 30 minutos.
  const payExpires = deposit ? new Date(Date.now() + Math.max(31, settings.payments.holdMinutes + 1) * 60000) : null;
  const token = randomToken();
  let created;
  try {
    created = await tx(async c => {
      let patient;
      if (opts.panel && input.patientId) {
        const p = await one('SELECT * FROM patients WHERE id = $1', [v.uuid(input.patientId, 'paciente')], c);
        if (!p) throw notFound('El paciente no existe.');
        patient = patientRow(p);
      } else {
        patient = await findOrCreatePatient(input as any, c, { requirePrivacy: !opts.panel });
      }
      const a = await one(
        `INSERT INTO appointments (service_id, specialist_id, patient_id, starts_at, ends_at, status, source, manage_token_hash, manage_token_enc, google_sync,
                                   payment_status, payment_amount_cents, payment_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [svc.id, sp.id, patient.id, startsAt.toISOString(), endsAt.toISOString(), status, source, sha256(token), encrypt(token), sp.google.calendarId ? 'pending' : 'not_connected',
         deposit ? 'pending' : 'none', deposit, payExpires ? payExpires.toISOString() : null], c);
      if (deposit) {
        // Hueco reservado mientras paga: va a Google Calendar como pendiente; la confirmación y los recordatorios, al pagar.
        await enqueue(c, { type: 'gcal.upsert', payload: { appointmentId: a.id }, appointmentId: a.id });
        await enqueue(c, { type: 'pay.expire', payload: { appointmentId: a.id }, appointmentId: a.id, runAt: new Date(payExpires!.getTime() + 60_000), dedupeKey: `pay:expire:${a.id}` });
      } else {
        await afterChange(c, a, 'created');
      }
      await audit(c, actor, 'cita.creada', { id: a.id, servicio: svc.id, especialista: sp.name, fecha: date, hora: start, origen: source, señal: deposit ? deposit / 100 : null });
      return { appointment: await present(a, c), manageToken: token };
    });
  } catch (e) {
    if (isOverlapError(e)) throw conflict('Este horario acaba de reservarse. Elige otra hora.', 'slot_taken');
    throw e;
  }
  if (!deposit) return created;
  try {
    const checkoutUrl = await startCheckout(created.appointment.id, token);
    return { ...created, checkoutUrl };
  } catch (e) {
    // Sin pasarela no se puede completar la reserva: se libera el hueco.
    await pool.query(`UPDATE appointments SET status = 'cancelada', payment_status = 'expired', cancelled_at = now(), cancelled_by = 'error de pago', updated_at = now() WHERE id = $1`, [created.appointment.id]);
    await enqueue(pool, { type: 'gcal.upsert', payload: { appointmentId: created.appointment.id }, appointmentId: created.appointment.id });
    throw new AppError(502, 'payment_unavailable', 'No hemos podido abrir la página de pago. Inténtalo de nuevo en unos minutos o llama al centro.');
  }
}

/** Programa la sincronización con Google y los mensajes de WhatsApp tras un cambio. */
export async function afterChange(c: Db, a: any, what: 'created' | 'rescheduled' | 'cancelled' | 'reactivated') {
  const startsIso = new Date(a.starts_at).toISOString();
  await enqueue(c, { type: 'gcal.upsert', payload: { appointmentId: a.id }, appointmentId: a.id });
  if (what === 'cancelled' || what === 'rescheduled') {
    await cancelPending(c, { appointmentId: a.id }, ['wa.send'], p => p.template === 'reminder' || p.template === 'confirmation');
  }
  if (what === 'cancelled') {
    if (new Date(a.starts_at) > new Date()) await enqueue(c, { type: 'wa.send', payload: { template: 'cancelled', appointmentId: a.id, startsAt: startsIso }, appointmentId: a.id, dedupeKey: `wa:cancelled:${a.id}:${startsIso}` });
    return;
  }
  if (what === 'created') await enqueue(c, { type: 'wa.send', payload: { template: 'confirmation', appointmentId: a.id, startsAt: startsIso }, appointmentId: a.id, dedupeKey: `wa:confirmation:${a.id}` });
  if (what === 'rescheduled') await enqueue(c, { type: 'wa.send', payload: { template: 'rescheduled', appointmentId: a.id, startsAt: startsIso }, appointmentId: a.id, dedupeKey: `wa:rescheduled:${a.id}:${startsIso}` });
  await scheduleReminders(c, { appointmentId: a.id }, new Date(a.starts_at));
}

export async function scheduleReminders(c: Db, ref: { appointmentId?: string; classBookingId?: string }, startsAt: Date) {
  const settings = await getSettings();
  if (!settings.reminders.enabled) return;
  const startsIso = startsAt.toISOString();
  for (const off of settings.reminders.offsetsMinutes) {
    const runAt = new Date(startsAt.getTime() - off * 60000);
    if (runAt.getTime() < Date.now() + 60_000) continue;
    const id = ref.appointmentId || ref.classBookingId;
    await enqueue(c, {
      type: 'wa.send', runAt, appointmentId: ref.appointmentId, classBookingId: ref.classBookingId,
      payload: { template: 'reminder', ...ref, startsAt: startsIso, offsetMinutes: off },
      dedupeKey: `wa:reminder:${id}:${startsIso}:${off}`
    });
  }
}

/* ---------- cambios ---------- */
export async function setStatus(id: string, status: unknown, actor: string) {
  const st = v.oneOf(status, 'estado', STATUSES);
  try {
    return await tx(async c => {
      const a = await one('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [v.uuid(id)], c);
      if (!a) throw notFound('La cita no existe.');
      if (a.status === st) return present(a, c);
      const u = await one(
        `UPDATE appointments SET status = $2, updated_at = now(),
           cancelled_at = CASE WHEN $2 = 'cancelada' THEN now() END, cancelled_by = CASE WHEN $2 = 'cancelada' THEN $3 END
         WHERE id = $1 RETURNING *`, [a.id, st, actor], c);
      if (st === 'cancelada') await afterChange(c, u, 'cancelled');
      else if (a.status === 'cancelada') await afterChange(c, u, 'reactivated');
      await audit(c, actor, 'cita.estado', { id: a.id, de: a.status, a: st });
      return present(u, c);
    });
  } catch (e) {
    if (isOverlapError(e)) throw conflict('No se puede reactivar: ese horario ya está ocupado por otra cita.', 'slot_taken');
    throw e;
  }
}

export async function reschedule(id: string, dateIn: unknown, startIn: unknown, actor: string, opts: { panel: boolean }) {
  const date = v.date(dateIn), start = v.time(startIn);
  const a0 = await one('SELECT * FROM appointments WHERE id = $1', [v.uuid(id)]);
  if (!a0) throw notFound('La cita no existe.');
  if (a0.status === 'cancelada' || a0.status === 'completada') throw badRequest('Esta cita ya no se puede cambiar.');
  const { sp, svc } = await load(a0.specialist_id, a0.service_id);
  await assertBookable(sp, svc, date, start, { panel: opts.panel, excludeId: a0.id });
  const startsAt = zonedToUtc(date, start, TZ());
  const endsAt = new Date(startsAt.getTime() + svc.duration * 60000);
  try {
    return await tx(async c => {
      const u = await one(`UPDATE appointments SET starts_at = $2, ends_at = $3, updated_at = now() WHERE id = $1 AND status IN ('pendiente','confirmada') RETURNING *`, [a0.id, startsAt.toISOString(), endsAt.toISOString()], c);
      if (!u) throw badRequest('Esta cita ya no se puede cambiar.');
      await afterChange(c, u, 'rescheduled');
      await audit(c, actor, 'cita.cambiada', { id: a0.id, nueva: `${date} ${start}` });
      return present(u, c);
    });
  } catch (e) {
    if (isOverlapError(e)) throw conflict('Este horario acaba de reservarse. Elige otra hora.', 'slot_taken');
    throw e;
  }
}

/* ---------- presentación ---------- */
export async function present(a: any, db: Db = pool) {
  const loc = utcToZoned(new Date(a.starts_at), TZ());
  const duration = Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000);
  return {
    id: a.id as string, kind: 'individual' as const, serviceId: a.service_id as string, specialistId: a.specialist_id as string, patientId: a.patient_id as string,
    date: loc.date, start: loc.time, duration, status: a.status as Status, source: a.source as string,
    googleSync: a.google_sync as string, googleSyncError: a.google_sync_error as string | null,
    payment: presentPayment(a),
    createdAt: new Date(a.created_at).toISOString()
  };
}

export async function listAppointments(fromDate: string, toDate: string) {
  const rows = await q(`SELECT * FROM appointments WHERE starts_at >= $1 AND starts_at < $2 ORDER BY starts_at`,
    [dayStartUtc(fromDate).toISOString(), dayStartUtc(addDays(toDate, 1)).toISOString()]);
  return Promise.all(rows.map(r => present(r)));
}

/* ---------- gestión por el paciente (enlace con token) ---------- */
export async function findByToken(token: string) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw notFound('El enlace no es válido o ha caducado.');
  const h = sha256(token);
  const a = await one(`SELECT a.*, s.name AS service_name, sp.name AS specialist_name, p.name AS patient_name
    FROM appointments a JOIN services s ON s.id = a.service_id JOIN specialists sp ON sp.id = a.specialist_id JOIN patients p ON p.id = a.patient_id
    WHERE a.manage_token_hash = $1`, [h]);
  if (a) return { kind: 'individual' as const, row: a };
  const cb = await one(`SELECT cb.*, ct.name AS type_name, cs.start_time, cs.end_time, p.name AS patient_name
    FROM class_bookings cb JOIN class_slots cs ON cs.id = cb.class_slot_id JOIN class_types ct ON ct.id = cs.class_type_id JOIN patients p ON p.id = cb.patient_id
    WHERE cb.manage_token_hash = $1`, [h]);
  if (cb) return { kind: 'class' as const, row: cb };
  throw notFound('El enlace no es válido o ha caducado.');
}

export async function publicSummary(token: string) {
  const f = await findByToken(token);
  const settings = await getSettings();
  const first = (n: string) => String(n).split(/\s+/)[0];
  if (f.kind === 'individual') {
    const p = await present(f.row);
    const startsAt = new Date(f.row.starts_at);
    const canChange = (p.status === 'pendiente' || p.status === 'confirmada') && startsAt.getTime() - Date.now() > settings.booking.cancelMinNoticeHours * 3600e3;
    const payment = p.payment && { ...p.payment, url: p.payment.status === 'pending' && f.row.payment_url && new Date(f.row.payment_expires_at) > new Date() ? f.row.payment_url : null };
    return { kind: 'individual', patientFirstName: first(f.row.patient_name), serviceId: p.serviceId, specialistId: p.specialistId, serviceName: f.row.service_name, specialistName: f.row.specialist_name, date: p.date, start: p.start, duration: p.duration, status: p.status, canChange: canChange && p.payment?.status !== 'pending', canCancel: canChange, payment, cancelMinNoticeHours: settings.booking.cancelMinNoticeHours, phone: settings.center.phone };
  }
  const startsAt = zonedToUtc(f.row.session_date, String(f.row.start_time).slice(0, 5), TZ());
  const canChange = f.row.status === 'confirmada' && startsAt.getTime() - Date.now() > settings.booking.cancelMinNoticeHours * 3600e3;
  return { kind: 'class', canCancel: canChange, payment: null, patientFirstName: first(f.row.patient_name), serviceName: f.row.type_name, specialistName: `Equipo ${shortName()}`, date: f.row.session_date, start: String(f.row.start_time).slice(0, 5), duration: tmin(String(f.row.end_time).slice(0, 5)) - tmin(String(f.row.start_time).slice(0, 5)), status: f.row.status, canChange, cancelMinNoticeHours: settings.booking.cancelMinNoticeHours, phone: settings.center.phone };
}

export async function cancelByToken(token: string) {
  const s = await publicSummary(token);
  if (!s.canCancel) throw new AppError(400, 'too_late', `Las citas solo se pueden cancelar online hasta ${s.cancelMinNoticeHours} horas antes. Llámanos al ${s.phone}.`);
  const f = await findByToken(token);
  if (f.kind === 'individual') {
    // Si estaba pendiente de pago, se comprueba antes por si acaba de pagar.
    const pay = f.row.payment_status === 'pending' ? await syncPayment(f.row.id) : f.row.payment_status;
    await setStatus(f.row.id, 'cancelada', 'paciente');
    if (pay === 'paid') await queueRefund(pool, f.row.id, 'cancelada por el paciente con antelación');
    if (pay === 'pending') await cancelCheckout(f.row.id);
  } else {
    const { cancelClassBooking } = await import('./classes.ts');
    await cancelClassBooking(f.row.id, 'paciente');
  }
  return publicSummary(token);
}

/** El paciente vuelve de Stripe: se comprueba el pago y se devuelve el estado actualizado. */
export async function paymentReturn(token: string) {
  const f = await findByToken(token);
  if (f.kind === 'individual' && f.row.payment_status === 'pending') await syncPayment(f.row.id);
  return publicSummary(token);
}

export async function rescheduleByToken(token: string, date: unknown, start: unknown) {
  const s = await publicSummary(token);
  if (s.kind !== 'individual') throw badRequest('Las clases no se pueden cambiar de hora: cancela la plaza y reserva otra.');
  if (!s.canChange) throw new AppError(400, 'too_late', `Las citas solo se pueden cambiar online hasta ${s.cancelMinNoticeHours} horas antes. Llámanos al ${s.phone}.`);
  const f = await findByToken(token);
  await reschedule(f.row.id, date, start, 'paciente', { panel: false });
  return publicSummary(token);
}

export async function appointmentIdFromToken(token: string): Promise<string | undefined> {
  try { const f = await findByToken(token); return f.kind === 'individual' ? f.row.id : undefined; } catch { return undefined; }
}

export { dayPlan };
