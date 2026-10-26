/* Pacientes: solo datos de contacto necesarios para gestionar citas. */
import { q, one, audit, type Db, pool } from '../db.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import * as v from '../lib/validate.ts';

export type Patient = { id: string; name: string; phone: string; email: string; whatsappOptIn: boolean; whatsappOptOutAt: string | null; createdAt: string };
export const patientRow = (r: any): Patient => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, whatsappOptIn: r.whatsapp_opt_in, whatsappOptOutAt: r.whatsapp_opt_out_at, createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at });

export type PatientInput = { name: unknown; phone: unknown; email: unknown; whatsappOptIn?: unknown; privacyAccepted?: unknown };

/** Busca al paciente por teléfono y nombre; si no existe lo crea. Actualiza el consentimiento de WhatsApp. */
export async function findOrCreatePatient(input: PatientInput, db: Db, opts: { requirePrivacy: boolean }): Promise<Patient> {
  const name = v.personName(input.name);
  const phone = v.phone(input.phone);
  const email = v.email(input.email);
  if (opts.requirePrivacy && !v.bool(input.privacyAccepted)) throw badRequest('Debes aceptar la política de privacidad para reservar.', { field: 'privacy' });
  const optIn = v.bool(input.whatsappOptIn);
  let p = await one(`SELECT * FROM patients WHERE phone = $1 AND lower(name) = lower($2) ORDER BY created_at LIMIT 1`, [phone, name], db);
  if (!p) {
    p = await one(
      `INSERT INTO patients (name, phone, email, whatsapp_opt_in, whatsapp_opt_in_at, privacy_accepted_at)
       VALUES ($1,$2,$3,$4, CASE WHEN $4 THEN now() END, CASE WHEN $5 THEN now() END) RETURNING *`,
      [name, phone, email, optIn, opts.requirePrivacy], db);
  } else {
    p = await one(
      `UPDATE patients SET email = $2,
         whatsapp_opt_in = CASE WHEN $3 THEN true ELSE whatsapp_opt_in END,
         whatsapp_opt_in_at = CASE WHEN $3 AND NOT whatsapp_opt_in THEN now() ELSE whatsapp_opt_in_at END,
         whatsapp_opt_out_at = CASE WHEN $3 THEN NULL ELSE whatsapp_opt_out_at END,
         privacy_accepted_at = COALESCE(privacy_accepted_at, CASE WHEN $4 THEN now() END),
         updated_at = now()
       WHERE id = $1 RETURNING *`, [p.id, email, optIn, opts.requirePrivacy], db);
  }
  return patientRow(p);
}

export async function listPatients(db: Db = pool): Promise<Patient[]> {
  return (await q('SELECT * FROM patients ORDER BY name', [], db)).map(patientRow);
}

export async function savePatient(input: any, actor: string): Promise<Patient> {
  const name = v.personName(input.name), phone = v.phone(input.phone), email = v.email(input.email);
  const optIn = v.bool(input.whatsappOptIn);
  let r;
  if (input.id) {
    r = await one(`UPDATE patients SET name=$2, phone=$3, email=$4,
        whatsapp_opt_in=$5, whatsapp_opt_in_at = CASE WHEN $5 AND NOT whatsapp_opt_in THEN now() ELSE whatsapp_opt_in_at END,
        whatsapp_opt_out_at = CASE WHEN NOT $5 AND whatsapp_opt_in THEN now() ELSE whatsapp_opt_out_at END, updated_at=now()
      WHERE id=$1 RETURNING *`, [v.uuid(input.id), name, phone, email, optIn]);
    if (!r) throw notFound('El paciente no existe.');
  } else {
    r = await one(`INSERT INTO patients (name, phone, email, whatsapp_opt_in, whatsapp_opt_in_at) VALUES ($1,$2,$3,$4, CASE WHEN $4 THEN now() END) RETURNING *`, [name, phone, email, optIn]);
  }
  await audit(pool, actor, input.id ? 'paciente.editado' : 'paciente.creado', { id: r.id });
  return patientRow(r);
}

/** Registra la baja de WhatsApp de todos los pacientes con ese teléfono. */
export async function optOutByPhone(phoneE164: string, db: Db = pool): Promise<number> {
  const r = await db.query(`UPDATE patients SET whatsapp_opt_in = false, whatsapp_opt_out_at = now(), updated_at = now() WHERE phone = $1 AND whatsapp_opt_in`, [phoneE164]);
  return r.rowCount || 0;
}

/** Borra al paciente y sus reservas (derecho de supresión). Los eventos de Google se borran en segundo plano. */
export async function deletePatient(id: string, actor: string) {
  const { tx } = await import('../db.ts');
  const { enqueue } = await import('./jobs.ts');
  await tx(async c => {
    const pid = v.uuid(id);
    const evs = await q(`SELECT google_account_id, google_calendar_id, google_event_id FROM appointments WHERE patient_id = $1 AND google_event_id IS NOT NULL`, [pid], c);
    for (const e of evs) await enqueue(c, { type: 'gcal.delete', payload: { accountId: e.google_account_id, calendarId: e.google_calendar_id, eventId: e.google_event_id } });
    const r = await c.query('DELETE FROM patients WHERE id = $1', [pid]);
    if (!r.rowCount) throw notFound('El paciente no existe.');
    await audit(c, actor, 'paciente.eliminado', { id: pid, eventosGoogle: evs.length });
  });
}
