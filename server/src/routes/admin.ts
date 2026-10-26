/* API del panel de gestión. Todas las rutas exigen sesión iniciada. */
import { Router, redirect, HANDLED, type Ctx } from '../lib/http.ts';
import { config } from '../config.ts';
import { q, pool, one, audit } from '../db.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { addDays, nowLocal } from '../lib/time.ts';
import * as v from '../lib/validate.ts';
import { login, logout, currentUser, requireUser, requireAdminRole, actorOf } from '../modules/auth.ts';
import { getSettings, saveSettings } from '../modules/settings.ts';
import * as catalog from '../modules/catalog.ts';
import * as patients from '../modules/patients.ts';
import * as appts from '../modules/appointments.ts';
import * as classes from '../modules/classes.ts';
import * as google from '../modules/google.ts';
import * as wa from '../modules/whatsapp.ts';

export const adminRouter = new Router();
const A = '/api/admin';
const admin = (ctx: Ctx) => requireAdminRole(ctx);

adminRouter.post(`${A}/login`, ctx => login(ctx));
adminRouter.post(`${A}/logout`, ctx => logout(ctx));
adminRouter.get(`${A}/me`, async ctx => {
  const u = await currentUser(ctx);
  return u ? { user: { id: u.id, email: u.email, name: u.name, role: u.role }, csrf: u.csrf } : { user: null };
});

/** Todo lo que necesita el panel, con la misma forma que usa la interfaz. */
adminRouter.get(`${A}/bootstrap`, requireUser, async ctx => {
  const today = nowLocal(config.timezone).date;
  const from = ctx.query.get('from') ? v.date(ctx.query.get('from')) : addDays(today, -90);
  const to = ctx.query.get('to') ? v.date(ctx.query.get('to')) : addDays(today, 150);
  const s = await getSettings();
  const [services, specialists, classTypes, slots, bookings, classBookings, pts, messages, log, accounts] = await Promise.all([
    catalog.listServices(), catalog.listSpecialists(), classes.listTypes(), classes.listSlots(),
    appts.listAppointments(from, to), classes.listClassBookings(from, to), patients.listPatients(),
    q(`SELECT id, name, email, phone, message AS text, created_at, handled_at FROM contact_messages ORDER BY created_at DESC LIMIT 100`),
    q(`SELECT at, actor, action, details FROM audit_log ORDER BY at DESC LIMIT 60`),
    google.listAccounts()
  ]);
  return {
    range: { from, to },
    user: { email: ctx.state.user.email, name: ctx.state.user.name, role: ctx.state.user.role },
    center: s.center,
    settings: { minNoticeMinutes: s.booking.minNoticeMinutes, bookingHorizonDays: s.booking.horizonDays, defaultCapacity: s.booking.defaultCapacity, onlineStatus: s.booking.onlineStatus, cancelMinNoticeHours: s.booking.cancelMinNoticeHours, reminders: s.reminders },
    services, specialists: specialists.map(sp => ({ ...sp, demo: false })),
    classTypes, classTemplates: slots, bookings, classBookings, patients: pts,
    messages: messages.map(m => ({ ...m, createdAt: new Date(m.created_at).toISOString() })),
    log: log.map(l => ({ ts: new Date(l.at).toISOString(), text: describe(l) })),
    integrations: {
      google: { configured: config.google.enabled, accounts },
      whatsapp: { provider: config.whatsapp.provider },
      stripe: { configured: config.stripe.enabled, testMode: config.stripe.testMode, enabled: s.payments.enabled, depositPercent: s.payments.depositPercent }
    }
  };
});

function describe(l: { actor: string; action: string; details: any }) {
  const who = l.actor.startsWith('user:') ? l.actor.slice(5) : l.actor;
  const d = l.details || {};
  const map: Record<string, string> = {
    'cita.creada': `Nueva cita (${d.origen}): ${d.especialista} · ${d.fecha} ${d.hora}`,
    'cita.estado': `Cita ${d.a} (antes ${d.de})`,
    'cita.cambiada': `Cita cambiada a ${d.nueva}`,
    'clase.plaza': `Plaza en clase ${d.fecha} (${d.ocupadas}/${d.aforo})`,
    'clase.plaza_cancelada': 'Plaza de clase liberada',
    'paciente.creado': 'Paciente creado', 'paciente.editado': 'Paciente actualizado', 'paciente.eliminado': 'Paciente eliminado',
    'especialista.creado': `Especialista añadido: ${d.name}`, 'especialista.editado': `Ficha u horario actualizado: ${d.name}`, 'especialista.eliminado': 'Especialista eliminado',
    'servicio.guardado': `Servicio guardado: ${d.name}`, 'clase.horario': 'Horario de clase actualizado', 'clase.eliminada': 'Clase eliminada del horario',
    'ajustes.guardados': 'Configuración guardada', 'google.conectado': `Google Calendar conectado (${d.email})`, 'google.calendario': 'Calendario de especialista actualizado',
    'pago.señal': `Señal pagada online (${d.importe})`, 'pago.devuelto': `Señal devuelta (${d.importe})`, 'cita.sin_pago': 'Reserva web cancelada: no se pagó la señal a tiempo'
  };
  return `${map[l.action] || l.action} · ${who}`;
}

/* ---------- disponibilidad para el panel ---------- */
adminRouter.get(`${A}/availability/day`, requireUser, async ctx => {
  const sp = await catalog.getSpecialist(v.uuid(ctx.query.get('specialistId')));
  const svc = await catalog.getService(v.slug(ctx.query.get('serviceId')));
  if (!sp || !svc) throw notFound();
  const date = v.date(ctx.query.get('date'));
  const [r] = await appts.rangeSlots(sp, svc, date, date, { ignoreNotice: true });
  return { plan: r.plan, slots: r.slots.filter(s => s.status !== 'break').map(s => ({ start: s.start, status: s.status })) };
});

adminRouter.get(`${A}/availability/week`, requireUser, async ctx => {
  const sp = await catalog.getSpecialist(v.uuid(ctx.query.get('specialistId')));
  if (!sp) throw notFound();
  const from = v.date(ctx.query.get('from'));
  const svc = { id: '_franja', name: 'Franja', short: '', description: '', duration: sp.slotStep, price: null, active: true, sort: 0 };
  let days;
  try { days = await appts.rangeSlots(sp, svc, from, addDays(from, 6), { ignoreNotice: true }); }
  catch { days = await appts.rangeSlots(sp, svc, from, addDays(from, 6), { ignoreNotice: true, external: false }); }
  return { days };
});

/* ---------- citas ---------- */
adminRouter.post(`${A}/appointments`, requireUser, async ctx => {
  const r = await appts.createAppointment(ctx.body, actorOf(ctx), { panel: true });
  return r.appointment;
});
adminRouter.post(`${A}/appointments/:id/status`, requireUser, ctx => appts.setStatus(ctx.params.id, ctx.body.status, actorOf(ctx)));
adminRouter.post(`${A}/appointments/:id/reschedule`, requireUser, ctx => appts.reschedule(ctx.params.id, ctx.body.date, ctx.body.start, actorOf(ctx), { panel: true }));
adminRouter.post(`${A}/appointments/:id/refund`, requireUser, admin, async ctx => {
  const id = v.uuid(ctx.params.id);
  const a = await one('SELECT payment_status FROM appointments WHERE id = $1', [id]);
  if (!a) throw badRequest('La cita no existe.');
  if (a.payment_status !== 'paid') throw badRequest('Esta cita no tiene una señal pagada que devolver.');
  const { refund } = await import('../modules/payments.ts');
  await refund(id, `devuelta desde el panel por ${ctx.state.user?.email}`);
  return appts.present(await one('SELECT * FROM appointments WHERE id = $1', [id]));
});

/* ---------- pacientes ---------- */
adminRouter.post(`${A}/patients`, requireUser, ctx => patients.savePatient({ ...ctx.body, id: undefined }, actorOf(ctx)));
adminRouter.put(`${A}/patients/:id`, requireUser, ctx => patients.savePatient({ ...ctx.body, id: ctx.params.id }, actorOf(ctx)));
adminRouter.delete(`${A}/patients/:id`, requireUser, admin, async ctx => { await patients.deletePatient(ctx.params.id, actorOf(ctx)); return { ok: true }; });

/* ---------- especialistas y servicios ---------- */
adminRouter.post(`${A}/specialists`, requireUser, admin, ctx => catalog.saveSpecialist({ ...ctx.body, id: undefined }, actorOf(ctx)));
adminRouter.put(`${A}/specialists/:id`, requireUser, admin, ctx => catalog.saveSpecialist({ ...ctx.body, id: ctx.params.id }, actorOf(ctx)));
adminRouter.delete(`${A}/specialists/:id`, requireUser, admin, async ctx => { await catalog.deleteSpecialist(ctx.params.id, actorOf(ctx)); return { ok: true }; });
adminRouter.put(`${A}/specialists/:id/calendar`, requireUser, admin, async ctx => {
  const id = v.uuid(ctx.params.id);
  const b = ctx.body;
  if (b.calendarId) {
    const acc = await one('SELECT id FROM google_accounts WHERE id = $1', [v.uuid(b.accountId, 'cuenta')]);
    if (!acc) throw badRequest('La cuenta de Google no está conectada.');
    await pool.query(`UPDATE specialists SET google_account_id = $2, google_calendar_id = $3, google_calendar_name = $4, updated_at = now() WHERE id = $1`,
      [id, acc.id, v.str(b.calendarId, 'calendario', { max: 300 }), v.str(b.calendarName, 'nombre del calendario', { optional: true, max: 200 })]);
  } else {
    await pool.query(`UPDATE specialists SET google_account_id = NULL, google_calendar_id = NULL, google_calendar_name = NULL, updated_at = now() WHERE id = $1`, [id]);
  }
  // Las citas futuras se vuelven a sincronizar con el calendario nuevo.
  const { enqueue } = await import('../modules/jobs.ts');
  const future = await q(`SELECT id FROM appointments WHERE specialist_id = $1 AND starts_at > now() AND status <> 'cancelada'`, [id]);
  for (const a of future) await enqueue(pool, { type: 'gcal.upsert', payload: { appointmentId: a.id }, appointmentId: a.id });
  await audit(pool, actorOf(ctx), 'google.calendario', { id, calendarId: b.calendarId || null, citasResincronizadas: future.length });
  return catalog.getSpecialist(id);
});
adminRouter.put(`${A}/services/:id`, requireUser, admin, ctx => catalog.saveService({ ...ctx.body, id: ctx.params.id === 'nuevo' ? undefined : ctx.params.id }, actorOf(ctx)));

/* ---------- clases ---------- */
adminRouter.post(`${A}/class-slots`, requireUser, admin, ctx => classes.saveSlot({ ...ctx.body, id: undefined }, actorOf(ctx)));
adminRouter.put(`${A}/class-slots/:id`, requireUser, admin, ctx => classes.saveSlot({ ...ctx.body, id: ctx.params.id }, actorOf(ctx)));
adminRouter.delete(`${A}/class-slots/:id`, requireUser, admin, async ctx => { await classes.deleteSlot(ctx.params.id, actorOf(ctx)); return { ok: true }; });
adminRouter.post(`${A}/class-bookings`, requireUser, async ctx => (await classes.bookClass(ctx.body, actorOf(ctx), { panel: true })).booking);
adminRouter.post(`${A}/class-bookings/:id/cancel`, requireUser, async ctx => { await classes.cancelClassBooking(ctx.params.id, actorOf(ctx)); return { ok: true }; });

/* ---------- configuración ---------- */
adminRouter.put(`${A}/settings`, requireUser, admin, async ctx => {
  const b = ctx.body || {};
  const cur = await getSettings();
  const center = b.center ? {
    ...cur.center,
    phone: v.str(b.center.phone ?? cur.center.phone, 'teléfono', { max: 40 }),
    email: v.email(b.center.email ?? cur.center.email),
    address: v.str(b.center.address ?? cur.center.address, 'dirección', { max: 200 }),
    city: v.str(b.center.city ?? cur.center.city, 'población', { max: 200 }),
    publicHours: v.str(b.center.publicHours ?? cur.center.publicHours, 'horario', { max: 200 })
  } : cur.center;
  const s = b.settings || {};
  const booking = {
    ...cur.booking,
    minNoticeMinutes: s.minNoticeMinutes !== undefined ? v.int(Number(s.minNoticeMinutes), 'antelación mínima', 0, 7 * 24 * 60) : cur.booking.minNoticeMinutes,
    horizonDays: s.bookingHorizonDays !== undefined ? v.int(Number(s.bookingHorizonDays), 'días de reserva', 7, 180) : cur.booking.horizonDays,
    defaultCapacity: s.defaultCapacity !== undefined ? v.int(Number(s.defaultCapacity), 'aforo por defecto', 1, 100) : cur.booking.defaultCapacity,
    onlineStatus: s.onlineStatus === 'pendiente' ? 'pendiente' as const : s.onlineStatus === 'confirmada' ? 'confirmada' as const : cur.booking.onlineStatus,
    cancelMinNoticeHours: s.cancelMinNoticeHours !== undefined ? v.int(Number(s.cancelMinNoticeHours), 'horas para cancelar', 0, 168) : cur.booking.cancelMinNoticeHours
  };
  const r = s.reminders || {};
  const offsets = Array.isArray(r.offsetsMinutes) ? r.offsetsMinutes.map(Number).filter((n: number) => Number.isInteger(n) && n >= 30 && n <= 7 * 24 * 60).slice(0, 3) : cur.reminders.offsetsMinutes;
  const reminders = {
    enabled: r.enabled !== undefined ? !!r.enabled : cur.reminders.enabled,
    offsetsMinutes: offsets,
    instructions: r.instructions !== undefined ? v.str(r.instructions, 'instrucciones', { optional: true, max: 300 }) : cur.reminders.instructions
  };
  await saveSettings({ center, booking, reminders });
  await audit(pool, actorOf(ctx), 'ajustes.guardados', {});
  return getSettings();
});

adminRouter.post(`${A}/messages/:id/handled`, requireUser, async ctx => {
  await pool.query('UPDATE contact_messages SET handled_at = now() WHERE id = $1', [v.uuid(ctx.params.id)]);
  return { ok: true };
});

/* ---------- Google Calendar ---------- */
adminRouter.get(`${A}/google/connect`, requireUser, admin, async ctx => {
  const sp = ctx.query.get('specialistId');
  return { url: await google.createAuthUrl(ctx.state.user.id, sp ? v.uuid(sp) : null) };
});
adminRouter.get(`${A}/google/callback`, requireUser, async ctx => {
  const err = ctx.query.get('error');
  if (err) { redirect(ctx.res, `/admin/?google=cancelado`); return HANDLED; }
  try {
    const r = await google.handleCallback(String(ctx.query.get('code')), String(ctx.query.get('state')), ctx.state.user.id);
    redirect(ctx.res, `/admin/?google=ok&account=${encodeURIComponent(r.accountId)}${r.specialistId ? `&specialist=${r.specialistId}` : ''}`);
  } catch (e) {
    redirect(ctx.res, `/admin/?google=error&msg=${encodeURIComponent((e as Error).message)}`);
  }
  return HANDLED;
});
adminRouter.get(`${A}/google/accounts/:id/calendars`, requireUser, admin, async ctx => ({ calendars: await google.listCalendars(v.uuid(ctx.params.id)) }));

/* ---------- WhatsApp ---------- */
adminRouter.get(`${A}/notifications`, requireUser, async () => {
  const failed = await q(`SELECT id, type, payload, attempts, last_error, run_at, status FROM jobs WHERE status = 'failed' OR (status = 'pending' AND attempts > 0) ORDER BY id DESC LIMIT 30`);
  const pending = await q(`SELECT type, count(*)::int AS n FROM jobs WHERE status = 'pending' GROUP BY type`);
  return { notifications: await wa.lastNotifications(60), failedJobs: failed, pending };
});
adminRouter.post(`${A}/whatsapp/test`, requireUser, admin, async ctx => {
  const to = v.phone(ctx.body.phone);
  const s = await getSettings();
  const r = await wa.sendTemplate({ template: 'reminder', to, vars: { nombre: 'Prueba', servicio: 'Fisioterapia', fecha: 'lunes 1 de enero', hora: '10:00', instrucciones: s.reminders.instructions }, manageToken: 'prueba' });
  if (!r) throw badRequest('WhatsApp está desactivado (WHATSAPP_PROVIDER=disabled).');
  return r;
});
