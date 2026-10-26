/* Arranque "todo en uno" para la demo en hosting gratuito (Render):
   migraciones + datos iniciales + usuario admin + API + worker en un solo proceso.
   En la VPS se sigue usando docker compose (app y worker por separado). */
import { config, assertProviderConfig } from './config.ts';
import { pool } from './db.ts';
import { log } from './lib/log.ts';
import { migrate } from './migrate.ts';
import { seed } from './scripts/seed.ts';
import { createUser } from './modules/auth.ts';
import { buildServer } from './server.ts';
import { tick } from './worker.ts';
import { scheduleDailyMaintenance } from './modules/sync.ts';

assertProviderConfig();
await migrate();
await seed();

// Crea el usuario del panel a partir de variables de entorno (Render gratis no tiene consola).
const adminEmail = process.env.ADMIN_EMAIL || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
if (adminEmail && adminPassword) {
  const exists = await pool.query('SELECT 1 FROM admin_users WHERE email = lower($1)', [adminEmail]);
  if (!exists.rowCount) {
    await createUser(adminEmail, process.env.ADMIN_NAME || 'Administrador', adminPassword, 'admin');
    log.info('usuario admin creado', { email: adminEmail });
  }
}

const server = buildServer();
server.listen(config.port, () => log.info('API escuchando (modo demo todo en uno)', { port: config.port, url: config.publicBaseUrl, google: config.google.enabled, whatsapp: config.whatsapp.provider }));

// Worker en el mismo proceso: Google Calendar, confirmaciones y recordatorios de WhatsApp.
let stopping = false;
let lastMaint = '';
(async () => {
  while (!stopping) {
    try {
      const day = new Date().toISOString().slice(0, 10);
      if (day !== lastMaint) { await scheduleDailyMaintenance(); lastMaint = day; }
      let n;
      do { n = await tick(); } while (n > 0 && !stopping);
    } catch (e) {
      log.error('error en el worker', { err: (e as Error).message });
    }
    await new Promise(r => setTimeout(r, config.worker.pollSeconds * 1000));
  }
})();

const stop = () => {
  stopping = true;
  log.info('cerrando…');
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
