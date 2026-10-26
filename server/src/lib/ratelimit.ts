/* Límite de peticiones en memoria por clave (IP + ruta). Suficiente para un único servidor. */
import { AppError } from './errors.ts';

const buckets = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

const FACTOR = Number(process.env.RATE_LIMIT_FACTOR || 1);

export function rateLimit(key: string, max: number, windowMs: number): void {
  max = max * FACTOR;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return; }
  b.count += 1;
  if (b.count > max) throw new AppError(429, 'rate_limited', 'Demasiados intentos. Espera unos minutos y vuelve a probar.');
}
export const resetRateLimits = () => buckets.clear();
