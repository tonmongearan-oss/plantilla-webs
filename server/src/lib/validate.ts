/* Validación de datos de entrada. Mensajes en español, aptos para mostrar. */
import { badRequest } from './errors.ts';
import { isDate, isTime } from './time.ts';
import { config } from '../config.ts';

export function str(v: unknown, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw badRequest(`Falta el campo «${field}».`, { field });
  }
  if (typeof v !== 'string') throw badRequest(`El campo «${field}» no es válido.`, { field });
  const s = v.trim();
  if (opts.min && s.length < opts.min) throw badRequest(`El campo «${field}» es demasiado corto.`, { field });
  if (s.length > (opts.max ?? 500)) throw badRequest(`El campo «${field}» es demasiado largo.`, { field });
  return s;
}
export function date(v: unknown, field = 'fecha'): string {
  if (!isDate(v)) throw badRequest(`Selecciona una ${field} válida.`, { field });
  return v;
}
export function time(v: unknown, field = 'hora'): string {
  if (!isTime(v)) throw badRequest(`Selecciona una ${field} válida.`, { field });
  return v;
}
export function int(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw badRequest(`El campo «${field}» debe estar entre ${min} y ${max}.`, { field });
  return n;
}
export function bool(v: unknown): boolean { return v === true || v === 'true' || v === 'on' || v === 1; }
export function uuid(v: unknown, field = 'id'): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw badRequest(`Identificador no válido (${field}).`, { field });
  return v.toLowerCase();
}
export function slug(v: unknown, field = 'id'): string {
  if (typeof v !== 'string' || !/^[a-z0-9-]{2,40}$/.test(v)) throw badRequest(`Identificador no válido (${field}).`, { field });
  return v;
}

export function email(v: unknown): string {
  const s = str(v, 'correo electrónico', { max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw badRequest('Revisa el formato del correo electrónico.', { field: 'email' });
  return s;
}

/** Normaliza un teléfono a formato internacional E.164 (+34600123456). */
export function phone(v: unknown): string {
  const raw = str(v, 'teléfono', { max: 30 });
  let d = raw.replace(/[\s().-]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (!d.startsWith('+')) {
    d = d.replace(/\D/g, '');
    if (d.length === 9) d = '+' + config.defaultCountryCode + d;
    else d = '+' + d;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(d)) throw badRequest('Revisa el teléfono: debe tener al menos 9 cifras.', { field: 'phone' });
  return d;
}

export function personName(v: unknown): string {
  const s = str(v, 'nombre y apellidos', { min: 3, max: 120 });
  if (!/\s/.test(s)) throw badRequest('Escribe tu nombre y al menos un apellido.', { field: 'name' });
  return s;
}

export function oneOf<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) throw badRequest(`Valor no válido para «${field}».`, { field });
  return v as T;
}
