/* Fechas en la zona horaria del centro. La base de datos guarda instantes UTC;
   la API habla en fecha local (YYYY-MM-DD) y hora local (HH:MM). */
const pad = (n: number) => String(n).padStart(2, '0');

export const tmin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fmt = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 1 = lunes … 7 = domingo */
export function isoWeekday(date: string): number {
  const g = new Date(date + 'T12:00:00Z').getUTCDay();
  return g === 0 ? 7 : g;
}
export const mondayOf = (date: string) => addDays(date, 1 - isoWeekday(date));
export function daysInMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${pad(i + 1)}`);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(d: Date, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}
function offsetMinutes(d: Date, tz: string): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** Fecha y hora locales del centro → instante UTC (tiene en cuenta el cambio de hora). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const o1 = offsetMinutes(new Date(guess), tz);
  let ts = guess - o1 * 60000;
  const o2 = offsetMinutes(new Date(ts), tz);
  if (o2 !== o1) ts = guess - o2 * 60000;
  return new Date(ts);
}

/** Instante UTC → fecha y hora locales del centro. */
export function utcToZoned(d: Date, tz: string) {
  const p = parts(d, tz);
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const minutes = p.hour * 60 + p.minute;
  return { date, time: fmt(minutes), minutes, weekday: isoWeekday(date) };
}

export const nowLocal = (tz: string, now = new Date()) => utcToZoned(now, tz);

const DAYS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** «jueves 22 de octubre» */
export function longDateEs(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${DAYS[isoWeekday(date)]} ${d} de ${MONTHS[m - 1]}`;
}
