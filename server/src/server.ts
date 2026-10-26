/* Servidor HTTP de la API (y de los ficheros de la web en desarrollo). */
import { createServer } from 'node:http';
import { config, assertProviderConfig } from './config.ts';
import { pool } from './db.ts';
import { log } from './lib/log.ts';
import { createHandler } from './lib/http.ts';
import { publicRouter } from './routes/public.ts';
import { adminRouter } from './routes/admin.ts';
import { webhookRouter } from './routes/webhooks.ts';

export function buildServer() {
  return createServer(createHandler([publicRouter, adminRouter, webhookRouter]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertProviderConfig();
  const server = buildServer();
  server.listen(config.port, () => log.info('API escuchando', { port: config.port, url: config.publicBaseUrl, google: config.google.enabled, whatsapp: config.whatsapp.provider }));
  const stop = () => { log.info('cerrando…'); server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
