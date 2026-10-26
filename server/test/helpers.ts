/* Utilidades de prueba: base de datos limpia, servidores simulados de Google y WhatsApp,
   y un cliente HTTP con sesión para el panel.
   Las pruebas usan TEST_DATABASE_URL (una base de datos SOLO para pruebas: se borra entera). */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const PORTS = { api: 49180, google: 49181, meta: 49182, twilio: 49183, stripe: 49184 };
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) throw new Error('Define TEST_DATABASE_URL apuntando a una base de datos de pruebas (se borrará). Ver docs/PRUEBAS.md');
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DB,
  ENV_FILE: '/dev/null',
  LOG_SILENT: '1',
  PUBLIC_BASE_URL: `http://127.0.0.1:${PORTS.api}`,
  SERVE_STATIC: 'false',
  CENTER_TIMEZONE: 'Europe/Madrid',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_API_BASE: `http://127.0.0.1:${PORTS.google}`,
  GOOGLE_TOKEN_URL: `http://127.0.0.1:${PORTS.google}/token`,
  GOOGLE_AUTH_URL: `http://127.0.0.1:${PORTS.google}/auth`,
  WHATSAPP_PROVIDER: 'meta',
  META_GRAPH_BASE: `http://127.0.0.1:${PORTS.meta}`,
  META_WA_PHONE_NUMBER_ID: '1234567890',
  META_WA_ACCESS_TOKEN: 'meta-test-token',
  META_WA_APP_SECRET: 'meta-app-secret',
  META_WA_VERIFY_TOKEN: 'verify-me',
  TWILIO_API_BASE: `http://127.0.0.1:${PORTS.twilio}`,
  TWILIO_ACCOUNT_SID: 'ACtest',
  TWILIO_AUTH_TOKEN: 'twilio-secret',
  TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886',
  TWILIO_CONTENT_SID_CONFIRMATION: 'HXconf', TWILIO_CONTENT_SID_REMINDER: 'HXrem', TWILIO_CONTENT_SID_CANCELLED: 'HXcan', TWILIO_CONTENT_SID_RESCHEDULED: 'HXres',
  TWILIO_STATUS_CALLBACK: 'off',
  STRIPE_SECRET_KEY: 'sk_test_pruebas',
  STRIPE_API_BASE: `http://127.0.0.1:${PORTS.stripe}`,
  RATE_LIMIT_FACTOR: '100'
});

const { pool } = await import('../src/db.ts');
const { migrate } = await import('../src/migrate.ts');
const { seed } = await import('../src/scripts/seed.ts');
const { buildServer } = await import('../src/server.ts');
const { clearSettingsCache } = await import('../src/modules/settings.ts');
const { resetRateLimits } = await import('../src/lib/ratelimit.ts');
const { clearBusyCache } = await import('../src/modules/google.ts');
const { addDays, mondayOf, nowLocal } = await import('../src/lib/time.ts');
export { pool };

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await seed();
  clearSettingsCache();
  resetRateLimits();
  clearBusyCache();
}

/* ---------- servidor de la API ---------- */
let api: ReturnType<typeof buildServer> | null = null;
export async function startApi() {
  if (api) return;
  api = buildServer();
  await new Promise<void>(r => api!.listen(PORTS.api, '127.0.0.1', () => r()));
}
export async function stopAll() {
  for (const s of [api, ...Object.values(stubs).map(x => x.server)]) if (s) await new Promise(r => s.close(() => r(null)));
  api = null;
  await pool.end();
}

/* ---------- servidores simulados ---------- */
export type Recorded = { method: string; path: string; headers: IncomingMessage['headers']; body: string; json?: any };
type StubHandler = (r: Recorded, res: ServerResponse) => boolean | void;
type Stub = { server: ReturnType<typeof createServer>; calls: Recorded[]; handlers: StubHandler[] };
const stubs: Record<string, Stub> = {};

export async function stub(name: 'google' | 'meta' | 'twilio' | 'stripe', fallback: StubHandler): Promise<Stub> {
  if (stubs[name]) { stubs[name].calls.length = 0; stubs[name].handlers = [fallback]; return stubs[name]; }
  const st: Stub = { server: null as any, calls: [], handlers: [fallback] };
  st.server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const rec: Recorded = { method: req.method!, path: req.url!, headers: req.headers, body };
    try { rec.json = JSON.parse(body); } catch { /* formulario */ }
    st.calls.push(rec);
    for (const h of [...st.handlers].reverse()) if (h(rec, res) !== false && res.writableEnded) return;
    if (!res.writableEnded) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); }
  });
  await new Promise<void>(r => st.server.listen(PORTS[name], '127.0.0.1', () => r()));
  stubs[name] = st;
  return st;
}
export const reply = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

/* ---------- peticiones ---------- */
export const base = `http://127.0.0.1:${PORTS.api}`;
export async function http(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; jar?: Jar } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.jar?.cookie) headers.cookie = opts.jar.cookie;
  if (opts.jar?.csrf) headers['x-csrf-token'] = opts.jar.csrf;
  const r = await fetch(base + path, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opts.jar) opts.jar.cookie = sc.split(';')[0];
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, headers: r.headers };
}
export type Jar = { cookie?: string; csrf?: string };

export async function adminSession(email = 'admin@postural.test', role: 'admin' | 'staff' = 'admin'): Promise<Jar> {
  const { createUser } = await import('../src/modules/auth.ts');
  await createUser(email, 'Admin Pruebas', 'contraseña-larga-de-prueba', role);
  const jar: Jar = {};
  const r = await http('/api/admin/login', { body: { email, password: 'contraseña-larga-de-prueba' }, jar });
  if (r.status !== 200) throw new Error('login falló: ' + JSON.stringify(r.json));
  jar.csrf = r.json.csrf;
  return jar;
}

/* ---------- datos ---------- */
export const WEEK: Record<string, { on: boolean; blocks: { s: string; e: string }[]; breaks: { s: string; e: string }[] }> = {};
for (let d = 1; d <= 7; d++) WEEK[d] = { on: d <= 5, blocks: [{ s: '09:00', e: '13:00' }], breaks: [{ s: '11:00', e: '11:30' }] };

export async function makeSpecialist(name: string, opts: { schedule?: any; serviceIds?: string[]; slotStep?: number } = {}) {
  const { saveSpecialist } = await import('../src/modules/catalog.ts');
  return saveSpecialist({ name, role: 'Fisioterapeuta', schedule: opts.schedule || WEEK, serviceIds: opts.serviceIds || ['fisio', 'valoracion'], slotStep: opts.slotStep || 30 }, 'test');
}

/** Un día laborable (lunes) a dos semanas vista, para no depender de la hora a la que se ejecuten las pruebas. */
export function futureMonday(weeks = 2): string {
  return addDays(mondayOf(nowLocal('Europe/Madrid').date), 7 * weeks);
}

export const patient = (n = 1, extra: Record<string, unknown> = {}) => ({
  name: `Paciente Prueba${n} Apellido`, phone: `600 000 ${String(100 + n).padStart(3, '0')}`, email: `p${n}@ejemplo.com`, whatsappOptIn: true, privacyAccepted: true, ...extra
});

export async function runWorker() {
  const { tick } = await import('../src/worker.ts');
  let total = 0, n;
  do { n = await tick(50); total += n; } while (n > 0);
  return total;
}
export async function dueNow(where = '') {
  await pool.query(`UPDATE jobs SET run_at = now() WHERE status = 'pending' ${where}`);
}
