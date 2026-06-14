import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { IntentLabel, IntentResult } from '../types';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const INTENT_LABELS: IntentLabel[] = [
  'booking_request',
  'quote_command',
  'invoice_command',
  'payment_record',
  'expense_log',
  'marketing_request',
  'report_request',
  'general_query',
];

const SYSTEM_PROMPT = `You are the intent classifier for BizBot SA, a WhatsApp business
assistant used by South African micro-business owners (salons, barbers,
plumbers, tutors, mechanics, etc).

Classify the owner's message into exactly one of these intents:
${INTENT_LABELS.map((l) => `- ${l}`).join('\n')}

Also extract any obvious entities (customer name, amounts, dates, service
names, line items) into a flat JSON object. If nothing is extractable,
return an empty object.

Respond with ONLY a JSON object, no preamble or markdown fencing, in this
exact shape:
{"intent": "<one of the labels above>", "confidence": <number 0-1>, "entities": { ... }}`;

/**
 * Classifies an inbound business-owner message using Claude Haiku — the
 * "fast + cheap" model referenced in the architecture for the intent
 * parsing step. Falls back to 'general_query' with confidence 0 on any
 * parsing failure so the router always has something to act on.
 */
export async function classifyIntent(messageText: string): Promise<IntentResult> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: messageText }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const raw = textBlock && 'text' in textBlock ? textBlock.text : '';

  try {
    const parsed = JSON.parse(raw.trim());
    if (INTENT_LABELS.includes(parsed.intent)) {
      return {
        intent: parsed.intent as IntentLabel,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        entities: typeof parsed.entities === 'object' && parsed.entities !== null ? parsed.entities : {},
      };
    }
  } catch {
    // Fall through to the default below — malformed AI output should
    // never crash the message router.
  }

  return { intent: 'general_query', confidence: 0, entities: {} };
}
