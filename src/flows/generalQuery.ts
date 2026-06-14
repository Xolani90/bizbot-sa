/**
 * General query handler — handles general_query intents and unknown commands.
 *
 * Uses Claude to provide a helpful response, with full context of the
 * business and available commands. Also handles the MENU command.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { sendTextMessage } from '../lib/whatsapp';
import { Business } from '../types';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const MENU_MESSAGE = `*BizBot SA — Menu* 📱

*Bookings*
• "Book Thabo for haircut tomorrow 2pm"
• "Cancel Sipho's booking"

*Quotes & Invoices*
• "Quote for Sipho — 2x tyres R850 each, labour R300"
• "Invoice for Mary — 2h tutoring R400"

*Payments & Expenses*
• "Thabo paid R300"
• "Spent R200 on supplies"

*Marketing*
• "Write a promo for my weekend sale — 20% off"

*Reports*
• "Report" or "How did I do this week?"

*Help*
• "MENU" — show this menu
• "HELP" — ask me anything

Reply with any of the above to get started! 🚀`;

export async function handleGeneralQuery(
  business: Business,
  text: string
): Promise<void> {
  const upper = text.trim().toUpperCase();

  if (upper === 'MENU' || upper === 'HELP' || upper === 'HI' || upper === 'HELLO') {
    await sendTextMessage(business.whatsapp_number, MENU_MESSAGE);
    return;
  }

  // Use Claude to answer business-related questions conversationally
  const systemPrompt = `You are BizBot SA, a WhatsApp business assistant for South African micro-businesses.
You are talking to the owner of "${business.name || 'a business'}" (type: ${business.type || 'general'}).

You help with:
- Bookings and appointments
- Quotes and invoices  
- Expense tracking
- Payment recording
- Marketing copy
- Business reports

Keep responses SHORT (under 100 words), conversational, and helpful.
If the user seems to want a feature, guide them to use the right command.
If it's a general business question, answer it briefly.
Never use markdown bold/italic — this is WhatsApp plain text.
End with "Reply MENU for all commands." if appropriate.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const reply =
      response.content.find((b) => b.type === 'text') && 'text' in response.content[0]
        ? (response.content[0] as { type: 'text'; text: string }).text
        : `I'm not sure how to help with that. Reply MENU to see what I can do!`;

    await sendTextMessage(business.whatsapp_number, reply);
  } catch {
    await sendTextMessage(
      business.whatsapp_number,
      `I'm not sure how to help with that. Reply MENU to see what I can do!`
    );
  }
}
