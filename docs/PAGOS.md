# Pago de señal online (Stripe)

Al reservar **desde la web** un servicio **con precio**, el paciente paga una **señal del 40 %** con tarjeta, Apple Pay o Google Pay en la página segura de Stripe. Sirve para reducir las citas a las que el paciente no se presenta.

## Cómo funciona

1. El paciente elige servicio, especialista y hora, y rellena sus datos. En el último paso ve el precio, la señal y lo que pagará en el centro.
2. Al pulsar **Pagar señal**, la hora queda **reservada 30 minutos** y se abre la página de pago de Stripe.
3. **Si paga:** vuelve a «Gestionar mi cita» con el mensaje «¡Pago recibido!». La cita queda confirmada, aparece en Google Calendar y se envían la confirmación y los recordatorios por WhatsApp.
4. **Si no paga** en esos 30 minutos, la reserva se cancela sola y la hora vuelve a estar libre. Mientras tanto puede volver a intentar el pago desde su enlace.
5. **Si cancela** desde su enlace (solo se permite con 12 h o más de antelación, según la configuración), **se le devuelve la señal automáticamente**.
6. Si el centro cancela desde el panel, la señal **no** se devuelve sola: en la ficha de la cita aparece el botón **Devolver señal** (solo para administradores).

No hay pago en: reservas hechas desde el panel o por teléfono, clases de grupo y servicios sin precio.

El porcentaje (40 %) y los minutos de reserva (30) están en `server/src/modules/settings.ts` (`payments`). Stripe no admite cobros de menos de 0,50 €.

## Configuración

1. Crea una cuenta en <https://dashboard.stripe.com/register> (gratis).
2. Para la demo, deja activado **Modo de prueba** (arriba a la derecha) y copia la **clave secreta** en *Desarrolladores → Claves de API* (`sk_test_…`).
3. Ponla en la variable `STRIPE_SECRET_KEY` del servidor (Render → Environment, o el `.env` de la VPS) y reinicia.
4. En el panel, en **Servicios**, pon el **precio** de cada servicio. Solo los servicios con precio piden señal.

En modo de prueba no se cobra nada: se paga con la tarjeta `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.

**Para cobrar de verdad**, el centro tiene que activar su cuenta de Stripe (datos fiscales y cuenta bancaria del centro) y usar la clave `sk_live_…`. Stripe cobra una comisión por pago (en Europa, alrededor del 1,5 % + 0,25 € con tarjetas europeas; consulta la tarifa vigente en stripe.com/es/pricing).

No hace falta configurar webhooks: el servidor consulta a Stripe el estado de cada pago al volver el paciente y al terminar el plazo.
