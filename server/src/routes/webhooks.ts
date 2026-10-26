/* Webhooks de WhatsApp (Meta y Twilio): estado de los mensajes y bajas. */
import { Router, json, HANDLED } from '../lib/http.ts';
import { config } from '../config.ts';
import { forbidden } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import * as wa from '../modules/whatsapp.ts';

export const webhookRouter = new Router();

// Verificación de la suscripción (Meta llama con hub.challenge)
webhookRouter.get('/webhooks/whatsapp/meta', ctx => {
  const q = ctx.query;
  if (q.get('hub.mode') === 'subscribe' && config.whatsapp.meta.verifyToken && q.get('hub.verify_token') === config.whatsapp.meta.verifyToken) {
    ctx.res.writeHead(200, { 'content-type': 'text/plain' });
    ctx.res.end(q.get('hub.challenge') || '');
    return HANDLED;
  }
  throw forbidden('Token de verificación incorrecto');
});

webhookRouter.post('/webhooks/whatsapp/meta', async ctx => {
  if (!wa.verifyMetaSignature(ctx.rawBody, ctx.req.headers['x-hub-signature-256'] as string | undefined)) {
    log.warn('webhook de Meta con firma no válida');
    throw forbidden('Firma no válida');
  }
  const body = JSON.parse(ctx.rawBody.toString('utf8') || '{}');
  await wa.handleMetaWebhook(body);
  json(ctx.res, 200, { ok: true });
  return HANDLED;
});

webhookRouter.post('/webhooks/whatsapp/twilio', async ctx => {
  const url = `${config.publicBaseUrl}${ctx.req.url}`;
  if (!wa.verifyTwilioSignature(url, ctx.body, ctx.req.headers['x-twilio-signature'] as string | undefined)) {
    log.warn('webhook de Twilio con firma no válida');
    throw forbidden('Firma no válida');
  }
  await wa.handleTwilioWebhook(ctx.body);
  ctx.res.writeHead(200, { 'content-type': 'text/xml' });
  ctx.res.end('<Response></Response>');
  return HANDLED;
});
