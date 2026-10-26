/* Integración con Google Calendar (API REST oficial v3 + OAuth 2.0).
   - Cada especialista se vincula a un calendario de una cuenta de Google autorizada.
   - Las citas se crean, actualizan y borran como eventos en ese calendario.
   - Los eventos que el especialista tenga en su calendario bloquean la disponibilidad. */
import { config } from '../config.ts';
import { one, q, pool, audit } from '../db.ts';
import { encrypt, decrypt, randomToken } from '../lib/crypto.ts';
import { AppError, RetryableError, badRequest, unavailable } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import { zonedToUtc } from '../lib/time.ts';

export const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];

function requireEnabled() {
  if (!config.google.enabled) throw new AppError(400, 'google_not_configured', 'Google Calendar no está configurado: añade GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el fichero .env.');
}

/* ---------- OAuth ---------- */
export async function createAuthUrl(userId: string, specialistId: string | null): Promise<string> {
  requireEnabled();
  const state = randomToken(24);
  await pool.query(`INSERT INTO oauth_states (state, specialist_id, user_id, expires_at) VALUES ($1, $2, $3, now() + interval '15 minutes')`, [state, specialistId, userId]);
  const p = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });
  return `${config.google.authUrl}?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(config.google.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...body }),
    signal: AbortSignal.timeout(10_000)
  });
  const data: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try { return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')).email || null; } catch { return null; }
}

/** Callback de OAuth: guarda (cifrado) el refresh token y vincula la cuenta al especialista. */
export async function handleCallback(code: string, state: string, userId: string) {
  requireEnabled();
  const st = await one(`DELETE FROM oauth_states WHERE state = $1 AND user_id = $2 AND expires_at > now() RETURNING specialist_id`, [state, userId]);
  if (!st) throw badRequest('El enlace de autorización ha caducado. Vuelve a pulsar «Conectar con Google».');
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.google.redirectUri });
  if (!t.ok || !t.data.access_token) throw badRequest('Google no ha aceptado la autorización: ' + (t.data.error_description || t.data.error || t.status));
  const email = emailFromIdToken(t.data.id_token);
  if (!email) throw badRequest('No se ha podido identificar la cuenta de Google.');
  let acc = await one('SELECT id, refresh_token_enc FROM google_accounts WHERE email = $1', [email]);
  if (!t.data.refresh_token && !acc) throw badRequest('Google no ha devuelto permiso sin conexión. Revoca el acceso de la app en tu cuenta de Google y vuelve a conectar.');
  if (acc) {
    await pool.query(`UPDATE google_accounts SET refresh_token_enc = COALESCE($2, refresh_token_enc), scopes = $3, status = 'ok', last_error = NULL, updated_at = now() WHERE id = $1`,
      [acc.id, t.data.refresh_token ? encrypt(t.data.refresh_token) : null, t.data.scope || '']);
  } else {
    acc = await one(`INSERT INTO google_accounts (email, refresh_token_enc, scopes) VALUES ($1, $2, $3) RETURNING id`, [email, encrypt(t.data.refresh_token), t.data.scope || '']);
  }
  tokenCache.set(acc.id, { token: t.data.access_token, exp: Date.now() + (Number(t.data.expires_in || 3600) - 120) * 1000 });
  if (st.specialist_id) await pool.query('UPDATE specialists SET google_account_id = $2, updated_at = now() WHERE id = $1', [st.specialist_id, acc.id]);
  await audit(pool, `user:${userId}`, 'google.conectado', { email, specialistId: st.specialist_id });
  return { accountId: acc.id as string, email, specialistId: st.specialist_id as string | null };
}

/* ---------- Tokens de acceso ---------- */
const tokenCache = new Map<string, { token: string; exp: number }>();

async function accessToken(accountId: string): Promise<string> {
  const c = tokenCache.get(accountId);
  if (c && c.exp > Date.now()) return c.token;
  const acc = await one('SELECT refresh_token_enc, status FROM google_accounts WHERE id = $1', [accountId]);
  if (!acc) throw new AppError(400, 'google_account_missing', 'La cuenta de Google ya no está conectada.');
  if (acc.status === 'revoked') throw Object.assign(new Error('La cuenta de Google necesita volver a conectarse desde el panel.'), { retryable: false });
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(acc.refresh_token_enc) });
  if (!t.ok) {
    if (t.data.error === 'invalid_grant') {
      await pool.query(`UPDATE google_accounts SET status = 'revoked', last_error = $2, updated_at = now() WHERE id = $1`, [accountId, 'Autorización revocada o caducada']);
      throw Object.assign(new Error('Google ha revocado la autorización. Vuelve a conectar la cuenta desde el panel.'), { retryable: false });
    }
    throw new RetryableError(`Error al renovar el token de Google (${t.status})`);
  }
  tokenCache.set(accountId, { token: t.data.access_token, exp: Date.now() + (Number(t.data.expires_in || 3600) - 120) * 1000 });
  return t.data.access_token;
}

async function gapi(accountId: string, method: string, path: string, body?: unknown, retried = false): Promise<any> {
  const token = await accessToken(accountId);
  const res = await fetch(`${config.google.apiBase}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000)
  });
  if (res.status === 401 && !retried) { tokenCache.delete(accountId); return gapi(accountId, method, path, body, true); }
  if (res.status === 204) return null;
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `Google Calendar ${res.status}: ${data?.error?.message || res.statusText}`;
    if (res.status === 429 || res.status >= 500) throw new RetryableError(msg);
    throw Object.assign(new Error(msg), { status: res.status, retryable: false });
  }
  return data;
}

/* ---------- Calendarios ---------- */
export async function listCalendars(accountId: string) {
  requireEnabled();
  const data = await gapi(accountId, 'GET', '/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=250');
  return (data.items || []).map((c: any) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary, timeZone: c.timeZone }));
}

export async function listAccounts() {
  return q(`SELECT id, email, status, last_error, created_at FROM google_accounts ORDER BY email`);
}

/* ---------- Ocupación ---------- */
type SpGoogle = { id: string; google: { accountId: string | null; calendarId: string | null } };
const busyCache = new Map<string, { at: number; items: { start: number; end: number }[] }>();

/** Intervalos ocupados (ms UTC) en el calendario del especialista, sin contar las citas creadas por esta web. */
export async function busyIntervals(sp: SpGoogle, fromUtc: Date, toUtc: Date): Promise<{ start: number; end: number }[]> {
  if (!config.google.enabled || !sp.google.accountId || !sp.google.calendarId) return [];
  const key = `${sp.id}|${fromUtc.toISOString()}|${toUtc.toISOString()}`;
  const c = busyCache.get(key);
  if (c && Date.now() - c.at < 60_000) return c.items;
  try {
    const items: { start: number; end: number }[] = [];
    let pageToken = '';
    do {
      const p = new URLSearchParams({ timeMin: fromUtc.toISOString(), timeMax: toUtc.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', showDeleted: 'false' });
      if (pageToken) p.set('pageToken', pageToken);
      const data = await gapi(sp.google.accountId, 'GET', `/calendar/v3/calendars/${encodeURIComponent(sp.google.calendarId)}/events?${p}`);
      for (const ev of data.items || []) {
        if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
        if (ev.extendedProperties?.private?.posturalId) continue; // cita de esta web: ya está en la base de datos
        // Eventos de día completo: ocupan el día entero en la zona horaria del centro.
        const s = ev.start?.dateTime ? Date.parse(ev.start.dateTime) : ev.start?.date ? zonedToUtc(ev.start.date, '00:00', config.timezone).getTime() : NaN;
        const e = ev.end?.dateTime ? Date.parse(ev.end.dateTime) : ev.end?.date ? zonedToUtc(ev.end.date, '00:00', config.timezone).getTime() : NaN;
        if (Number.isFinite(s) && Number.isFinite(e) && e > s) items.push({ start: s, end: e });
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    busyCache.set(key, { at: Date.now(), items });
    return items;
  } catch (e) {
    log.warn('no se pudo consultar Google Calendar', { specialistId: sp.id, err: (e as Error).message });
    if (config.google.busyFailOpen) return [];
    throw unavailable('Ahora mismo no podemos comprobar la agenda del especialista. Inténtalo en unos minutos o llama al centro.');
  }
}
export const clearBusyCache = () => busyCache.clear();

/* ---------- Eventos ---------- */
export type EventInput = {
  appointmentId: string; summary: string; description: string; startIso: string; endIso: string; timeZone: string;
  location?: string; colorId?: string;
};

export async function upsertEvent(accountId: string, calendarId: string, eventId: string | null, ev: EventInput): Promise<string> {
  const body = {
    summary: ev.summary,
    description: ev.description,
    ...(ev.location ? { location: ev.location } : {}),
    ...(ev.colorId ? { colorId: ev.colorId } : {}),
    start: { dateTime: ev.startIso, timeZone: ev.timeZone },
    end: { dateTime: ev.endIso, timeZone: ev.timeZone },
    extendedProperties: { private: { posturalId: ev.appointmentId } },
    reminders: { useDefault: true }
  };
  const cal = encodeURIComponent(calendarId);
  if (eventId) {
    try {
      const r = await gapi(accountId, 'PATCH', `/calendar/v3/calendars/${cal}/events/${encodeURIComponent(eventId)}`, { ...body, status: 'confirmed' });
      return r.id;
    } catch (e) {
      if ((e as { status?: number }).status !== 404 && (e as { status?: number }).status !== 410) throw e;
      // El evento se borró a mano en Google: se vuelve a crear.
    }
  }
  const r = await gapi(accountId, 'POST', `/calendar/v3/calendars/${cal}/events`, body);
  return r.id;
}

export async function deleteEvent(accountId: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await gapi(accountId, 'DELETE', `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  } catch (e) {
    const s = (e as { status?: number }).status;
    if (s === 404 || s === 410) return; // ya no existe
    throw e;
  }
}
