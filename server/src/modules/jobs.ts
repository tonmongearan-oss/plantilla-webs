/* Cola de tareas en PostgreSQL. El proceso worker las ejecuta aunque nadie tenga la web abierta. */
import { q, type Db, pool } from '../db.ts';

export type JobType = 'gcal.upsert' | 'gcal.delete' | 'wa.send' | 'maintenance.retention' | 'pay.expire' | 'pay.refund';
export type Job = { id: number; type: JobType; payload: any; attempts: number; max_attempts: number; appointment_id: string | null; class_booking_id: string | null; run_at: Date };

export async function enqueue(db: Db, job: { type: JobType; payload?: object; runAt?: Date; dedupeKey?: string; appointmentId?: string; classBookingId?: string; maxAttempts?: number }) {
  await db.query(
    `INSERT INTO jobs (type, payload, run_at, dedupe_key, appointment_id, class_booking_id, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (dedupe_key) DO NOTHING`,
    [job.type, JSON.stringify(job.payload || {}), (job.runAt || new Date()).toISOString(), job.dedupeKey || null, job.appointmentId || null, job.classBookingId || null, job.maxAttempts || 8]
  );
}

/** Cancela las tareas pendientes de una cita (por ejemplo, recordatorios de una hora que ya no vale). */
export async function cancelPending(db: Db, where: { appointmentId?: string; classBookingId?: string }, types: JobType[], filter?: (payload: any) => boolean) {
  const rows = await q<{ id: number; payload: any }>(
    `SELECT id, payload FROM jobs WHERE status = 'pending' AND type = ANY($1::text[]) AND (appointment_id = $2 OR class_booking_id = $3)`,
    [types, where.appointmentId || null, where.classBookingId || null], db);
  const ids = rows.filter(r => !filter || filter(r.payload)).map(r => r.id);
  if (ids.length) await db.query(`UPDATE jobs SET status = 'cancelled', done_at = now(), dedupe_key = NULL WHERE id = ANY($1::bigint[])`, [ids]);
  return ids.length;
}

export async function claim(limit = 10): Promise<Job[]> {
  await pool.query(`UPDATE jobs SET status = 'pending', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`);
  return q<Job>(
    `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
     WHERE id IN (SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now() ORDER BY run_at, id LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`, [limit]);
}
export async function complete(id: number, result = 'ok') {
  await pool.query(`UPDATE jobs SET status = 'done', done_at = now(), result = $2, last_error = NULL WHERE id = $1`, [id, result]);
}
export async function fail(job: Job, err: Error & { retryable?: boolean }) {
  const retry = err.retryable !== false && job.attempts < job.max_attempts;
  const delayMin = Math.min(360, 2 ** job.attempts);
  await pool.query(
    `UPDATE jobs SET status = $2, last_error = $3, run_at = CASE WHEN $2 = 'pending' THEN now() + ($4 || ' minutes')::interval ELSE run_at END,
       done_at = CASE WHEN $2 = 'failed' THEN now() END
     WHERE id = $1`, [job.id, retry ? 'pending' : 'failed', String(err.message).slice(0, 1000), String(delayMin)]);
  return retry;
}
