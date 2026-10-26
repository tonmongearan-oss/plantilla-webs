#!/usr/bin/env node
/* Crea la carpeta de un cliente nuevo a partir de sitios/_plantilla.
   Uso: node scripts/nuevo-sitio.mjs <slug> "Nombre del negocio"
   Después: edita sitios/<slug>/sitio.json (textos, colores, servicios…) y pon sus fotos en sitios/<slug>/img/. */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [slug, nombre] = process.argv.slice(2);
if (!slug || !/^[a-z0-9-]{2,40}$/.test(slug)) { console.error('Uso: node scripts/nuevo-sitio.mjs <slug> "Nombre del negocio"   (slug: minúsculas, números y guiones)'); process.exit(1); }
const dest = join(ROOT, 'sitios', slug);
if (existsSync(dest)) { console.error(`Ya existe sitios/${slug}`); process.exit(1); }
cpSync(join(ROOT, 'sitios', '_plantilla'), dest, { recursive: true });
const f = join(dest, 'sitio.json');
const s = JSON.parse(readFileSync(f, 'utf8'));
s.slug = slug;
if (nombre) { s.negocio.nombre = nombre; s.negocio.nombreCorto = nombre.split(/\s+/).slice(0, 2).join(' '); }
s.whatsapp = { prefijoPlantillas: slug.replace(/-/g, '_') };
s.despliegue = { web: '', api: '' };
writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
console.log(`Creado sitios/${slug}. Edita sitios/${slug}/sitio.json y genera la web con: node web/build.mjs --site ${slug}`);
