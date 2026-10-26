/* Servicios y especialistas. */
import { q, one, tx, audit, type Db, pool } from '../db.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { normalizeSchedule, normalizeVacations, type Schedule, type Vacation } from '../lib/availability.ts';
import * as v from '../lib/validate.ts';

export type Service = { id: string; name: string; short: string; description: string; duration: number; price: number | null; active: boolean; sort: number };
export type Specialist = {
  id: string; name: string; role: string; bio: string; photo: string | null; color: string; active: boolean; slotStep: number;
  schedule: Schedule; vacations: Vacation[]; serviceIds: string[];
  google: { accountId: string | null; accountEmail: string | null; accountStatus: string | null; calendarId: string | null; calendarName: string | null };
};

const svcRow = (r: any): Service => ({ id: r.id, name: r.name, short: r.short, description: r.description, duration: r.duration_min, price: r.price_eur, active: r.active, sort: r.sort });

export async function listServices(db: Db = pool): Promise<Service[]> {
  return (await q('SELECT * FROM services ORDER BY sort, name', [], db)).map(svcRow);
}
export async function getService(id: string, db: Db = pool): Promise<Service | undefined> {
  const r = await one('SELECT * FROM services WHERE id = $1', [id], db);
  return r && svcRow(r);
}

const spSelect = `
  SELECT s.*, ga.email AS google_email, ga.status AS google_status,
         COALESCE((SELECT json_agg(ss.service_id ORDER BY ss.service_id) FROM specialist_services ss WHERE ss.specialist_id = s.id), '[]') AS service_ids
  FROM specialists s LEFT JOIN google_accounts ga ON ga.id = s.google_account_id`;
const spRow = (r: any): Specialist => ({
  id: r.id, name: r.name, role: r.role, bio: r.bio, photo: r.photo_url, color: r.color, active: r.active, slotStep: r.slot_step_min,
  schedule: r.schedule, vacations: r.vacations, serviceIds: r.service_ids,
  google: { accountId: r.google_account_id, accountEmail: r.google_email, accountStatus: r.google_status, calendarId: r.google_calendar_id, calendarName: r.google_calendar_name }
});

export async function listSpecialists(db: Db = pool): Promise<Specialist[]> {
  return (await q(`${spSelect} WHERE s.deleted_at IS NULL ORDER BY s.sort, s.name`, [], db)).map(spRow);
}
export async function getSpecialist(id: string, db: Db = pool): Promise<Specialist | undefined> {
  const r = await one(`${spSelect} WHERE s.id = $1 AND s.deleted_at IS NULL`, [id], db);
  return r && spRow(r);
}
export async function specialistsForService(serviceId: string, db: Db = pool): Promise<Specialist[]> {
  return (await listSpecialists(db)).filter(s => s.active && s.serviceIds.includes(serviceId));
}

const COLORS = ['sage', 'blue', 'sand', 'plum', 'teal', 'rose'];

export async function saveSpecialist(input: any, actor: string): Promise<Specialist> {
  const name = v.str(input.name, 'nombre', { min: 3, max: 120 });
  const schedule = normalizeSchedule(input.schedule);
  if (typeof schedule === 'string') throw badRequest(schedule);
  const vacations = normalizeVacations(input.vacations);
  if (typeof vacations === 'string') throw badRequest(vacations);
  const slotStep = v.int(Number(input.slotStep ?? 30), 'duración de la franja', 5, 240);
  const color = COLORS.includes(input.color) ? input.color : 'sage';
  const photo = typeof input.photo === 'string' && /^(https:\/\/|\/|data:image\/(jpeg|png|webp);base64,)/.test(input.photo) && input.photo.length < 400_000 ? input.photo : null;
  const services = await listServices();
  const serviceIds: string[] = (Array.isArray(input.serviceIds) ? input.serviceIds : []).filter((id: string) => services.some(s => s.id === id));
  const fields = [name, v.str(input.role, 'especialidad', { optional: true, max: 160 }), v.str(input.bio, 'biografía', { optional: true, max: 1200 }), photo, color, input.active !== false, slotStep, JSON.stringify(schedule), JSON.stringify(vacations)];
  const id = await tx(async c => {
    let sid: string;
    if (input.id) {
      const ex = await one('SELECT id FROM specialists WHERE id = $1 AND deleted_at IS NULL', [v.uuid(input.id)], c);
      if (!ex) throw notFound('El especialista no existe.');
      sid = ex.id;
      await c.query(`UPDATE specialists SET name=$2, role=$3, bio=$4, photo_url=$5, color=$6, active=$7, slot_step_min=$8, schedule=$9, vacations=$10, updated_at=now() WHERE id=$1`, [sid, ...fields]);
    } else {
      sid = (await one(`INSERT INTO specialists (name, role, bio, photo_url, color, active, slot_step_min, schedule, vacations) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, fields, c)).id;
    }
    await c.query('DELETE FROM specialist_services WHERE specialist_id = $1', [sid]);
    for (const s of serviceIds) await c.query('INSERT INTO specialist_services (specialist_id, service_id) VALUES ($1, $2)', [sid, s]);
    await audit(c, actor, input.id ? 'especialista.editado' : 'especialista.creado', { id: sid, name });
    return sid;
  });
  return (await getSpecialist(id))!;
}

export async function deleteSpecialist(id: string, actor: string) {
  const sid = v.uuid(id);
  const future = await one<{ n: number }>(`SELECT count(*)::int AS n FROM appointments WHERE specialist_id = $1 AND status IN ('pendiente','confirmada') AND starts_at > now()`, [sid]);
  if (future && future.n > 0) throw conflict(`Tiene ${future.n} citas futuras. Cancélalas o cámbialas de especialista antes de eliminarlo, o desactiva su agenda.`);
  await tx(async c => {
    await c.query('UPDATE specialists SET deleted_at = now(), active = false WHERE id = $1', [sid]);
    await c.query('DELETE FROM specialist_services WHERE specialist_id = $1', [sid]);
    await audit(c, actor, 'especialista.eliminado', { id: sid });
  });
}

export async function saveService(input: any, actor: string): Promise<Service> {
  const name = v.str(input.name, 'nombre', { min: 3, max: 120 });
  const id = input.id ? v.slug(input.id) : name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  if (id.length < 2) throw badRequest('Nombre de servicio no válido.');
  const duration = v.int(Number(input.duration), 'duración', 10, 480);
  const price = input.price === '' || input.price === null || input.price === undefined ? null : Number(input.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) throw badRequest('Precio no válido.');
  await tx(async c => {
    await c.query(
      `INSERT INTO services (id, name, short, description, duration_min, price_eur, active, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE((SELECT max(sort)+1 FROM services), 0))
       ON CONFLICT (id) DO UPDATE SET name=$2, short=$3, description=$4, duration_min=$5, price_eur=$6, active=$7, updated_at=now()`,
      [id, name, v.str(input.short, 'descripción breve', { optional: true, max: 200 }), v.str(input.description, 'descripción', { optional: true, max: 2000 }), duration, price, input.active !== false]
    );
    if (Array.isArray(input.specialistIds)) {
      await c.query('DELETE FROM specialist_services WHERE service_id = $1', [id]);
      for (const sid of input.specialistIds) {
        await c.query('INSERT INTO specialist_services (specialist_id, service_id) SELECT id, $2 FROM specialists WHERE id = $1 AND deleted_at IS NULL', [v.uuid(sid), id]);
      }
    }
    await audit(c, actor, 'servicio.guardado', { id, name });
  });
  return (await getService(id))!;
}
