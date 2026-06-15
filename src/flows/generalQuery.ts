/**
 * General query handler — MENU, HELP, and AI catch-all.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { sendTextMessage } from '../lib/whatsapp';
import { Business } from '../types';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const MENU_MESSAGE = `*BizBot SA* 🤖

*📅 Bookings*
• "Book Thabo for haircut tomorrow 2pm"

*📋 Quotes & Invoices*
• "Quote for Sipho — 2x tyres R850, labour R300"
• "Invoice for Mary — 2h tutoring R400"

*💸 Payments & Expenses*
• "Thabo paid R300 for INV-0001"
• "Spent R200 on supplies"

*✍️ Marketing*
• "Write a promo for 20% off this weekend"

*📊 Reports*
• "Report" or "How did I do this week?"

*⚙️ Other*
• MENU — show this menu
• RESET — cancel current action
• UPGRADE — see plan options`;

export async function handleGeneralQuery(
  business: Business,
  text: string
): Promise<void> {
  const upper = text.trim().toUpperCase();

  if (upper === 'MENU' || upper === 'HELP' || upper === 'HI' || upper === 'HELLO' || upper === 'HEY') {
    await sendTextMessage(business.whatsapp_number, MENU_MESSAGE);
    return;
  }

  const systemPrompt = `You are BizBot SA, a WhatsApp business assistant for South African micro-businesses.
You are helping the owner of "${business.name || 'a business'}" (type: ${business.type || 'general'}).

You help with bookings, quotes, invoices, expenses, payments, marketing copy, and business reports.
Keep responses SHORT (under 100 words), warm, and helpful.
Guide users to the right command if they seem to want a feature.
Never use Markdown — this is WhatsApp plain text.
If relevant, end with "Reply MENU to see all commands."`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const reply = textBlock && 'text' in textBlock
      ? textBlock.text
      : `I'm not sure how to help with that. Reply MENU to see what I can do!`;

    await sendTextMessage(business.whatsapp_number, reply);
  } catch {
    await sendTextMessage(
      business.whatsapp_number,
      `I'm not sure how to help with that. Reply MENU to see what I can do!`
    );
  }
}
