#!/usr/bin/env node
/* Genera la web estática de UN cliente en web/dist.
   Uso:  node web/build.mjs --site postural        (o variable de entorno SITE=postural)
   - Configuración del cliente: sitios/<slug>/sitio.json
   - Páginas y piezas comunes: web/src/pages, web/src/partials (las del cliente, si existen, las sustituyen)
       sitios/<slug>/paginas/*.html   → sustituyen o añaden páginas
       sitios/<slug>/parciales/*.html → sustituyen cabecera, pie…
       sitios/<slug>/img/*            → imágenes (se copian a assets/img)
       sitios/<slug>/estilo.css       → estilos extra del cliente (opcional)
   - En las páginas se puede escribir {{negocio.nombre}}, {{negocio.telefono}}, {{marca.colores.acento}}…
     y {{> parcial}} para incluir una pieza.
   --demo: versión sin servidor (solo Postural, datos ficticios en el navegador). */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');
const arg = name => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const SLUG = arg('--site') || process.env.SITE;
if (!SLUG) { console.error('Indica el cliente: node web/build.mjs --site <slug> (o SITE=<slug>). Clientes: ' + readdirSync(join(REPO, 'sitios')).filter(d => !d.startsWith('.')).join(', ')); process.exit(1); }
const SITE_DIR = join(REPO, 'sitios', SLUG);
if (!existsSync(join(SITE_DIR, 'sitio.json'))) { console.error(`No existe sitios/${SLUG}/sitio.json`); process.exit(1); }
const S = JSON.parse(readFileSync(join(SITE_DIR, 'sitio.json'), 'utf8'));
const DEMO = process.argv.includes('--demo');
const ARTIFACT = process.argv.includes('--artifact');
const OUT = join(ROOT, DEMO ? 'dist-demo' : 'dist');
const SRC = join(ROOT, 'src');
const VERSION = Date.now().toString(36);
const M = S.modulos || {};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'public'), OUT, { recursive: true });
mkdirSync(join(OUT, 'assets/img'), { recursive: true });
if (existsSync(join(SITE_DIR, 'img'))) cpSync(join(SITE_DIR, 'img'), join(OUT, 'assets/img'), { recursive: true });

/* ---------- estilos: piezas comunes + colores y tipografías del cliente ---------- */
const C = (S.marca && S.marca.colores) || {};
const T = (S.marca && S.marca.tipografias) || {};
const L = (S.marca && S.marca.logo) || {};
const brandVars = Object.entries({
  '--sage': C.acento, '--sage-deep': C.acentoTexto, '--sage-soft': C.acentoSuave, '--brand-btn': C.boton, '--brand-btn-h': C.botonHover,
  '--navy': C.banda, '--surface-2': C.fondoSuave, '--mist': C.niebla, '--ink': C.texto, '--btn-bg': C.botonSuave, '--btn-fg': C.botonSuaveTexto,
  '--f-display': T.titulos && `'${T.titulos}', 'Segoe UI', system-ui, sans-serif`,
  '--f-body': T.texto && `'${T.texto}', 'Segoe UI', system-ui, -apple-system, sans-serif`,
  '--f-mono': T.texto && `'${T.texto}', 'Segoe UI', system-ui, sans-serif`,
  '--logo': L.archivo && `url("../img/${L.archivo}")`, '--logo-ratio': L.proporcion
}).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v};`).join('\n');
const cssDir = join(ROOT, 'public/assets/css');
let css = ['_base.css', '_layout.css', '_public.css', '_pages.css', '_booking.css', '_chat.css'].map(f => readFileSync(join(cssDir, f), 'utf8')).join('\n');
css += `\n/* ---- ${S.negocio.nombre} (sitios/${SLUG}/sitio.json) ---- */\n:root {\n${brandVars}\n}\n`;
if (L.modo === 'imagen') css += `.logo-img { background: var(--logo) center / contain no-repeat; -webkit-mask: none; mask: none; }\n`;
if (L.modo === 'texto' || !L.archivo) css += `.logo-img { display: none; } .logo-txt { display: inline-block; }\n`;
if (existsSync(join(SITE_DIR, 'estilo.css'))) css += '\n' + readFileSync(join(SITE_DIR, 'estilo.css'), 'utf8');
writeFileSync(join(OUT, 'assets/css/site.css'), css);
// el panel también lleva los colores del cliente
const adminCss = join(OUT, 'assets/css/admin.css');
if (existsSync(adminCss)) writeFileSync(adminCss, readFileSync(adminCss, 'utf8') + `\n:root {\n${brandVars}\n}\n` + (L.modo === 'imagen' ? `.logo-img { background: var(--logo) center / contain no-repeat; -webkit-mask: none; mask: none; }\n` : ''));
for (const f of readdirSync(join(OUT, 'assets/css'))) if (f.startsWith('_')) rmSync(join(OUT, 'assets/css', f));
if (!DEMO) for (const f of ['demo-store.js', 'demo-backend.js', 'demo-admin.js']) rmSync(join(OUT, 'assets/js', f), { force: true });

/* ---------- datos públicos del cliente para el JS de la web (asistente, reservas) ---------- */
const publicSite = {
  slug: SLUG, negocio: S.negocio, textos: S.textos || {},
  modulos: { reservas: M.reservas !== false, clases: !!M.clases, asistente: M.asistente !== false },
  clases: M.clases ? { nombre: S.clases.nombre, etiqueta: S.clases.etiqueta, intensidad: Object.fromEntries((S.clases.tipos || []).map(t => [t.id, t.intensidad || 2])) } : null,
  fotos: Object.fromEntries((S.servicios || []).filter(x => x.imagenTarjeta || x.imagen).map(x => [x.id, `assets/img/${x.imagenTarjeta || x.imagen}`])),
  asistente: S.asistente || {}, servicioInicial: S.servicioInicial || (S.servicios && S.servicios[0] && S.servicios[0].id) || null
};
writeFileSync(join(OUT, 'assets/js/sitio.js'), `window.SITIO = ${JSON.stringify(publicSite)};\n`);

// JS y CSS solo con caracteres ASCII (\uXXXX): funcionan aunque el servidor no indique la codificación
const asciiJs = s => s.replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const asciiCss = s => s.replace(/[^\x00-\x7f]/gu, c => '\\' + c.codePointAt(0).toString(16) + ' ');
for (const f of readdirSync(join(OUT, 'assets/js'))) { const p = join(OUT, 'assets/js', f); writeFileSync(p, asciiJs(readFileSync(p, 'utf8'))); }
for (const f of readdirSync(join(OUT, 'assets/css'))) { const p = join(OUT, 'assets/css', f); writeFileSync(p, asciiCss(readFileSync(p, 'utf8'))); }

/* ---------- plantillas ---------- */
const pick = (kind, file) => {           // primero la del cliente, si no la común
  const own = join(SITE_DIR, kind === 'pages' ? 'paginas' : 'parciales', file);
  return existsSync(own) ? own : join(SRC, kind, file);
};
const partial = name => readFileSync(pick('partials', name + '.html'), 'utf8');
const layoutFile = existsSync(join(SITE_DIR, 'layout.html')) ? join(SITE_DIR, 'layout.html') : join(SRC, 'layout.html');
const layout = readFileSync(layoutFile, 'utf8');
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const telHref = t => '+' + (String(t).replace(/\D/g, '').length === 9 ? '34' : '') + String(t).replace(/\D/g, '');

const dataScripts = DEMO ? ['engine.js', 'demo-store.js', 'demo-backend.js'] : ['api.js'];
const script = (f, prefix = '') => `<script src="${prefix}assets/js/${f}?v=${VERSION}"></script>`;
const fontsUrl = T.titulos ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(T.titulos).replace(/%20/g, '+')}:wght@${T.pesosTitulos || '500;600;700;800'}${T.texto && T.texto !== T.titulos ? `&family=${encodeURIComponent(T.texto).replace(/%20/g, '+')}:wght@${T.pesosTexto || '400;500;600;700'}` : ''}&display=swap` : '';

function buildNav(mobile = false) {
  const items = S.menu || [
    { texto: 'Servicios', url: 'servicios.html', id: 'servicios' },
    ...(M.reservas !== false ? [{ texto: S.textos?.profesionales || 'Equipo', url: 'especialistas.html', id: 'especialistas' }] : []),
    { texto: 'Contacto', url: 'contacto.html', id: 'contacto' }
  ];
  return items.map(i => mobile ? `<a href="${i.url}" data-nav="${i.id || ''}">${escHtml(i.texto)}</a>` : `<a href="${i.url}" data-nav="${i.id || ''}">${escHtml(i.texto)}</a>`).join('\n      ');
}
const ICONS = {
  check: '<circle cx="12" cy="12" r="9.5" stroke-width="1.6"/><path d="M8 12.3l2.7 2.7L16 9.6"/>',
  escudo: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  estrella: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  grupo: '<circle cx="12" cy="7" r="2.6"/><circle cx="5.5" cy="10" r="2.1"/><circle cx="18.5" cy="10" r="2.1"/><path d="M7.5 19c.6-3 2.3-4.6 4.5-4.6s3.9 1.6 4.5 4.6M2.5 19c.3-2 1.4-3.3 3-3.5M21.5 19c-.3-2-1.4-3.3-3-3.5"/>',
  tarjeta: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
  herramienta: '<path d="M14.5 5.5a4 4 0 00-5.2 5.2L4 16l4 4 5.3-5.3a4 4 0 005.2-5.2l-2.6 2.6-2.8-.6-.6-2.8z"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  ubicacion: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  corazon: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.3 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z"/>',
  hoja: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19l7-7"/>',
  bici: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M14 6h3"/>',
  coche: '<path d="M4 16v-3l2-5h12l2 5v3M4 16h16M4 16v2h3v-2M17 16v2h3v-2"/><circle cx="7.5" cy="13.5" r=".6"/><circle cx="16.5" cy="13.5" r=".6"/>',
  copa: '<path d="M8 3h8l-.5 6a3.5 3.5 0 01-7 0zM12 12.5V20M8.5 20h7"/>',
  envio: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>'
};
const icon = (n, w = 1.7) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.check}</svg>`;
const ctaReservar = escHtml(S.textos?.reservar || 'Reservar');
function servicesHtml() {   // filas de la página de servicios
  return (S.servicios || []).map((s, i) => `<article class="svc-row anchor${i % 2 ? ' flip' : ''}" id="${s.id}">
    <div class="media${s.imagen ? '' : ' icon-only'}">${s.imagen ? `<img src="assets/img/${escHtml(s.imagen)}" alt="${escHtml(s.nombre)}" loading="lazy">` : icon(s.icono || 'check', 1.3)}</div>
    <div class="txt">${s.etiqueta ? `<span class="eyebrow">${escHtml(s.etiqueta)}</span>` : ''}<h2>${escHtml(s.nombre)}</h2>
      <p>${escHtml(s.descripcion || s.breve || '')}</p>
      ${(s.puntos || []).length ? `<ul class="ticks">${s.puntos.map(p => `<li>${icon('check', 2.2)}<span>${escHtml(p)}</span></li>`).join('')}</ul>` : ''}
      <p class="lead" style="font-size:1rem">${s.duracion} min${s.precio != null ? ` · ${String(s.precio).replace('.', ',')} €` : ''}</p>
      <div class="acts">${M.reservas !== false ? `<a class="btn btn-brand" href="reservar.html?servicio=${s.id}">${ctaReservar}</a>` : ''}${M.asistente !== false ? `<button class="btn btn-ghost" type="button" data-act="chat-ask" data-q="¿Qué es ${escHtml(s.nombre)}?">Tengo una pregunta</button>` : ''}</div></div>
  </article>`).join('\n');
}
const subnavHtml = () => (S.servicios || []).map(s => `<a href="#${s.id}">${escHtml(s.nombre)}</a>`).join('');
const P = S.portada || {};
const pruebasHtml = () => (P.pruebas || []).map(t => `<li>${icon('check', 2.2)}<span>${escHtml(t)}</span></li>`).join('');
const ventajasHtml = () => (S.ventajas || []).map(v => `<article class="perk"><span class="ic">${icon(v.icono)}</span><h3>${escHtml(v.titulo)}</h3><p>${escHtml(v.texto)}</p></article>`).join('');
const heroImg = () => P.imagen ? `<img class="hero-bg-img" src="assets/img/${escHtml(P.imagen)}" alt="${escHtml(P.imagenAlt || S.negocio.nombre)}" fetchpriority="high"><div class="hero-shade" aria-hidden="true"></div>` : '';
function socialHtml() {
  const r = S.negocio.redes || {};
  const names = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X', google: 'Google' };
  return Object.entries(r).filter(([, u]) => u).map(([k, u]) => `<li><a href="${escHtml(u)}" target="_blank" rel="noopener">${names[k] || k}</a></li>`).join('');
}

// Variables comunes: todo sitio.json (con puntos) + derivados útiles
const derived = {
  telHref: telHref(S.negocio.telefono || ''), fontsUrl, themeColor: C.boton || C.acento || '#333333',
  imagenCompartir: S.marca && S.marca.imagenCompartir ? `assets/img/${S.marca.imagenCompartir}` : '',
  favicon: S.marca && S.marca.favicon ? `assets/img/${S.marca.favicon}` : '',
  year: String(new Date().getFullYear()),
  nav: buildNav(), navMovil: buildNav(true), serviciosFilas: servicesHtml(), subnavServicios: subnavHtml(), redesLista: socialHtml(), redesBloque: socialHtml() ? `<h4>Síguenos</h4><ul>${socialHtml()}</ul><div style="height:18px"></div>` : '',
  pruebasLista: pruebasHtml(), ventajasLista: ventajasHtml(), portadaImagen: heroImg(), heroClase: P.imagen ? 'hero hero-bg' : 'hero',
  mapsQuery: encodeURIComponent(`${S.negocio.direccion || ''}, ${S.negocio.ciudad || ''}`), ctaReservar,
  icoCalendario: icon('calendario'), icoFlecha: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
};
const missing = new Set();
function render(tpl, vars) {
  return tpl
    .replace(/\{\{>\s*([a-z0-9-]+)\s*\}\}/g, (_, n) => render(partial(n), vars))
    .replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (whole, k) => {
      if (k in vars) return vars[k] ?? '';
      const v = get(S, k);
      if (v === undefined) { missing.add(k); return ''; }   // falta en sitio.json: se deja vacía y se avisa
      return typeof v === 'object' ? escHtml(JSON.stringify(v)) : escHtml(v);
    });
}

const pageFiles = new Set(readdirSync(join(SRC, 'pages')).filter(f => f.endsWith('.html')));
if (existsSync(join(SITE_DIR, 'paginas'))) for (const f of readdirSync(join(SITE_DIR, 'paginas'))) if (f.endsWith('.html')) pageFiles.add(f);
for (const f of S.ocultarPaginas || []) pageFiles.delete(f);
if (M.reservas === false) { pageFiles.delete('reservar.html'); pageFiles.delete('cita.html'); }

let count = 0;
for (const file of [...pageFiles].sort()) {
  const raw = readFileSync(pick('pages', file), 'utf8');
  const m = raw.match(/^<!--(\{[\s\S]*?\})-->\s*/);
  if (!m) throw new Error(`Falta la cabecera JSON en ${file}`);
  const meta = JSON.parse(render(m[1], {}));
  const extra = (meta.scripts || []).map(s => script(s + '.js')).join('\n');
  const vars = {
    ...derived,
    title: meta.title, description: meta.description, page: meta.page, v: VERSION,
    demoFlag: DEMO ? '<span class="demo-flag">Demo de propuesta: datos ficticios</span>' : '',
    content: raw.slice(m[0].length),
    scripts: [script('sitio.js'), ...dataScripts.map(s => script(s)), script('common.js'), M.asistente !== false ? script('chat.js') : '', extra].filter(Boolean).join('\n')
  };
  let html = render(layout, vars);
  html = render(html, vars); // parciales y variables dentro del contenido
  if (DEMO && ARTIFACT && file === 'index.html') {
    const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*/g, '');
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
    html = `${head}\n<meta name="claude:viewport-fit-sides" content="cover">\n${body.replace('<script', `<script>document.body.dataset.page = ${JSON.stringify(meta.page)};</script>\n<script`)}`;
  }
  writeFileSync(join(OUT, file), html);
  count++;
}

// Panel de gestión
mkdirSync(join(OUT, 'admin'), { recursive: true });
const adminTpl = readFileSync(join(SRC, 'admin.html'), 'utf8');
const adminScripts = [script('sitio.js', '../'), ...(DEMO ? ['engine.js', 'demo-store.js', 'demo-admin.js'] : ['engine.js', 'admin-store.js']).concat(['admin-core.js', 'admin-app.js']).map(s => script(s, '../'))].join('\n');
writeFileSync(join(OUT, 'admin/index.html'), render(adminTpl, { ...derived, v: VERSION, scripts: adminScripts }));

// Netlify: la API de este cliente (misma dirección para el navegador → cookies del panel funcionan)
const api = process.env.API_URL || (S.despliegue && S.despliegue.api);
if (api && !DEMO) writeFileSync(join(OUT, '_redirects'), `/api/*  ${api.replace(/\/+$/, '')}/api/:splat  200!\n/webhooks/*  ${api.replace(/\/+$/, '')}/webhooks/:splat  200!\n`);

if (missing.size) console.warn(`Aviso: faltan en sitios/${SLUG}/sitio.json: ${[...missing].join(', ')}`);
const size = d => readdirSync(d).reduce((n, f) => { const p = join(d, f); const s = statSync(p); return n + (s.isDirectory() ? size(p) : s.size); }, 0);
console.log(`Web de «${S.negocio.nombre}» generada en ${OUT}: ${count} páginas + panel (${Math.round(size(OUT) / 1024)} KB)${DEMO ? ' · MODO DEMO' : ''}${api && !DEMO ? ` · API ${api}` : ''}`);
