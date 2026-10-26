# Demo funcionando en Netlify + Render, sin VPS ni dominio

```
Cliente ──▶ postural-demo.netlify.app (Netlify: la web)
                │  /api/*  /webhooks/*  (Netlify lo reenvía)
                ▼
          postural-api.onrender.com (Render: API + recordatorios + PostgreSQL)
                ├──▶ Google Calendar
                └──▶ WhatsApp (Meta)
```

Todo gratis. Límites del plan gratuito, que para una demo no importan:
- **Render se duerme** tras 15 min sin visitas (tarda unos 30-50 s en despertar). Mientras duerme no salen recordatorios. Solución en el paso 6.
- **La base de datos gratuita de Render caduca a los 30 días.** Si el cliente dice que sí, se pasa a la VPS con `docker compose` (ya preparado).

Necesitas una cuenta de GitHub (gratis): Netlify y Render cogen el código de ahí.

---

## 1. Subir el código a GitHub

1. Crea un repositorio **privado** en <https://github.com/new>, por ejemplo `postural-web`.
2. Pulsa *uploading an existing file* y arrastra el **contenido** de la carpeta `postural-app` (no la carpeta en sí; sin `node_modules` ni `.env`). *Commit changes*.

## 2. Netlify: la web

1. <https://app.netlify.com> → **Add new site → Import an existing project → GitHub** → elige `postural-web`.
2. Netlify lee `netlify.toml` solo (build `node web/build.mjs`, carpeta `web/dist`). Pulsa **Deploy**.
3. **Site configuration → Change site name** → `postural-demo`. Tu web queda en `https://postural-demo.netlify.app`.
   (Si ese nombre está cogido usa otro y sustitúyelo en todo lo que sigue.)

## 3. Render: API, recordatorios y base de datos

1. <https://dashboard.render.com> → **New → Blueprint** → conecta GitHub y elige `postural-web`. Render lee `render.yaml`.
2. Te pide estas variables:

| Variable | Valor |
|---|---|
| `PUBLIC_BASE_URL` | `https://postural-demo.netlify.app` |
| `GOOGLE_REDIRECT_URI` | `https://postural-demo.netlify.app/api/admin/google/callback` |
| `ADMIN_EMAIL` | tu correo (para entrar al panel) |
| `ADMIN_PASSWORD` | contraseña de 12 caracteres o más |
| `WHATSAPP_PROVIDER` | `disabled` de momento (en el paso 5 lo cambias a `meta`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | déjalas vacías de momento (paso 4) |
| `META_WA_*` | vacías de momento (paso 5) |

3. **Apply**. Al terminar, comprueba que la URL del servicio es `https://postural-api.onrender.com`. Si es otra, cámbiala en los dos `[[redirects]]` de `netlify.toml` en GitHub (Netlify se vuelve a publicar solo).
4. Prueba: abre `https://postural-demo.netlify.app/api/health`. Debe responder con un JSON.
5. Entra en `https://postural-demo.netlify.app/admin/` con tu correo y contraseña. **Da de alta al menos un especialista** con servicios y horario (si no, no hay horas para reservar).

> `ENCRYPTION_KEY` la genera Render. No la cambies después o habrá que reconectar Google.

## 4. Google Calendar: la cita va directa al calendario

Sigue `docs/GOOGLE_CALENDAR.md` con estas diferencias:

- Tipo de usuario: **Externo**, y déjalo en modo **Prueba**. En *Usuarios de prueba* añade la cuenta de Gmail cuyo calendario vas a usar (la tuya para la demo).
- **URI de redirección autorizado:** `https://postural-demo.netlify.app/api/admin/google/callback`
- Pega el ID y el secreto en Render → `postural-api` → **Environment** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) → *Save changes* (se reinicia solo).
- En el panel: **Especialistas → Editar → Conectar con Google** → elige el calendario.
- Al conectar saldrá «Google no ha verificado esta aplicación» → *Configuración avanzada → Ir a…*. Normal en modo Prueba.
- En modo Prueba el permiso caduca a los **7 días**: si la demo es más tarde, vuelve a pulsar *Conectar con Google* el día antes.

## 5. WhatsApp: confirmación y recordatorios

Para la demo usa el **número de prueba gratuito de Meta**. No necesitas el número del centro ni verificar la empresa.

1. <https://developers.facebook.com/apps> → **Crear app → Empresa** → añade el producto **WhatsApp**.
2. En *WhatsApp → Configuración de la API* ya tienes un **número de prueba**. En **Para (To)** añade y verifica los móviles que recibirán mensajes: el tuyo y, si quieres, el del dueño del centro (máximo 5).
3. Crea las 4 plantillas de `docs/WHATSAPP.md` en *WhatsApp Manager → Plantillas*, cambiando `https://www.tudominio.es` por `https://postural-demo.netlify.app` en el botón. Espera a que estén **Aprobadas**.
4. Token permanente: *Configuración del negocio → Usuarios del sistema → Añadir* (admin) → **Generar token** con permisos `whatsapp_business_messaging` y `whatsapp_business_management`. (El token temporal de la página de la API caduca en 24 h.)
5. En Render → Environment:
   - `WHATSAPP_PROVIDER` = `meta`
   - `META_WA_PHONE_NUMBER_ID` = el *Phone number ID* del número de prueba
   - `META_WA_ACCESS_TOKEN` = el token permanente
   - `META_WA_APP_SECRET` = *Configuración de la app → Básica → Clave secreta*
   - `META_WA_VERIFY_TOKEN` = un texto que inventes
6. (Opcional, solo para la baja con «BAJA») Webhook en *WhatsApp → Configuración*: URL `https://postural-demo.netlify.app/webhooks/whatsapp/meta`, el mismo verify token, suscríbete a `messages`.

## 6. Que no se duerma (para que los recordatorios salgan a su hora)

Crea un monitor gratuito en <https://uptimerobot.com> → **HTTP(s)** → URL `https://postural-api.onrender.com/api/health` → cada **5 minutos**. Así Render no se duerme nunca (el plan gratis da horas suficientes para un servicio 24/7).

Antes de la reunión abre la web una vez igualmente.

## 7. Guion para enseñarlo al cliente

1. Reserva desde el móvil en `postural-demo.netlify.app/reservar` marcando la casilla de WhatsApp, con un número de los verificados en el paso 5.
2. En segundos: llega la **confirmación por WhatsApp** y aparece el **evento en Google Calendar**.
3. Para enseñar el **recordatorio** en directo: reserva una cita para dentro de **2 h y 10 min**. El recordatorio de «2 h antes» llega a los 10 minutos.
4. Abre el enlace «Gestionar mi cita» del WhatsApp, cambia la hora y verás que el evento se mueve en el calendario.
5. Enséñale el panel en `/admin/`.

## Cuando el cliente diga que sí

Compras dominio y VPS y sigues `docs/INSTALACION.md`. Allí cambias en Google Cloud la URI de redirección al dominio real, y en Meta pasas al número del centro y la empresa verificada.
