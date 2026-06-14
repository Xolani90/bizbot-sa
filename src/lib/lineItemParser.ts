/**
 * Natural language line item parser.
 * "2x tyres R850 each, labour R300" → [{description, quantity, unitPrice, amount}]
 *
 * Uses Claude Haiku for the parsing — faster and cheaper than Sonnet
 * for this structured extraction task.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

const SYSTEM_PROMPT = `You are a line item extractor for South African business invoices and quotes.
Extract line items from natural language text.

Return ONLY a JSON array with this shape (no preamble or markdown):
[
  {
    "description": "string",
    "quantity": number,
    "unitPrice": number,
    "amount": number
  }
]

Rules:
- Prices in South African Rand (R or ZAR prefix)
- If no quantity is specified, default to 1
- amount = quantity * unitPrice
- If only a total is given (no unit price), set unitPrice = amount / quantity
- "each" or "ea" means per unit
- If parsing fails, return []`;

export async function parseLineItems(
  text: string,
  _businessName: string
): Promise<{ items: LineItem[]; error: string | null }> {
  // First try a quick regex parse for simple cases
  const quick = quickParse(text);
  if (quick.length > 0) {
    return { items: quick, error: null };
  }

  // Fall back to Claude for complex natural language
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    });

    const raw =
      response.content.find((b) => b.type === 'text') && 'text' in response.content[0]
        ? (response.content[0] as { type: 'text'; text: string }).text.trim()
        : '[]';

    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed: LineItem[] = JSON.parse(clean);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { items: [], error: 'No line items found' };
    }

    return { items: parsed, error: null };
  } catch (err) {
    console.error('Line item parse error:', err);
    return { items: [], error: 'Parse failed' };
  }
}

/**
 * Regex-based quick parser for common formats like:
 * "Haircut R120, Wash R50"
 * "Labour R300"
 * "2x tyres R850 each"
 */
function quickParse(text: string): LineItem[] {
  const items: LineItem[] = [];

  // Split by comma or semicolon
  const segments = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);

  for (const seg of segments) {
    // Pattern: optional qty, description, price
    const match = seg.match(
      /^(?:(\d+)\s*x\s*)?([^R\d]+?)\s+R\s?(\d+(?:[.,]\d+)?)(?:\s+each)?$/i
    );

    if (match) {
      const qty = match[1] ? parseInt(match[1]) : 1;
      const desc = match[2].trim();
      const unitPrice = parseFloat(match[3].replace(',', '.'));

      if (desc && !isNaN(unitPrice)) {
        items.push({
          description: desc,
          quantity: qty,
          unitPrice,
          amount: qty * unitPrice,
        });
      }
    }
  }

  return items;
}
