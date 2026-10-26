/* Errores con código HTTP y mensaje apto para mostrar al usuario. */
export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const notFound = (msg = 'No encontrado') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new AppError(409, code, msg);
export const unauthorized = (msg = 'Necesitas iniciar sesión') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'No tienes permiso para esta acción') => new AppError(403, 'forbidden', msg);
export const unavailable = (msg: string) => new AppError(503, 'unavailable', msg);

/** Error de una integración externa que conviene reintentar más tarde. */
export class RetryableError extends Error {
  retryable = true;
}

/** Postgres: conflicto de la restricción de exclusión (solape de citas). */
export const isOverlapError = (e: unknown) => (e as { code?: string })?.code === '23P01';
export const isUniqueError = (e: unknown) => (e as { code?: string })?.code === '23505';
