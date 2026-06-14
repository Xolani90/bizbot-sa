import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { verifySignature, parseInboundMessage } from '../lib/whatsapp';
import { routeMessage } from '../flows/router';

export const whatsappWebhookRouter = Router();

/**
 * Meta calls this once when the webhook URL is configured in the App
 * Dashboard, to confirm ownership of the endpoint.
 */
whatsappWebhookRouter.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.whatsappVerifyToken) {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

/**
 * Receives inbound WhatsApp messages and status updates (delivered/read
 * receipts). Responds 200 immediately — Meta retries aggressively on
 * slow or failed responses, and message processing involves AI + DB
 * round trips — then processes the message asynchronously.
 */
whatsappWebhookRouter.post('/', (req: Request, res: Response) => {
  const signature = req.header('x-hub-signature-256');

  if (!verifySignature(req.rawBody, signature)) {
    res.sendStatus(401);
    return;
  }

  res.sendStatus(200);

  const message = parseInboundMessage(req.body);
  if (message) {
    routeMessage(message).catch((err) => {
      console.error('Failed to process WhatsApp webhook message', err);
    });
  }
});
