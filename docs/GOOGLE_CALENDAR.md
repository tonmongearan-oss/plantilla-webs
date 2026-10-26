# Conectar Google Calendar

Cada especialista se vincula a un calendario de Google. A partir de ese momento:

- Cada cita reservada (en la web, en el panel o por el asistente) **crea un evento** en su calendario, con el servicio, el nombre y el teléfono del paciente.
- Si la cita **cambia de hora**, se actualiza el mismo evento. Si se **cancela**, se borra.
- Los **eventos propios** del especialista (reuniones, citas personales, días completos) **bloquean** esas horas en la reserva online.
- Si Google no responde en el momento de reservar, no se acepta la reserva para no arriesgar un duplicado (`GOOGLE_BUSY_FAIL_OPEN=false`).

Se usa la API oficial de Google Calendar v3 con OAuth 2.0. Los tokens se guardan cifrados en la base de datos.

## 1. Crear el proyecto en Google Cloud

1. Entra en <https://console.cloud.google.com/> con la cuenta de Google del centro.
2. Arriba, **Seleccionar proyecto → Proyecto nuevo**. Nombre: `Postural Web`.
3. Menú **APIs y servicios → Biblioteca**, busca **Google Calendar API** y pulsa **Habilitar**.

## 2. Pantalla de consentimiento de OAuth

**APIs y servicios → Pantalla de consentimiento de OAuth** (en la consola nueva: *Google Auth Platform → Branding / Audiencia / Acceso a datos*):

- **Tipo de usuario:**
  - **Interno** si el centro usa **Google Workspace** y todos los calendarios son del mismo dominio. Es la opción más sencilla: no hace falta verificación de Google.
  - **Externo** si los especialistas usan cuentas `@gmail.com`.
- Nombre de la aplicación: `Postural Centro Sanitario`. Correo de asistencia y dominio autorizado: el de la web.
- **Permisos (scopes):** añade
  - `.../auth/calendar.events`
  - `.../auth/calendar.readonly`
  - `openid` y `email`
- Si es **Externo**:
  - Mientras esté en modo **Prueba**, añade como *usuarios de prueba* las cuentas de los especialistas. **Atención:** en modo Prueba los permisos caducan a los 7 días y habría que reconectar.
  - Para uso real pulsa **Publicar aplicación**. Google puede pedir una verificación porque los permisos de calendario son *sensibles*. Hasta que verifique, al conectar aparecerá el aviso «Google no ha verificado esta aplicación» y se puede continuar con *Configuración avanzada → Ir a Postural*. Para un centro con pocas cuentas propias es suficiente.

## 3. Crear las credenciales

**APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:

- Tipo: **Aplicación web**.
- **URI de redirección autorizados:** `https://www.tudominio.es/api/admin/google/callback` (exactamente igual que `GOOGLE_REDIRECT_URI` del `.env`).
- Copia el **ID de cliente** y el **secreto** en el `.env`:

```
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
GOOGLE_REDIRECT_URI=https://www.tudominio.es/api/admin/google/callback
```

Aplica los cambios: `docker compose up -d app worker`.

## 4. Vincular el calendario de cada especialista

1. Entra al panel con un usuario **admin** → **Especialistas → Editar**.
2. En **Google Calendar**, pulsa **Conectar con Google** e inicia sesión con la cuenta que tiene el calendario.
3. Al volver al panel, elige el **calendario** (el principal o uno creado para la agenda del centro) y pulsa **Usar este calendario**.
4. Las citas futuras de ese especialista se sincronizan en segundo plano en menos de un minuto.

Una misma cuenta de Google puede tener varios calendarios. Si todos los especialistas comparten una cuenta del centro, crea un calendario por especialista y elige el suyo a cada uno.

## Comprobar que funciona

1. Reserva una cita de prueba en la web con ese especialista.
2. En menos de un minuto aparece el evento en su Google Calendar.
3. Crea en Google Calendar un evento personal en una hora libre: esa hora deja de ofrecerse en la web (puede tardar hasta 1 minuto por la caché).
4. Cancela la cita desde el panel: el evento desaparece.

En la ficha de cada cita del panel se ve el estado: *Sincronizada*, *Pendiente*, *Sin calendario* o *Error*.

## Problemas habituales

| Síntoma | Causa y solución |
|---|---|
| `redirect_uri_mismatch` al conectar | La URI registrada en Google no coincide con `GOOGLE_REDIRECT_URI`. Deben ser idénticas, con `https`. |
| La cuenta aparece como «Hay que reconectar» | El permiso se revocó o caducó (modo Prueba). Pulsa **Reconectar** en la ficha del especialista. |
| «Google no ha devuelto permiso sin conexión» | Quita el acceso de la app en <https://myaccount.google.com/permissions> y vuelve a conectar. |
| Las reservas fallan con «No podemos comprobar la agenda» | Google no responde o se ha superado la cuota. Revisa `docker compose logs app`. |

Si alguien borra a mano un evento en Google, la cita sigue en el panel (la base de datos es la referencia). Si se cambia la cita desde el panel, el evento se vuelve a crear.
