import crypto from 'crypto';
import { env } from '../config/env';
import { InboundMessage } from '../types';

const GRAPH_API_VERSION = 'v20.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Sends a plain text WhatsApp message via the Cloud API.
 */
export async function sendTextMessage(to: string, body: string): Promise<void> {
  const url = `${GRAPH_BASE_URL}/${env.whatsappPhoneNumberId}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.whatsappToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body, preview_url: false },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${errorBody}`);
  }
}

/**
 * Verifies the X-Hub-Signature-256 header against the raw request body
 * using the Meta App Secret. Returns true (and skips verification) if
 * WHATSAPP_APP_SECRET isn't configured — useful for local development,
 * but should always be set in production.
 */
export function verifySignature(rawBody: Buffer, signatureHeader?: string): boolean {
  if (!env.whatsappAppSecret) {
    return true;
  }
  if (!signatureHeader) {
    return false;
  }

  const expected = crypto.createHmac('sha256', env.whatsappAppSecret).update(rawBody).digest('hex');
  const provided = signatureHeader.replace('sha256=', '');

  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');

  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Extracts the first message from a WhatsApp Cloud API webhook payload,
 * if present. Returns null for status-update payloads (delivered/read
 * receipts) or anything without a `messages` array.
 */
export function parseInboundMessage(payload: unknown): InboundMessage | null {
  const entry = (payload as Record<string, unknown> | undefined)?.entry as unknown[] | undefined;
  const change = (entry?.[0] as Record<string, unknown> | undefined)?.changes as
    | unknown[]
    | undefined;
  const value = (change?.[0] as Record<string, unknown> | undefined)?.value as
    | Record<string, unknown>
    | undefined;
  const messages = value?.messages as Record<string, unknown>[] | undefined;
  const message = messages?.[0];

  if (!message) return null;

  const textBody =
    message.type === 'text'
      ? ((message.text as Record<string, unknown> | undefined)?.body as string | undefined)
      : undefined;

  return {
    from: message.from as string,
    id: message.id as string,
    timestamp: message.timestamp as string,
    type: message.type as string,
    text: textBody,
    raw: message,
  };
}
