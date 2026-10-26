/* Conexión a PostgreSQL. */
import pg from 'pg';
import { config } from './config.ts';

pg.types.setTypeParser(1082, (v: string) => v);          // date → 'YYYY-MM-DD'
pg.types.setTypeParser(20, (v: string) => Number(v));    // bigint (contadores) → number
pg.types.setTypeParser(1700, (v: string) => Number(v));  // numeric (precios) → number

// Con DATABASE_SCHEMA, cada cliente usa su propio esquema dentro de la misma base de datos.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000,
  ...(config.databaseSchema ? { options: `-c search_path=${config.databaseSchema},public` } : {})
});

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export async function q<T = any>(text: string, params?: unknown[], db: Db = pool): Promise<T[]> {
  const r = await db.query(text, params);
  return r.rows as T[];
}
export async function one<T = any>(text: string, params?: unknown[], db: Db = pool): Promise<T | undefined> {
  return (await q<T>(text, params, db))[0];
}

/** Ejecuta fn dentro de una transacción. */
export async function tx<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* conexión rota */ }
    throw e;
  } finally {
    c.release();
  }
}

export async function audit(db: Db, actor: string, action: string, details: Record<string, unknown> = {}) {
  await db.query('INSERT INTO audit_log (actor, action, details) VALUES ($1, $2, $3)', [actor, action, JSON.stringify(details)]);
}
