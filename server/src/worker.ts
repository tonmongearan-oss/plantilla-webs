/* Proceso de tareas programadas: sincroniza Google Calendar y envía los WhatsApp
   (confirmaciones y recordatorios) aunque nadie tenga la web abierta. Ejecuta una sola instancia. */
import { config, assertProviderConfig } from './config.ts';
import { pool } from './db.ts';
import { log } from './lib/log.ts';
import { claim, complete, fail } from './modules/jobs.ts';
import { runJob, scheduleDailyMaintenance } from './modules/sync.ts';

let stopping = false;

export async function tick(limit = 20): Promise<number> {
  const jobs = await claim(limit);
  for (const job of jobs) {
    try {
      const result = await runJob(job);
      await complete(job.id, result);
      log.info('tarea completada', { id: job.id, type: job.type, result });
    } catch (e) {
      const retry = await fail(job, e as Error);
      log.warn('tarea fallida', { id: job.id, type: job.type, intento: job.attempts, reintento: retry, err: (e as Error).message });
    }
  }
  return jobs.length;
}

async function main() {
  assertProviderConfig();
  log.info('worker iniciado', { whatsapp: config.whatsapp.provider, google: config.google.enabled, cadaSegundos: config.worker.pollSeconds });
  let lastMaint = '';
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
  await pool.end();
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; log.info('deteniendo worker…'); });

if (import.meta.url === `file://${process.argv[1]}`) main();
