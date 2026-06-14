/**
 * Marketing writer — handles marketing_request intents.
 *
 * "Write a WhatsApp blast for my weekend sale — 20% off all cuts"
 * "Create a promotion for Mother's Day specials"
 *
 * Uses Claude Sonnet (not Haiku) for quality copy.
 * Sends back 2 variations so the owner can pick.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { sendTextMessage } from '../lib/whatsapp';
import { Business } from '../types';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

export async function handleMarketingRequest(
  business: Business,
  text: string
): Promise<void> {
  await sendTextMessage(
    business.whatsapp_number,
    `✍️ Writing your marketing copy... give me a moment.`
  );

  const businessContext = [
    business.name ? `Business: ${business.name}` : null,
    business.type ? `Type: ${business.type}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const systemPrompt = `You are a marketing copywriter for South African micro-businesses. 
You write WhatsApp promotional messages that are:
- Conversational and warm (South African friendly tone)  
- Short (under 150 words each)
- Action-oriented with a clear call to action
- Include relevant emojis sparingly
- Written in plain English (no Markdown bold/italic — WhatsApp only)

Context: ${businessContext}

Generate exactly 2 different promotional message variations. 
Separate them with "---" on its own line.
No numbering or labels — just the two messages.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const raw =
      response.content.find((b) => b.type === 'text') &&
      'text' in response.content[0]
        ? (response.content[0] as { type: 'text'; text: string }).text
        : '';

    const parts = raw.split(/^---$/m).map((p) => p.trim()).filter(Boolean);

    if (parts.length >= 2) {
      await sendTextMessage(
        business.whatsapp_number,
        `Here are 2 options for your message:\n\n` +
          `*Option 1:*\n${parts[0]}\n\n` +
          `*Option 2:*\n${parts[1]}\n\n` +
          `Copy the one you like and send it to your customers! 🚀`
      );
    } else if (parts.length === 1) {
      await sendTextMessage(
        business.whatsapp_number,
        `Here's your marketing message:\n\n${parts[0]}\n\nFeel free to edit before sending!`
      );
    } else {
      throw new Error('No content returned');
    }
  } catch (err) {
    console.error('Marketing writer error:', err);
    await sendTextMessage(
      business.whatsapp_number,
      `Sorry, I had trouble writing that. Please try rephrasing your request.`
    );
  }
}
