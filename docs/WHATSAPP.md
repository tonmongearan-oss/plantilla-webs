# Recordatorios por WhatsApp

El sistema envía mensajes de WhatsApp con **plantillas aprobadas** a través de la API oficial: **WhatsApp Business Platform (Cloud API) de Meta** o **Twilio**. No depende de tener WhatsApp Web abierto. El worker los envía a su hora aunque nadie esté usando la web.

| Mensaje | Cuándo |
|---|---|
| Confirmación | Al reservar (cita o plaza en clase) |
| Recordatorio | 24 h antes y 2 h antes (configurable en el panel: 1 o 2 recordatorios) |
| Cita modificada | Cuando la cita cambia de hora (la cambie el paciente o el centro) |
| Cita cancelada | Cuando se cancela una cita futura |

## Consentimiento y bajas

- Solo se envían mensajes a quien **marca la casilla** de WhatsApp al reservar. La fecha del consentimiento queda guardada.
- Si el paciente responde **BAJA** (o STOP), se registra la baja y no recibe más mensajes. Desde el panel también se puede quitar el consentimiento en la ficha del paciente.
- Los mensajes incluyen un botón **«Gestionar mi cita»** con un enlace personal para cambiarla o cancelarla.
- Explica en la política de privacidad que usáis WhatsApp para recordatorios (la plantilla incluida ya lo menciona).

## Textos de las plantillas

Crea estas cuatro plantillas con categoría **Utilidad (Utility)** e idioma **Español (es)**. Los nombres deben coincidir con los del `.env`. Las variables `{{1}}`, `{{2}}`… se rellenan en este orden.

**`postural_cita_confirmada`**
```
Hola {{1}}, tu cita de {{2}} en Postural Centro Sanitario está registrada para el {{3}} a las {{4}} con {{5}}.
Si necesitas cambiarla o cancelarla, usa el botón de abajo. Para dejar de recibir mensajes, responde BAJA.
```
Variables: 1 nombre, 2 servicio, 3 fecha («lunes 3 de noviembre»), 4 hora, 5 profesional.
Botón: **Visitar sitio web**, tipo **dinámico**, texto «Gestionar mi cita», URL `https://www.tudominio.es/cita.html?t={{1}}`.

**`postural_recordatorio_cita`**
```
Hola {{1}}, te recordamos tu cita de {{2}} en Postural Centro Sanitario el {{3}} a las {{4}}.
{{5}}
```
Variables: 1 nombre, 2 servicio, 3 fecha, 4 hora, 5 instrucciones (texto configurable en el panel).
Botón: igual que el anterior.

**`postural_cita_modificada`**
```
Hola {{1}}, tu cita de {{2}} en Postural Centro Sanitario ha cambiado. Nueva fecha: {{3}} a las {{4}} con {{5}}.
```
Botón: igual que el anterior.

**`postural_cita_cancelada`**
```
Hola {{1}}, tu cita de {{2}} del {{3}} a las {{4}} en Postural Centro Sanitario se ha cancelado. Si quieres otra cita, puedes reservar en nuestra web o llamarnos.
```
Sin botón.

Meta revisa cada plantilla (normalmente en minutos u horas). Hasta que estén **aprobadas**, los envíos fallan y el worker los reintenta.

---

## Opción A · WhatsApp Business Platform de Meta (Cloud API)

1. **Cuenta de Meta Business:** crea o usa la del centro en <https://business.facebook.com> y verifica la empresa.
2. **App:** en <https://developers.facebook.com/apps> crea una app de tipo **Empresa** y añade el producto **WhatsApp**.
3. **Número:** en *WhatsApp → Configuración de la API* añade el número de teléfono del centro y verifícalo por SMS o llamada. Ese número **no puede estar en uso** en la app de WhatsApp normal ni en WhatsApp Business del móvil (hay que migrarlo o usar otro número).
4. **Token permanente:**
   - En *Configuración del negocio → Usuarios del sistema*, crea un usuario del sistema **Administrador**.
   - Asígnale la app y la cuenta de WhatsApp.
   - Genera un token con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. El token temporal de la página de pruebas caduca en 24 h: no lo uses en producción.
5. **Datos para el `.env`:**
   ```
   WHATSAPP_PROVIDER=meta
   META_WA_PHONE_NUMBER_ID=   # «Identificador del número de teléfono» en Configuración de la API
   META_WA_ACCESS_TOKEN=      # token permanente del usuario del sistema
   META_WA_APP_SECRET=        # Configuración de la app → Básica → Clave secreta
   META_WA_VERIFY_TOKEN=      # un texto largo inventado por ti
   ```
6. **Webhook** (estado de entrega y bajas): en *WhatsApp → Configuración*:
   - URL de devolución de llamada: `https://www.tudominio.es/webhooks/whatsapp/meta`
   - Token de verificación: el mismo `META_WA_VERIFY_TOKEN`
   - Pulsa **Verificar y guardar** y suscríbete al campo **messages**.
7. **Plantillas:** créalas en *Administrador de WhatsApp → Plantillas de mensajes* con los textos de arriba.
8. **Método de pago:** añádelo en la cuenta de WhatsApp. Meta cobra por mensaje de plantilla de utilidad según el país; consulta la tarifa vigente en la web de Meta.
9. Reinicia: `docker compose up -d app worker`.

## Opción B · Twilio

1. Crea una cuenta en <https://www.twilio.com> y, en *Messaging → Senders → WhatsApp senders*, registra el número del centro (Twilio guía el alta de la cuenta de WhatsApp Business).
2. En *Content Template Builder* crea las cuatro plantillas con los textos de arriba (tipo *Call to action* para las que llevan botón) y envíalas a aprobación de WhatsApp.
   - Variables numeradas `{{1}}`…`{{5}}` en el texto, en el mismo orden.
   - En el botón con URL dinámica usa la **siguiente variable**: `{{6}}` en confirmación, recordatorio y modificación (por ejemplo `https://www.tudominio.es/cita.html?t={{6}}`).
3. Copia el **Content SID** (`HX…`) de cada plantilla al `.env`:
   ```
   WHATSAPP_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_WHATSAPP_FROM=whatsapp:+34XXXXXXXXX
   TWILIO_CONTENT_SID_CONFIRMATION=HX...
   TWILIO_CONTENT_SID_REMINDER=HX...
   TWILIO_CONTENT_SID_CANCELLED=HX...
   TWILIO_CONTENT_SID_RESCHEDULED=HX...
   ```
4. En la configuración del número en Twilio, pon como webhook de mensajes entrantes `https://www.tudominio.es/webhooks/whatsapp/twilio` (método POST). Así funcionan las bajas por BAJA. Los estados de entrega llegan a la misma URL.
5. Reinicia: `docker compose up -d app worker`.

## Probar

- Panel → **Configuración → Integraciones → Enviar prueba** con tu móvil. Se envía la plantilla de recordatorio con datos de ejemplo.
- Reserva una cita de prueba en la web marcando la casilla de WhatsApp: recibirás la confirmación en segundos.
- **Ver últimos mensajes y errores** muestra el estado de cada envío (enviado, entregado, leído o error) y las tareas que están fallando.

## Problemas habituales

| Error | Causa |
|---|---|
| `132001 Template name does not exist in the translation` | El nombre o el idioma de la plantilla no coinciden, o aún no está aprobada. |
| `132000 Number of parameters does not match` | La plantilla tiene un número de variables distinto del indicado arriba. |
| `131047 Re-engagement message` | Se intentó un mensaje que no es de plantilla fuera de 24 h; aquí no debería ocurrir. |
| `190 Invalid OAuth access token` | Token caducado: usa un token de usuario del sistema. |
| Twilio `63016` | Plantilla no aprobada o variables incorrectas. |
