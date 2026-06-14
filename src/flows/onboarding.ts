import { supabase } from '../config/supabase';
import { sendTextMessage } from '../lib/whatsapp';
import { Business, BusinessType } from '../types';

const BUSINESS_TYPE_OPTIONS: { key: string; value: BusinessType; label: string }[] = [
  { key: '1', value: 'salon', label: 'Salon / nails / beauty' },
  { key: '2', value: 'barber', label: 'Barber' },
  { key: '3', value: 'plumber', label: 'Plumber' },
  { key: '4', value: 'mechanic', label: 'Mechanic' },
  { key: '5', value: 'tutor', label: 'Tutor' },
  { key: '6', value: 'other', label: 'Other' },
];

/**
 * Creates a brand-new business record for a WhatsApp number we haven't
 * seen before, and sends the first onboarding prompt. Called when
 * routeMessage() finds no matching `businesses` row for the sender.
 */
export async function startOnboarding(whatsappNumber: string): Promise<void> {
  const { error } = await supabase.from('businesses').insert({
    whatsapp_number: whatsappNumber,
    onboarding_status: 'in_progress',
    onboarding_step: 'awaiting_name',
  });

  if (error) throw error;

  await sendTextMessage(
    whatsappNumber,
    `👋 Welcome to *BizBot SA*!\n\n` +
      `I'll help you run your business from WhatsApp — bookings, quotes, ` +
      `invoices, reminders, and more.\n\n` +
      `Let's get you set up in under a minute. First, what's your business name?`
  );
}

/**
 * Advances a business through the onboarding state machine based on its
 * current `onboarding_step` and the latest inbound message text.
 */
export async function continueOnboarding(business: Business, messageText: string): Promise<void> {
  const text = messageText.trim();

  switch (business.onboarding_step) {
    case 'awaiting_name':
      await handleName(business, text);
      break;
    case 'awaiting_type':
      await handleType(business, text);
      break;
    case 'awaiting_service':
      await handleService(business, text);
      break;
    default:
      // Onboarding already completed (or in an unexpected state) —
      // nothing for this flow to do.
      break;
  }
}

async function handleName(business: Business, name: string): Promise<void> {
  if (!name) {
    await sendTextMessage(business.whatsapp_number, `What's your business called?`);
    return;
  }

  const { error } = await supabase
    .from('businesses')
    .update({ name, onboarding_step: 'awaiting_type' })
    .eq('id', business.id);

  if (error) throw error;

  const optionsText = BUSINESS_TYPE_OPTIONS.map((o) => `${o.key}. ${o.label}`).join('\n');

  await sendTextMessage(
    business.whatsapp_number,
    `Great, *${name}* it is 🎉\n\nWhat kind of business is it? Reply with a number:\n\n${optionsText}`
  );
}

async function handleType(business: Business, reply: string): Promise<void> {
  const choice = BUSINESS_TYPE_OPTIONS.find((o) => o.key === reply.trim());

  if (!choice) {
    await sendTextMessage(
      business.whatsapp_number,
      `Sorry, I didn't catch that — please reply with a number from 1 to 6.`
    );
    return;
  }

  const { error } = await supabase
    .from('businesses')
    .update({ type: choice.value, onboarding_step: 'awaiting_service' })
    .eq('id', business.id);

  if (error) throw error;

  await sendTextMessage(
    business.whatsapp_number,
    `Got it — ${choice.label} 👍\n\n` +
      `Last step: tell me one service you offer and how much you charge, e.g.\n\n` +
      `*"Haircut, R120, 30 min"*\n\n` +
      `You can add more services any time later.`
  );
}

async function handleService(business: Business, reply: string): Promise<void> {
  const parsed = parseServiceLine(reply);

  if (!parsed) {
    await sendTextMessage(
      business.whatsapp_number,
      `Hmm, I couldn't read that. Try the format:\n\n` +
        `*"Service name, Rprice, duration in minutes"*\n\n` +
        `For example: *"Haircut, R120, 30 min"*`
    );
    return;
  }

  const { error: serviceError } = await supabase.from('services').insert({
    business_id: business.id,
    name: parsed.name,
    price: parsed.price,
    duration_minutes: parsed.durationMinutes,
  });

  if (serviceError) throw serviceError;

  const { error: businessError } = await supabase
    .from('businesses')
    .update({ onboarding_status: 'completed', onboarding_step: 'completed' })
    .eq('id', business.id);

  if (businessError) throw businessError;

  await sendTextMessage(
    business.whatsapp_number,
    `✅ All set up!\n\n` +
      `*${business.name}* is now live on BizBot SA.\n\n` +
      `Added service: ${parsed.name} — R${parsed.price.toFixed(2)} (${parsed.durationMinutes} min)\n\n` +
      `You're on the *Free* plan (5 bookings + 3 invoices/month). Try sending:\n\n` +
      `• "Quote for [customer] — [items and prices]"\n` +
      `• "Spent R200 on supplies"\n\n` +
      `Reply MENU any time for help.`
  );
}

/**
 * Small heuristic parser for "Service name, R120, 30 min" style
 * onboarding input. The general-purpose AI quote/invoice parser
 * (see src/lib/claude.ts and the AI design spec) handles richer
 * natural-language input once the booking/quote handlers are wired up —
 * this keeps onboarding fast and free of extra API calls.
 */
function parseServiceLine(
  line: string
): { name: string; price: number; durationMinutes: number } | null {
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 2) return null;

  const name = parts[0];
  const priceMatch = parts[1].match(/(\d+(\.\d+)?)/);
  if (!name || !priceMatch) return null;

  const price = parseFloat(priceMatch[1]);

  let durationMinutes = 30;
  if (parts[2]) {
    const durationMatch = parts[2].match(/(\d+)/);
    if (durationMatch) durationMinutes = parseInt(durationMatch[1], 10);
  }

  return { name, price, durationMinutes };
}
