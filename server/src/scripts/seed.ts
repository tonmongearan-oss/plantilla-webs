/* Carga inicial a partir de sitios/<SITE>/sitio.json: servicios, clases y su horario, ajustes del centro
   y especialistas de partida (si los hay). Es seguro ejecutarlo varias veces: no duplica ni sobrescribe
   lo que el centro haya cambiado después desde el panel. */
import { pool, tx } from '../db.ts';
import { DEFAULT_SETTINGS } from '../modules/settings.ts';
import { migrate } from '../migrate.ts';
import { site } from '../site.ts';

const addMinutes = (hhmm: string, min: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export async function seed() {
  await tx(async c => {
    for (const [i, s] of (site.servicios || []).entries()) {
      await c.query(`INSERT INTO services (id, name, duration_min, short, description, price_eur, sort) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.nombre, s.duracion, s.breve || '', s.descripcion || '', s.precio ?? null, i]);
    }
    if (site.modulos?.clases && site.clases) {
      const types = site.clases.tipos || [];
      for (const [i, t] of types.entries()) {
        await c.query(`INSERT INTO class_types (id, name, description, published, sort) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
          [t.id, t.nombre, t.descripcion || '', t.publicado !== false, i]);
      }
      const { rows } = await c.query('SELECT count(*)::int AS n FROM class_slots');
      if (rows[0].n === 0) {
        const dur = site.clases.duracionMinutos || 60;
        const defCap = site.reservas?.aforoPorDefecto ?? 12;
        for (const [wd, list] of Object.entries(site.clases.horario || {})) for (const { tipo, hora } of list) {
          const cap = types.find(t => t.id === tipo)?.aforo ?? defCap;
          await c.query(`INSERT INTO class_slots (class_type_id, weekday, start_time, end_time, capacity) VALUES ($1,$2,$3,$4,$5)`, [tipo, Number(wd), hora, addMinutes(hora, dur), cap]);
        }
      }
    }
    for (const [k, val] of Object.entries(DEFAULT_SETTINGS)) {
      await c.query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [k, JSON.stringify(val)]);
    }
    // Especialistas de partida: se crean una sola vez (por nombre). Sin horario si no se indica: el centro lo completa en el panel.
    for (const e of site.especialistas || []) {
      const { rows: ex } = await c.query(`SELECT 1 FROM specialists WHERE name = $1`, [e.nombre]);
      if (ex.length) continue;
      const empty: Record<string, object> = {};
      for (let d = 1; d <= 7; d++) empty[d] = { on: false, blocks: [], breaks: [] };
      const { rows: sp } = await c.query(
        `INSERT INTO specialists (name, role, bio, color, active, slot_step_min, schedule) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [e.nombre, e.cargo || '', e.bio || '', e.color || 'sage', !!e.activo, e.franjaMinutos || 30, JSON.stringify(empty)]);
      for (const svc of e.servicios || []) await c.query(`INSERT INTO specialist_services (specialist_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [sp[0].id, svc]);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
  await seed();
  console.log(`Datos iniciales de «${site.negocio.nombre}» cargados.`);
  await pool.end();
}
