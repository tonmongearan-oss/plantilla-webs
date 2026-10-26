/* API pública: la usa la web para mostrar disponibilidad y crear reservas. */
import { Router, type Ctx } from '../lib/http.ts';
import { pool } from '../db.ts';
import { config } from '../config.ts';
import { site } from '../site.ts';
import { badRequest } from '../lib/errors.ts';
import { rateLimit } from '../lib/ratelimit.ts';
import { nowLocal, mondayOf, addDays } from '../lib/time.ts';
import * as v from '../lib/validate.ts';
import { getSettings } from '../modules/settings.ts';
import { listServices, listSpecialists } from '../modules/catalog.ts';
import { listTypes, sessions, bookClass } from '../modules/classes.ts';
import * as appts from '../modules/appointments.ts';

export const publicRouter = new Router();

const honeypot = (ctx: Ctx) => { if (ctx.body && ctx.body.website) throw badRequest('Solicitud no válida.'); };
const manageUrl = (token: string) => `${config.publicBaseUrl}/cita.html?t=${encodeURIComponent(token)}`;

publicRouter.get('/api/health', async () => {
  await pool.query('SELECT 1');
  return { ok: true, time: new Date().toISOString() };
});

publicRouter.get('/api/public/config', async () => {
  const s = await getSettings();
  const services = (await listServices()).filter(x => x.active);
  const specialists = (await listSpecialists()).filter(x => x.active).map(sp => ({
    id: sp.id, name: sp.name, role: sp.role, bio: sp.bio, photo: sp.photo, color: sp.color, serviceIds: sp.serviceIds.filter(id => services.some(x => x.id === id))
  }));
  return {
    center: s.center,
    booking: { minNoticeMinutes: s.booking.minNoticeMinutes, horizonDays: s.booking.horizonDays, cancelMinNoticeHours: s.booking.cancelMinNoticeHours },
    services, specialists, classTypes: site.modulos?.clases ? await listTypes() : [],
    whatsappEnabled: config.whatsapp.provider !== 'disabled',
    payments: config.stripe.enabled && s.payments.enabled ? { enabled: true, depositPercent: s.payments.depositPercent, holdMinutes: s.payments.holdMinutes, testMode: config.stripe.testMode } : { enabled: false },
    today: nowLocal(config.timezone).date
  };
});

async function excludeFrom(ctx: Ctx) {
  const t = ctx.query.get('exclude');
  return t ? appts.appointmentIdFromToken(t) : undefined;
}

publicRouter.get('/api/public/availability/month', async ctx => {
  rateLimit(`avail:${ctx.ip}`, 240, 60_000);
  return { days: await appts.monthStatus(String(ctx.query.get('specialistId')), String(ctx.query.get('serviceId')), String(ctx.query.get('month')), await excludeFrom(ctx)) };
});

publicRouter.get('/api/public/availability/day', async ctx => {
  rateLimit(`avail:${ctx.ip}`, 240, 60_000);
  return appts.daySlotsFor(String(ctx.query.get('specialistId')), String(ctx.query.get('serviceId')), String(ctx.query.get('date')), await excludeFrom(ctx));
});

publicRouter.get('/api/public/availability/next', async ctx => {
  rateLimit(`avail:${ctx.ip}`, 240, 60_000);
  const ids = ctx.query.get('specialistIds');
  const limit = Math.min(12, Math.max(1, Number(ctx.query.get('limit') || 6)));
  return { slots: await appts.nextAvailable(String(ctx.query.get('serviceId')), ids ? ids.split(',').filter(Boolean) : null, limit) };
});

publicRouter.post('/api/public/appointments', async ctx => {
  honeypot(ctx);
  rateLimit(`book:${ctx.ip}`, 8, 10 * 60_000);
  const r = await appts.createAppointment(ctx.body, 'web', { panel: false });
  return { appointment: r.appointment, manageUrl: manageUrl(r.manageToken), checkoutUrl: (r as { checkoutUrl?: string }).checkoutUrl || null };
});

publicRouter.get('/api/public/classes', async ctx => {
  const today = nowLocal(config.timezone).date;
  const from = ctx.query.get('from') ? v.date(ctx.query.get('from')) : mondayOf(today);
  if (from < addDays(today, -7) || from > addDays(today, 120)) throw badRequest('Fecha fuera de rango.');
  const days = Math.min(14, Math.max(1, Number(ctx.query.get('days') || 7)));
  return { sessions: await sessions(from, days) };
});

publicRouter.post('/api/public/class-bookings', async ctx => {
  honeypot(ctx);
  rateLimit(`book:${ctx.ip}`, 8, 10 * 60_000);
  const r = await bookClass(ctx.body, 'web', { panel: false });
  return { booking: r.booking, taken: r.taken, capacity: r.capacity, manageUrl: manageUrl(r.manageToken) };
});

publicRouter.post('/api/public/contact', async ctx => {
  honeypot(ctx);
  rateLimit(`contact:${ctx.ip}`, 5, 10 * 60_000);
  const b = ctx.body;
  if (!v.bool(b.privacyAccepted)) throw badRequest('Debes aceptar la política de privacidad.', { field: 'privacy' });
  const name = v.str(b.name, 'nombre', { min: 2, max: 120 });
  const email = v.email(b.email);
  const phone = b.phone ? v.phone(b.phone) : null;
  const text = v.str(b.text, 'mensaje', { min: 10, max: 3000 });
  await pool.query('INSERT INTO contact_messages (name, email, phone, message) VALUES ($1,$2,$3,$4)', [name, email, phone, text]);
  return { ok: true };
});

/* Gestión de la cita por el paciente con el enlace recibido */
publicRouter.get('/api/public/manage/:token', async ctx => {
  rateLimit(`manage:${ctx.ip}`, 60, 10 * 60_000);
  return appts.publicSummary(ctx.params.token);
});
publicRouter.post('/api/public/manage/:token/cancel', async ctx => {
  rateLimit(`manage:${ctx.ip}`, 20, 10 * 60_000);
  return appts.cancelByToken(ctx.params.token);
});
publicRouter.post('/api/public/manage/:token/payment', async ctx => {
  rateLimit(`manage:${ctx.ip}`, 60, 10 * 60_000);
  return appts.paymentReturn(ctx.params.token);
});
publicRouter.post('/api/public/manage/:token/reschedule', async ctx => {
  rateLimit(`manage:${ctx.ip}`, 20, 10 * 60_000);
  return appts.rescheduleByToken(ctx.params.token, ctx.body.date, ctx.body.start);
});
