# Pruebas

## Pruebas automáticas

Las pruebas usan una base de datos PostgreSQL real **dedicada a pruebas: se borra entera en cada ejecución**. Las llamadas a Google y a WhatsApp van a servidores locales que imitan sus APIs (mismas rutas y formatos), así que no se envían mensajes ni se tocan calendarios reales.

### En local

```bash
createdb postural_test
TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/postural_test npm test
```

### En la VPS (con Docker)

```bash
docker compose exec db createdb -U postural postural_test
docker compose run --rm -e TEST_DATABASE_URL=postgres://postural:TU_CLAVE@db:5432/postural_test app \
  node --test --test-concurrency=1 "server/test/*.test.ts"
```

### Qué comprueban (46 pruebas)

**Disponibilidad**
- Franjas por especialista, pausas, días libres y vacaciones.
- Las citas largas bloquean todas las franjas que solapan.
- Antelación mínima.
- Cambio de hora de verano e invierno.
- Teléfonos en formato internacional.

**Reservas**
1. Reserva con el especialista A.
2. La cita aparece en el panel.
3. La misma hora con A queda bloqueada, también las franjas solapadas.
4. La misma hora con el especialista B sí se puede reservar.
5. Cancelar desde el panel libera la hora.
6. Cambiar el horario de un especialista se refleja en la web.

Además:
- Ocho reservas simultáneas a la misma hora: solo entra una.
- Consentimiento de privacidad y campo antispam.
- El paciente cambia y cancela con su enlace, respetando el plazo mínimo.

**Clases**
7. Una plaza reservada reduce las libres.
8. Al llegar al aforo no se admiten más, aunque lleguen a la vez. No se puede reservar dos veces la misma clase.

**Google Calendar**
- OAuth: el token se guarda cifrado y el `state` solo vale una vez.
- Una reserva crea el evento; un cambio de hora lo actualiza; una cancelación lo borra.
- Los eventos personales, incluidos los de día completo, bloquean la agenda.
- Si Google falla, se rechaza la reserva.
- Se renueva el token caducado.

**WhatsApp**
- Plantilla de confirmación con variables y botón.
- Recordatorios programados a 24 h y 2 h, que se envían a su hora.
- Si la cita cambia, se anulan los recordatorios antiguos.
- Al cancelar se envía el aviso.
- Sin consentimiento no se envía nada.
- Webhook: firma, estado de entrega y bajas con BAJA.
- Reintento tras un error temporal.
- Twilio: envío y verificación de firma.

**Panel**
- Inicio y cierre de sesión.
- Protección CSRF.
- Permisos de los usuarios `staff`.
- Configuración.
- Alta, edición y baja de pacientes.

## Prueba manual tras instalar (10 minutos)

1. Abre la web en el móvil y en el ordenador: revisa las páginas y el menú.
2. En el panel, da de alta un especialista con su horario y vincula su Google Calendar.
3. Reserva en la web una cita con ese especialista marcando WhatsApp con tu móvil:
   - recibes la confirmación por WhatsApp;
   - aparece el evento en su Google Calendar;
   - aparece en el panel (Agenda).
4. Intenta reservar la misma hora en otra ventana: aparece como ocupada.
5. Abre el enlace «Gestionar mi cita» del WhatsApp y cámbiala de hora: se actualiza el evento y recibes el aviso.
6. **Recordatorio:** para probarlo sin esperar 24 h, reserva una cita para dentro de unas 3 horas. El recordatorio de 2 h llegará a su hora.
7. Cancela desde el panel: el evento desaparece de Google y recibes el aviso de cancelación.
8. Reserva una plaza en una clase y comprueba en **Horarios y disponibilidad** que bajan las plazas.
