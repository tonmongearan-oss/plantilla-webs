/* Clases grupales: horario semanal, sesiones y plazas con aforo. */
import { config } from '../config.ts';
import { q, one, tx, audit, pool, type Db } from '../db.ts';
import { AppError, badRequest, conflict, notFound, isUniqueError } from '../lib/errors.ts';
import { addDays, isoWeekday, nowLocal, tmin, zonedToUtc } from '../lib/time.ts';
import { randomToken, sha256, encrypt } from '../lib/crypto.ts';
import * as v from '../lib/validate.ts';
import { findOrCreatePatient, patientRow } from './patients.ts';
import { enqueue, cancelPending } from './jobs.ts';
import { scheduleReminders } from './appointments.ts';

export type ClassType = { id: string; name: string; text: string; published: boolean };
export type ClassSlot = { id: string; typeId: string; weekday: number; start: string; end: string; capacity: number; active: boolean };

export async function listTypes(db: Db = pool): Promise<ClassType[]> {
  return (await q('SELECT * FROM class_types ORDER BY sort, name', [], db)).map(r => ({ id: r.id, name: r.name, text: r.description, published: r.published }));
}
const slotRow = (r: any): ClassSlot => ({ id: r.id, typeId: r.class_type_id, weekday: r.weekday, start: String(r.start_time).slice(0, 5), end: String(r.end_time).slice(0, 5), capacity: r.capacity, active: r.active });
export async function listSlots(db: Db = pool): Promise<ClassSlot[]> {
  return (await q('SELECT * FROM class_slots WHERE deleted_at IS NULL ORDER BY weekday, start_time', [], db)).map(slotRow);
}

export type Session = { slotId: string; typeId: string; typeName: string; date: string; start: string; end: string; capacity: number; taken: number; free: number; full: boolean; past: boolean };

export async function sessions(fromDate: string, days: number, opts: { includeInactive?: boolean } = {}): Promise<Session[]> {
  const types = await listTypes();
  const slots = (await listSlots()).filter(s => s.active || opts.includeInactive);
  const toDate = addDays(fromDate, days - 1);
  const counts = await q<{ class_slot_id: string; session_date: string; n: number }>(
    `SELECT class_slot_id, session_date, count(*)::int AS n FROM class_bookings
     WHERE status <> 'cancelada' AND session_date BETWEEN $1 AND $2 GROUP BY 1, 2`, [fromDate, toDate]);
  const now = nowLocal(config.timezone);
  const out: Session[] = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    const wd = isoWeekday(d);
    for (const s of slots.filter(x => x.weekday === wd).sort((a, b) => a.start.localeCompare(b.start))) {
      const taken = counts.find(c => c.class_slot_id === s.id && c.session_date === d)?.n || 0;
      out.push({
        slotId: s.id, typeId: s.typeId, typeName: types.find(t => t.id === s.typeId)?.name || s.typeId, date: d, start: s.start, end: s.end,
        capacity: s.capacity, taken, free: Math.max(0, s.capacity - taken), full: taken >= s.capacity,
        past: d < now.date || (d === now.date && tmin(s.start) <= now.minutes)
      });
    }
  }
  return out;
}

export async function bookClass(input: any, actor: string, opts: { panel: boolean }) {
  const slotId = v.uuid(input.slotId ?? input.templateId, 'clase');
  const date = v.date(input.date);
  const token = randomToken();
  try {
    return await tx(async c => {
      const slot = await one('SELECT * FROM class_slots WHERE id = $1 AND deleted_at IS NULL', [slotId], c);
      if (!slot || !slot.active) throw notFound('Esta clase no está disponible.');
      if (isoWeekday(date) !== slot.weekday) throw badRequest('La clase no se imparte ese día.');
      const now = nowLocal(config.timezone);
      const start = String(slot.start_time).slice(0, 5);
      if (!opts.panel && (date < now.date || (date === now.date && tmin(start) <= now.minutes))) throw badRequest('Esta clase ya ha empezado.');
      // Bloqueo por sesión: dos reservas simultáneas no pueden superar el aforo.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${slotId}|${date}`]);
      const n = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM class_bookings WHERE class_slot_id = $1 AND session_date = $2 AND status <> 'cancelada'`, [slotId, date], c))!.n;
      if (n >= slot.capacity) throw conflict('Clase completa: se ha alcanzado el aforo máximo.', 'class_full');
      let patient;
      if (opts.panel && input.patientId) {
        const p = await one('SELECT * FROM patients WHERE id = $1', [v.uuid(input.patientId, 'paciente')], c);
        if (!p) throw notFound('El paciente no existe.');
        patient = patientRow(p);
      } else patient = await findOrCreatePatient(input, c, { requirePrivacy: !opts.panel });
      const source = opts.panel ? 'panel' : input.source === 'chatbot' ? 'chatbot' : 'web';
      const b = await one(
        `INSERT INTO class_bookings (class_slot_id, session_date, patient_id, source, manage_token_hash, manage_token_enc) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [slotId, date, patient.id, source, sha256(token), encrypt(token)], c);
      const startsAt = zonedToUtc(date, start, config.timezone);
      await enqueue(c, { type: 'wa.send', payload: { template: 'confirmation', classBookingId: b.id, startsAt: startsAt.toISOString() }, classBookingId: b.id, dedupeKey: `wa:confirmation:${b.id}` });
      await scheduleReminders(c, { classBookingId: b.id }, startsAt);
      await audit(c, actor, 'clase.plaza', { id: b.id, clase: slotId, fecha: date, ocupadas: n + 1, aforo: slot.capacity });
      return { booking: presentBooking(b), manageToken: token, taken: n + 1, capacity: slot.capacity };
    });
  } catch (e) {
    if (isUniqueError(e)) throw conflict('Esta persona ya tiene plaza en esta clase.', 'already_booked');
    throw e;
  }
}

export const presentBooking = (b: any) => ({ id: b.id as string, kind: 'class' as const, templateId: b.class_slot_id as string, date: b.session_date as string, patientId: b.patient_id as string, status: b.status as string, source: b.source as string, createdAt: new Date(b.created_at).toISOString() });

export async function cancelClassBooking(id: string, actor: string) {
  await tx(async c => {
    const b = await one(`UPDATE class_bookings SET status = 'cancelada', cancelled_at = now() WHERE id = $1 AND status <> 'cancelada' RETURNING *`, [v.uuid(id)], c);
    if (!b) return;
    await cancelPending(c, { classBookingId: b.id }, ['wa.send']);
    await audit(c, actor, 'clase.plaza_cancelada', { id: b.id });
  });
}

export async function listClassBookings(fromDate: string, toDate: string) {
  return (await q('SELECT * FROM class_bookings WHERE session_date BETWEEN $1 AND $2 ORDER BY created_at', [fromDate, toDate])).map(presentBooking);
}

export async function saveSlot(input: any, actor: string): Promise<ClassSlot> {
  const typeId = v.slug(input.typeId, 'modalidad');
  const weekday = v.int(Number(input.weekday), 'día', 1, 7);
  const start = v.time(input.start, 'hora de inicio'), end = v.time(input.end, 'hora de fin');
  if (tmin(end) <= tmin(start)) throw badRequest('La clase debe terminar después de empezar.');
  const capacity = v.int(Number(input.capacity), 'aforo', 1, 100);
  if (!(await one('SELECT 1 FROM class_types WHERE id = $1', [typeId]))) throw badRequest('Elige una modalidad.');
  let r;
  if (input.id) {
    r = await one(`UPDATE class_slots SET class_type_id=$2, weekday=$3, start_time=$4, end_time=$5, capacity=$6, active=$7, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [v.uuid(input.id), typeId, weekday, start, end, capacity, input.active !== false]);
    if (!r) throw notFound('La clase no existe.');
  } else {
    r = await one(`INSERT INTO class_slots (class_type_id, weekday, start_time, end_time, capacity, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [typeId, weekday, start, end, capacity, input.active !== false]);
  }
  await audit(pool, actor, 'clase.horario', { id: r.id, typeId, weekday, start, capacity });
  return slotRow(r);
}

export async function deleteSlot(id: string, actor: string) {
  await tx(async c => {
    const s = await one(`UPDATE class_slots SET deleted_at = now(), active = false WHERE id = $1 RETURNING id`, [v.uuid(id)], c);
    if (!s) throw notFound('La clase no existe.');
    const future = await q(`UPDATE class_bookings SET status = 'cancelada', cancelled_at = now() WHERE class_slot_id = $1 AND session_date >= current_date AND status <> 'cancelada' RETURNING id`, [s.id], c);
    for (const b of future) await cancelPending(c, { classBookingId: b.id }, ['wa.send']);
    await audit(c, actor, 'clase.eliminada', { id: s.id, plazasCanceladas: future.length });
  });
}

export { AppError };
