# Plantilla de webs con reservas

Motor común para crear webs de negocios locales con **reservas online, Google Calendar, recordatorios por WhatsApp, señal con Stripe, asistente y panel de gestión**. Cada cliente es una carpeta en `sitios/` con su `sitio.json`: la misma base sirve a todos y, cuando se mejora el motor, mejoran todas las webs.

- **Clientes:** `sitios/postural` (ejemplo completo, con páginas propias) · `sitios/_plantilla` (punto de partida para clientes nuevos)
- **Nuevo cliente:** [docs/NUEVO_CLIENTE.md](docs/NUEVO_CLIENTE.md) · `node scripts/nuevo-sitio.mjs <slug> "Nombre"`
- **Generar una web:** `node web/build.mjs --site <slug>`
- **Servidor:** variable `SITE=<slug>` (y opcionalmente `DATABASE_SCHEMA` para compartir base de datos)

Lo que sigue describe el motor con el ejemplo de Postural.

## Qué incluye

- **Web pública por páginas:** Inicio, Servicios, Método Postural, Especialistas, Horarios, Nosotros, Testimonios, Contacto, Reservar, Gestionar mi cita y Política de privacidad. El blog enlaza al blog actual del centro.
- **Reservas por especialista:** servicio → especialista → calendario con sus días y horas reales → datos → confirmación. Cada profesional tiene su horario, pausas, vacaciones y duración de franja.
- **Sin dobles reservas:** PostgreSQL impide por restricción que un especialista tenga dos citas que se solapen, aunque lleguen a la vez.
- **Clases grupales:** reserva por modalidad, día y hora, con aforo máximo que se respeta también con reservas simultáneas.
- **Google Calendar:** cada cita crea, actualiza o borra un evento en el calendario del especialista (OAuth 2.0). Los eventos personales del especialista bloquean su agenda online.
- **WhatsApp:** confirmación al reservar y recordatorios 24 h y 2 h antes (configurables), con plantillas aprobadas por Meta (Cloud API) o Twilio. Solo se envía a quien da su consentimiento. Responder BAJA da de baja al paciente.
- **Señal online con Stripe:** al reservar desde la web un servicio con precio se paga un 40 % de señal; si no se paga en 30 minutos, el hueco se libera, y si el paciente cancela con antelación se le devuelve.
- **El paciente gestiona su cita:** enlace personal para cambiarla de hora o cancelarla.
- **Panel de gestión:** dashboard, agenda (día, semana, mes y por especialista), especialistas, pacientes, servicios, horarios y aforo, configuración e integraciones.
- **Asistente en la web:** responde preguntas frecuentes y propone horas libres reales. No da diagnósticos.

## Arquitectura

```
Navegador ──HTTPS──▶ Caddy (web estática + certificados)
                        │  /api/*  /webhooks/*
                        ▼
                     app (Node.js + TypeScript) ──▶ PostgreSQL
                        │                              ▲
                     worker (tareas programadas) ──────┘
                        ├──▶ Google Calendar API
                        └──▶ WhatsApp Cloud API (Meta) o Twilio
```

- **app**: API HTTP en Node 22 con TypeScript, sin framework. La única dependencia es `pg`.
- **worker**: procesa la cola de tareas guardada en PostgreSQL: sincroniza eventos, envía WhatsApp y hace la limpieza diaria. Los recordatorios salen a su hora aunque nadie tenga la web abierta, y si falla un servicio externo se reintenta con espera creciente.
- **web**: HTML, CSS y JavaScript sin dependencias, generados por `web/build.mjs` a partir de una plantilla común.
- **Secretos**: solo en el servidor (`.env`). El navegador nunca ve claves. Los tokens de Google y los enlaces de gestión se guardan cifrados (AES-256-GCM).
- **Datos personales**: solo nombre, teléfono y correo, y nada de información médica. Los mensajes de contacto se borran a los 12 meses.

## Estructura

```
server/
  src/
    server.ts            API HTTP
    worker.ts            tareas programadas
    migrate.ts           migraciones
    config.ts            variables de entorno
    lib/                 disponibilidad, fechas, validación, cifrado, HTTP
    modules/             citas, clases, pacientes, catálogo, Google, WhatsApp, cola, auth
    routes/              API pública, panel y webhooks
    scripts/             seed (datos iniciales) y create-admin
  migrations/            esquema SQL
  test/                  pruebas automáticas
web/
  src/pages/             páginas (contenido editable)
  src/partials/          cabecera, pie y elementos comunes
  public/assets/         CSS, JS e imágenes
  build.mjs              genera web/dist
docs/                    guías de instalación, Google, WhatsApp, pruebas y actualización
Dockerfile · docker-compose.yml · Caddyfile · .env.example
```

## Puesta en marcha

0. [Demo gratis en Netlify + Render (sin VPS ni dominio)](docs/DEMO_NETLIFY.md)
1. [Instalación en la VPS](docs/INSTALACION.md)
2. [Conectar Google Calendar](docs/GOOGLE_CALENDAR.md)
3. [Configurar WhatsApp y plantillas](docs/WHATSAPP.md)
3. [Pago de señal online con Stripe](docs/PAGOS.md)
4. [Pruebas](docs/PRUEBAS.md)
5. [Actualizar la web](docs/ACTUALIZAR.md)

## Desarrollo en local (sin Docker)

Requisitos: Node.js 22.18 o superior y PostgreSQL 16.

```bash
npm install
cp .env.example .env    # pon NODE_ENV=development, DATABASE_URL local, PUBLIC_BASE_URL=http://localhost:3000, WHATSAPP_PROVIDER=log
npm run seed            # migraciones + datos iniciales
npm run create-admin -- tu@correo.es "Tu nombre"
npm run build:web       # genera web/dist
npm run dev             # API + web en http://localhost:3000
npm run worker          # en otra terminal
```

`npm run build:demo` genera una versión de demostración sin servidor (`web/dist-demo`) con datos ficticios en el navegador. Sirve para enseñar la web antes de instalarla.

## Lo que el centro debe revisar antes de publicar

- La **política de privacidad** (`web/src/pages/privacidad.html`) está preparada como plantilla, con los datos legales pendientes marcados.
- El **horario de clases** se ha cargado a partir del publicado en la web actual. Revisa en el panel que siga vigente.
- Los **especialistas** se dan de alta en el panel con su nombre, foto, servicios y horario reales. Solo se crea la ficha de la Dra. Emilia Pérez, desactivada hasta confirmar sus horas.
- Las **fotografías** son las que proporcionó el centro. Se pueden sustituir en `web/public/assets/img/` por otras de mayor resolución.
