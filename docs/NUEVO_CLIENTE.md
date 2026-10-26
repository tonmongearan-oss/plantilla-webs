# Nueva demo para un cliente

Todas las webs comparten el mismo motor (reservas, Google Calendar, WhatsApp, señal con Stripe y panel). Cada cliente es solo una carpeta:

```
sitios/<slug>/
  sitio.json        ← nombre, contacto, colores, tipografías, textos, servicios, módulos…
  img/              ← logo, favicon, fotos (se publican en assets/img/)
  paginas/*.html    ← (opcional) páginas propias o que sustituyen a las comunes
  parciales/*.html  ← (opcional) cabecera/pie propios
  estilo.css        ← (opcional) estilos extra
```

Las páginas comunes (`web/src/pages`) se rellenan solas con `sitio.json`: portada, servicios, equipo, contacto, reservar, gestionar cita y privacidad. Postural (`sitios/postural`) es un ejemplo de cliente con todas sus páginas propias.

## 1. Crear la carpeta

```bash
node scripts/nuevo-sitio.mjs equipraiders "Equip Raiders"
```

Copia `sitios/_plantilla` (un taller de ejemplo con todos los campos) y pone el nombre.

## 2. Rellenar `sitio.json`

| Bloque | Qué es |
|---|---|
| `negocio` | nombre, nombre corto, sector, descripción, teléfono, correo, dirección, ciudad, horario, redes |
| `marca` | colores (`acento`, `boton`, `banda`…), tipografías de Google Fonts, logo (`modo`: `imagen`, `mascara` o `texto`), favicon, imagen para compartir |
| `textos` | botón de reservar («Pide tu hora», «Reserva tu cita»…), cómo se llama a los clientes y al equipo |
| `portada` | etiqueta, título, parte destacada, subtítulo, foto de fondo, 3 frases de confianza |
| `ventajas` | 4 tarjetas con `icono` (check, escudo, reloj, estrella, grupo, tarjeta, herramienta, calendario, ubicacion, corazon, hoja, bici, coche, copa, envio) |
| `llamada` | la banda de color con el último empujón para reservar |
| `servicios` | id, nombre, duración (min), precio (€ o `null`), texto breve, descripción, puntos, icono o imagen |
| `modulos` | `reservas`, `clases` (grupos con aforo), `asistente`, `whatsapp`, `pagos` (`porcentaje` de señal) |
| `reservas`, `recordatorios` | antelación mínima, días vista, horas para cancelar, recordatorios |
| `asistente` | `saludo`, `salud` (aviso de que no diagnostica), `faq` con respuestas propias (`patron` en minúsculas sin acentos) |
| `especialistas` | (opcional) fichas de partida; los horarios se ponen en el panel |
| `despliegue` | `web` y `api` (direcciones públicas, para Netlify) |

Si falta un dato que usa una página, el build avisa: `Aviso: faltan en sitios/x/sitio.json: …`.

Probar en local: `node web/build.mjs --site equipraiders` y abrir `web/dist/index.html` (o arrancar el servidor, abajo).

## 3. Publicar la demo (Render, un solo servicio)

Un servicio web de Render sirve la web **y** la API. Gratis para demos.

- **Repo:** este repositorio · rama `main`
- **Build:** `npm install --omit=dev --no-audit --no-fund && node web/build.mjs --site $SITE`
- **Start:** `node server/src/demo-all.ts`
- **Variables:**

| Variable | Valor |
|---|---|
| `SITE` | `equipraiders` |
| `NODE_VERSION` | `22.18.0` |
| `NODE_ENV` | `production` |
| `SERVE_STATIC` | `true` |
| `PUBLIC_BASE_URL` | `https://equipraiders-demo.onrender.com` (la URL que dé Render) |
| `DATABASE_URL` | la URL interna de la base de datos compartida de demos |
| `DATABASE_SCHEMA` | `equipraiders` (cada cliente, su esquema: varias demos comparten base de datos) |
| `ENCRYPTION_KEY` | 32 bytes en base64 (`openssl rand -base64 32`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | acceso al panel (contraseña de 12+ caracteres) |
| `WHATSAPP_PROVIDER` | `disabled` hasta configurarlo |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | opcional (ver GOOGLE_CALENDAR.md); la URI es `PUBLIC_BASE_URL/api/admin/google/callback` |
| `STRIPE_SECRET_KEY` | opcional (`sk_test_…` para la demo, ver PAGOS.md) |

Notas del plan gratuito de Render: el servicio se duerme tras 15 min sin visitas; la base de datos gratuita caduca a los 30 días y solo hay una por cuenta (por eso las demos la comparten con `DATABASE_SCHEMA`).

## 4. (Opcional) Web en Netlify

Para un dominio o una web más rápida: en Netlify, *Import from GitHub* con este repositorio, variable de entorno `SITE=<slug>`, y en `sitio.json → despliegue.api` la URL de Render. El build crea `_redirects` para que `/api/*` vaya a Render. En Render, `PUBLIC_BASE_URL` pasa a ser la dirección de Netlify.

## 5. Después de publicar

1. Entrar en `/admin/`, crear los profesionales con su horario.
2. Probar una reserva de principio a fin.
3. Google Calendar, WhatsApp y Stripe según se necesiten (docs correspondientes).

## Cuando el cliente dice que sí

Plan de pago en Render (servidor `starter` + base de datos propia del cliente) o VPS con Docker (`SITE=<slug>` en `.env`, ver INSTALACION.md), dominio del cliente y cuentas del cliente en Google, Meta y Stripe.
