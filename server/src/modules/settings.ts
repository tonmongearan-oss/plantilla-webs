/* Ajustes del centro guardados en la tabla settings. */
import { q, type Db, pool } from '../db.ts';
import { site } from '../site.ts';

export type CenterInfo = { name: string; phone: string; email: string; address: string; city: string; publicHours: string; registry: string };
export type BookingRules = { minNoticeMinutes: number; horizonDays: number; onlineStatus: 'pendiente' | 'confirmada'; cancelMinNoticeHours: number; defaultCapacity: number };
export type ReminderRules = { enabled: boolean; offsetsMinutes: number[]; instructions: string };
export type PaymentRules = { enabled: boolean; depositPercent: number; holdMinutes: number };
export type Settings = { center: CenterInfo; booking: BookingRules; reminders: ReminderRules; payments: PaymentRules };

const n = site.negocio, r = site.reservas || {}, rem = site.recordatorios || {}, pay = (site.modulos && site.modulos.pagos) || {};
export const DEFAULT_SETTINGS: Settings = {
  center: { name: n.nombre, phone: n.telefono, email: n.email, address: n.direccion, city: n.ciudad, publicHours: n.horario, registry: n.registro || '' },
  booking: { minNoticeMinutes: r.antelacionMinutos ?? 120, horizonDays: r.diasVista ?? 60, onlineStatus: r.estadoOnline || 'confirmada', cancelMinNoticeHours: r.cancelarHorasAntes ?? 12, defaultCapacity: r.aforoPorDefecto ?? 12 },
  reminders: { enabled: rem.minutosAntes ? rem.minutosAntes.length > 0 : true, offsetsMinutes: rem.minutosAntes || [1440, 120], instructions: rem.instrucciones || 'Si no puedes venir, cancela o cambia la cita desde el enlace o llámanos.' },
  // Señal online al reservar desde la web (solo si STRIPE_SECRET_KEY está configurada y el servicio tiene precio)
  payments: { enabled: pay.activo !== false, depositPercent: pay.porcentaje ?? 40, holdMinutes: pay.minutosReserva ?? 30 }
};

let cache: { at: number; value: Settings } | null = null;

export async function getSettings(db: Db = pool): Promise<Settings> {
  if (cache && Date.now() - cache.at < 15_000 && db === pool) return cache.value;
  const rows = await q<{ key: keyof Settings; value: any }>('SELECT key, value FROM settings', [], db);
  const s: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of rows) if (r.key in s) Object.assign((s as any)[r.key], r.value);
  if (db === pool) cache = { at: Date.now(), value: s };
  return s;
}

export async function saveSettings(patch: Partial<Settings>, db: Db = pool) {
  for (const k of Object.keys(patch) as (keyof Settings)[]) {
    await db.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [k, JSON.stringify(patch[k])]
    );
  }
  cache = null;
}
export const clearSettingsCache = () => { cache = null; };
