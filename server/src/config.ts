/* Configuración leída de variables de entorno. Nunca se envía al navegador. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { site } from './site.ts';

// Carga opcional de un fichero .env en desarrollo (en producción las inyecta Docker).
const envFile = resolve(process.cwd(), process.env.ENV_FILE || '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const env = (k: string, def?: string): string => {
  const v = process.env[k];
  if (v === undefined || v === '') {
    if (def !== undefined) return def;
    throw new Error(`Falta la variable de entorno ${k}. Revisa tu fichero .env (ver .env.example).`);
  }
  return v;
};
const bool = (k: string, def: boolean) => {
  const v = process.env[k];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'si', 'sí'].includes(v.toLowerCase());
};
const int = (k: string, def: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : def;
};

const nodeEnv = env('NODE_ENV', 'development');
const publicBaseUrl = env('PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/+$/, '');

export type WhatsAppProvider = 'meta' | 'twilio' | 'log' | 'disabled';
const waProvider = env('WHATSAPP_PROVIDER', 'disabled') as WhatsAppProvider;
if (!['meta', 'twilio', 'log', 'disabled'].includes(waProvider)) throw new Error('WHATSAPP_PROVIDER debe ser meta, twilio, log o disabled');
if (waProvider === 'log' && nodeEnv === 'production') throw new Error('WHATSAPP_PROVIDER=log solo se permite fuera de producción');

const encKey = Buffer.from(env('ENCRYPTION_KEY', nodeEnv === 'production' ? undefined : 'ZGV2LWtleS1zb2xvLXBhcmEtZGVzYXJyb2xsby0zMmI='), 'base64');
if (encKey.length !== 32) throw new Error('ENCRYPTION_KEY debe ser 32 bytes en base64 (genera una con: openssl rand -base64 32)');

const waPrefix = site.whatsapp?.prefijoPlantillas ? site.whatsapp.prefijoPlantillas + '_' : '';

export const config = {
  site: site.slug,
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: int('PORT', 3000),
  publicBaseUrl,
  databaseUrl: env('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/webs'),
  // Esquema propio dentro de la base de datos (permite que varios clientes compartan una misma base de datos)
  databaseSchema: (process.env.DATABASE_SCHEMA || '').replace(/[^a-z0-9_]/g, ''),
  timezone: env('CENTER_TIMEZONE', 'Europe/Madrid'),
  defaultCountryCode: env('DEFAULT_COUNTRY_CODE', '34'),
  encryptionKey: encKey,
  sessionTtlHours: int('SESSION_TTL_HOURS', 12),
  trustProxy: bool('TRUST_PROXY', true),
  serveStatic: bool('SERVE_STATIC', !(nodeEnv === 'production')),
  staticDir: env('STATIC_DIR', resolve(process.cwd(), 'web/dist')),
  logLevel: env('LOG_LEVEL', 'info'),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env('GOOGLE_REDIRECT_URI', `${publicBaseUrl}/api/admin/google/callback`),
    busyFailOpen: bool('GOOGLE_BUSY_FAIL_OPEN', false),
    apiBase: env('GOOGLE_API_BASE', 'https://www.googleapis.com'),
    tokenUrl: env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    authUrl: env('GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    get enabled() { return !!(this.clientId && this.clientSecret); }
  },
  whatsapp: {
    provider: waProvider,
    templateLang: env('WA_TEMPLATE_LANG', 'es'),
    templates: {
      confirmation: env('WA_TPL_CONFIRMATION', `${waPrefix}cita_confirmada`),
      reminder: env('WA_TPL_REMINDER', `${waPrefix}recordatorio_cita`),
      cancelled: env('WA_TPL_CANCELLED', `${waPrefix}cita_cancelada`),
      rescheduled: env('WA_TPL_RESCHEDULED', `${waPrefix}cita_modificada`)
    },
    meta: {
      graphBase: env('META_GRAPH_BASE', 'https://graph.facebook.com'),
      apiVersion: env('META_WA_API_VERSION', 'v21.0'),
      phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID || '',
      accessToken: process.env.META_WA_ACCESS_TOKEN || '',
      appSecret: process.env.META_WA_APP_SECRET || '',
      verifyToken: process.env.META_WA_VERIFY_TOKEN || ''
    },
    twilio: {
      apiBase: env('TWILIO_API_BASE', 'https://api.twilio.com'),
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      from: process.env.TWILIO_WHATSAPP_FROM || '',
      contentSids: {
        confirmation: process.env.TWILIO_CONTENT_SID_CONFIRMATION || '',
        reminder: process.env.TWILIO_CONTENT_SID_REMINDER || '',
        cancelled: process.env.TWILIO_CONTENT_SID_CANCELLED || '',
        rescheduled: process.env.TWILIO_CONTENT_SID_RESCHEDULED || ''
      }
    }
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    apiBase: env('STRIPE_API_BASE', 'https://api.stripe.com'),
    get enabled() { return !!this.secretKey; },
    get testMode() { return this.secretKey.startsWith('sk_test_') || this.secretKey.startsWith('rk_test_'); }
  },
  worker: {
    pollSeconds: int('WORKER_POLL_SECONDS', 15)
  }
};

export function assertProviderConfig(): void {
  const w = config.whatsapp;
  if (w.provider === 'meta' && (!w.meta.phoneNumberId || !w.meta.accessToken || !w.meta.appSecret || !w.meta.verifyToken))
    throw new Error('WhatsApp (Meta): faltan META_WA_PHONE_NUMBER_ID, META_WA_ACCESS_TOKEN, META_WA_APP_SECRET o META_WA_VERIFY_TOKEN');
  if (w.provider === 'twilio' && (!w.twilio.accountSid || !w.twilio.authToken || !w.twilio.from))
    throw new Error('WhatsApp (Twilio): faltan TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_WHATSAPP_FROM');
  if (config.isProd && !config.publicBaseUrl.startsWith('https://')) throw new Error('PUBLIC_BASE_URL debe usar https:// en producción');
}
