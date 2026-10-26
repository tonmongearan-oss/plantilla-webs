/* Cliente (negocio) para el que corre este servidor: sitios/<SITE>/sitio.json.
   Un mismo código sirve a todos los clientes; cada despliegue elige el suyo con la variable SITE. */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SiteService = { id: string; nombre: string; duracion: number; precio?: number | null; breve?: string; descripcion?: string };
export type SiteClassType = { id: string; nombre: string; descripcion?: string; publicado?: boolean; intensidad?: number; aforo?: number };
export type Site = {
  slug: string;
  negocio: { nombre: string; nombreCorto?: string; descripcion?: string; telefono: string; email: string; direccion: string; ciudad: string; horario: string; registro?: string; web?: string };
  modulos?: { reservas?: boolean; clases?: boolean; asistente?: boolean; whatsapp?: boolean; pagos?: { activo?: boolean; porcentaje?: number; minutosReserva?: number } };
  reservas?: { antelacionMinutos?: number; diasVista?: number; cancelarHorasAntes?: number; estadoOnline?: 'pendiente' | 'confirmada'; aforoPorDefecto?: number };
  recordatorios?: { minutosAntes?: number[]; instrucciones?: string };
  servicios?: SiteService[];
  clases?: { nombre?: string; etiqueta?: string; duracionMinutos?: number; tipos?: SiteClassType[]; horario?: Record<string, { tipo: string; hora: string }[]> };
  especialistas?: { nombre: string; cargo?: string; bio?: string; color?: string; activo?: boolean; franjaMinutos?: number; servicios?: string[] }[];
  whatsapp?: { prefijoPlantillas?: string };
};

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = process.env.SITE || 'postural';
const file = join(REPO_ROOT, 'sitios', slug, 'sitio.json');
if (!existsSync(file)) {
  const list = existsSync(join(REPO_ROOT, 'sitios')) ? readdirSync(join(REPO_ROOT, 'sitios')).join(', ') : '(ninguno)';
  throw new Error(`No existe sitios/${slug}/sitio.json. Define SITE con uno de: ${list}`);
}
export const site: Site = JSON.parse(readFileSync(file, 'utf8'));
site.slug = site.slug || slug;
export const shortName = () => site.negocio.nombreCorto || site.negocio.nombre;
