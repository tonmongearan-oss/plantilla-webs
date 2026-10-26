/* Registro en formato JSON por líneas (fácil de leer con `docker compose logs`). */
import { config } from '../config.ts';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const min = LEVELS[(config.logLevel as Level)] ?? 20;

function write(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < min || process.env.LOG_SILENT === '1') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const log = {
  debug: (m: string, e?: Record<string, unknown>) => write('debug', m, e),
  info: (m: string, e?: Record<string, unknown>) => write('info', m, e),
  warn: (m: string, e?: Record<string, unknown>) => write('warn', m, e),
  error: (m: string, e?: Record<string, unknown>) => write('error', m, e)
};
