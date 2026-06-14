/**
 * WhatsApp document sender — uploads a buffer as a media object and sends
 * it as a document message.
 *
 * WhatsApp Cloud API two-step:
 *  1. POST /media  → get media_id
 *  2. POST /messages with type: document and the media_id
 */

import { env } from '../config/env';

const GRAPH_API_VERSION = 'v20.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export async function sendDocument(
  to: string,
  buffer: Buffer,
  filename: string,
  caption: string
): Promise<void> {
  // Step 1: upload media using multipart/form-data
  const boundary = `----FormBoundary${Date.now()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\napplication/pdf\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([preamble, buffer, epilogue]);

  const uploadRes = await fetch(
    `${GRAPH_BASE_URL}/${env.whatsappPhoneNumberId}/media`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.whatsappToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body: body as unknown as BodyInit,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`WhatsApp media upload failed (${uploadRes.status}): ${err}`);
  }

  const { id: mediaId } = (await uploadRes.json()) as { id: string };

  // Step 2: send document message
  const msgRes = await fetch(
    `${GRAPH_BASE_URL}/${env.whatsappPhoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { id: mediaId, filename, caption },
      }),
    }
  );

  if (!msgRes.ok) {
    const err = await msgRes.text();
    throw new Error(`WhatsApp send document failed (${msgRes.status}): ${err}`);
  }
}
