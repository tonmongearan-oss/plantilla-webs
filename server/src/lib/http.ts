/* Enrutador HTTP mínimo sobre node:http (sin dependencias). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { AppError } from './errors.ts';
import { log } from './log.ts';
import { config } from '../config.ts';

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  rawBody: Buffer;
  ip: string;
  cookies: Record<string, string>;
  state: Record<string, any>;
};
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;
type Route = { method: string; re: RegExp; keys: string[]; handlers: Handler[] };

/** Valor que indica que el manejador ya ha escrito la respuesta. */
export const HANDLED = Symbol('handled');

export class Router {
  routes: Route[] = [];
  add(method: string, pattern: string, ...handlers: Handler[]) {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
    return this;
  }
  get(p: string, ...h: Handler[]) { return this.add('GET', p, ...h); }
  post(p: string, ...h: Handler[]) { return this.add('POST', p, ...h); }
  put(p: string, ...h: Handler[]) { return this.add('PUT', p, ...h); }
  patch(p: string, ...h: Handler[]) { return this.add('PATCH', p, ...h); }
  delete(p: string, ...h: Handler[]) { return this.add('DELETE', p, ...h); }
  match(method: string, path: string) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = path.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathMatched ? 'method' as const : null;
  }
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(s);
}
export function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

function parseCookies(h?: string) {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const p of h.split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
export function setCookie(res: ServerResponse, name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (config.publicBaseUrl.startsWith('https://')) parts.push('Secure');
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  const prev = res.getHeader('set-cookie');
  res.setHeader('set-cookie', [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), parts.join('; ')]);
}

async function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const ch of req) {
    size += (ch as Buffer).length;
    if (size > limit) throw new AppError(413, 'too_large', 'La petición es demasiado grande.');
    chunks.push(ch as Buffer);
  }
  return Buffer.concat(chunks);
}

function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml'
};

/** Servidor de ficheros estáticos (desarrollo y demos en un solo servicio; en la VPS lo hace Caddy). */
function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): boolean {
  const root = resolve(config.staticDir);
  let p = decodeURIComponent(path);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(root, p));
  if (!file.startsWith(root)) return false;
  let target = file;
  try {
    let st = statSync(target);
    if (st.isDirectory()) { target = join(target, 'index.html'); st = statSync(target); }
  } catch {
    try { statSync(file + '.html'); target = file + '.html'; } catch { return false; }
  }
  res.writeHead(200, {
    'content-type': MIME[extname(target)] || 'application/octet-stream',
    'cache-control': target.includes('/assets/') ? 'public, max-age=3600' : 'no-cache',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(target).pipe(res);
  return true;
}

export function createHandler(routers: Router[]) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', 'http://local');
    const started = Date.now();
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    const ctx: Ctx = {
      req, res, method: req.method || 'GET', path: url.pathname, params: {}, query: url.searchParams,
      body: {}, rawBody: Buffer.alloc(0), ip: clientIp(req), cookies: parseCookies(req.headers.cookie), state: {}
    };
    try {
      let found: ReturnType<Router['match']> = null;
      for (const r of routers) {
        const m = r.match(ctx.method, ctx.path);
        if (m && m !== 'method') { found = m; break; }
        if (m === 'method') found = 'method';
      }
      if (!found || found === 'method') {
        if ((ctx.method === 'GET' || ctx.method === 'HEAD') && config.serveStatic && !ctx.path.startsWith('/api/') && serveStatic(req, res, ctx.path)) return;
        if (found === 'method') throw new AppError(405, 'method_not_allowed', 'Método no permitido');
        throw new AppError(404, 'not_found', 'No encontrado');
      }
      ctx.params = found.params;
      if (!['GET', 'HEAD', 'DELETE'].includes(ctx.method)) {
        ctx.rawBody = await readBody(req);
        const type = String(req.headers['content-type'] || '');
        if (ctx.rawBody.length) {
          if (type.includes('application/json')) {
            try { ctx.body = JSON.parse(ctx.rawBody.toString('utf8')); } catch { throw new AppError(400, 'bad_json', 'JSON no válido'); }
          } else if (type.includes('application/x-www-form-urlencoded')) {
            ctx.body = Object.fromEntries(new URLSearchParams(ctx.rawBody.toString('utf8')));
          }
        }
        if (ctx.body === null || typeof ctx.body !== 'object') ctx.body = {};
      }
      let result: unknown;
      for (const h of found.route.handlers) {
        result = await h(ctx);
        if (res.writableEnded || result === HANDLED) break;
      }
      if (!res.writableEnded && result !== HANDLED) json(res, 200, result ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) {
        json(res, e.status, { error: e.code, message: e.message, details: e.details });
      } else {
        log.error('error no controlado', { path: ctx.path, err: (e as Error).stack || String(e) });
        json(res, 500, { error: 'internal', message: 'Ha ocurrido un error inesperado. Inténtalo de nuevo o llama al centro.' });
      }
    } finally {
      if (ctx.path.startsWith('/api/') || ctx.path.startsWith('/webhooks/')) log.debug('http', { m: ctx.method, p: ctx.path, s: res.statusCode, ms: Date.now() - started });
    }
  };
}
