/* Aplica las migraciones SQL pendientes (server/migrations/*.sql), en orden y una sola vez. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';
import { config } from './config.ts';
import { log } from './lib/log.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(): Promise<string[]> {
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    await c.query('SELECT pg_advisory_lock(827364)');
    // Las extensiones van en «public» para que las compartan todos los esquemas de clientes.
    await c.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
    if (config.databaseSchema) await c.query(`CREATE SCHEMA IF NOT EXISTS ${config.databaseSchema}`);
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r: { name: string }) => r.name));
    for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(dir, f), 'utf8');
      try {
        await c.query('BEGIN');
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        applied.push(f);
        log.info('migración aplicada', { file: f });
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Error en la migración ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(827364)').catch(() => {});
    c.release();
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(a => { log.info('migraciones al día', { aplicadas: a.length }); return pool.end(); })
    .catch(e => { log.error((e as Error).message); process.exit(1); });
}
