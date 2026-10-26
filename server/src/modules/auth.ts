/* Acceso al panel: usuarios, sesiones con cookie HttpOnly y protección CSRF. */
import { config } from '../config.ts';
import { one, pool } from '../db.ts';
import { hashPassword, verifyPassword, randomToken, sha256, safeEqual } from '../lib/crypto.ts';
import { unauthorized, forbidden, badRequest } from '../lib/errors.ts';
import { setCookie, type Ctx } from '../lib/http.ts';
import { rateLimit } from '../lib/ratelimit.ts';

export const COOKIE = 'panel_session';
export type SessionUser = { id: string; email: string; name: string; role: 'admin' | 'staff'; csrf: string };

export async function createUser(email: string, name: string, password: string, role: 'admin' | 'staff' = 'admin') {
  if (password.length < 12) throw badRequest('La contraseña debe tener al menos 12 caracteres.');
  const hash = await hashPassword(password);
  return one(`INSERT INTO admin_users (email, name, password_hash, role) VALUES (lower($1), $2, $3, $4)
              ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, active = true
              RETURNING id, email`, [email, name, hash, role]);
}

export async function login(ctx: Ctx) {
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const password = String(ctx.body.password || '');
  rateLimit(`login:${ctx.ip}`, 10, 15 * 60_000);
  rateLimit(`login:${email}`, 8, 15 * 60_000);
  const u = await one('SELECT * FROM admin_users WHERE email = $1 AND active', [email]);
  // Se verifica siempre una contraseña para no revelar qué correos existen.
  const ok = await verifyPassword(password, u?.password_hash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
  if (!u || !ok) throw unauthorized('Correo o contraseña incorrectos.');
  const token = randomToken(32), csrf = randomToken(24);
  await pool.query(`INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at, ip, user_agent) VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval, $5, $6)`,
    [sha256(token), u.id, csrf, String(config.sessionTtlHours), ctx.ip, String(ctx.req.headers['user-agent'] || '').slice(0, 200)]);
  await pool.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [u.id]);
  setCookie(ctx.res, COOKIE, token, { maxAge: config.sessionTtlHours * 3600 });
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role }, csrf };
}

export async function logout(ctx: Ctx) {
  const t = ctx.cookies[COOKIE];
  if (t) await pool.query('DELETE FROM sessions WHERE id_hash = $1', [sha256(t)]);
  setCookie(ctx.res, COOKIE, '', { maxAge: 0 });
  return { ok: true };
}

export async function currentUser(ctx: Ctx): Promise<SessionUser | null> {
  const t = ctx.cookies[COOKIE];
  if (!t) return null;
  const r = await one(`SELECT u.id, u.email, u.name, u.role, s.csrf_token FROM sessions s JOIN admin_users u ON u.id = s.user_id
                       WHERE s.id_hash = $1 AND s.expires_at > now() AND u.active`, [sha256(t)]);
  return r ? { id: r.id, email: r.email, name: r.name, role: r.role, csrf: r.csrf_token } : null;
}

/** Middleware: exige sesión y, en peticiones que modifican datos, la cabecera X-CSRF-Token. */
export async function requireUser(ctx: Ctx) {
  const u = await currentUser(ctx);
  if (!u) throw unauthorized();
  if (!['GET', 'HEAD'].includes(ctx.method)) {
    const h = String(ctx.req.headers['x-csrf-token'] || '');
    if (!h || !safeEqual(h, u.csrf)) throw forbidden('La sesión ha caducado. Recarga la página.');
  }
  ctx.state.user = u;
}
export function requireAdminRole(ctx: Ctx) {
  if (ctx.state.user?.role !== 'admin') throw forbidden('Solo un administrador puede hacer esto.');
}
export const actorOf = (ctx: Ctx) => `user:${ctx.state.user?.email || 'desconocido'}`;
