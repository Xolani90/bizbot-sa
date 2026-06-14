/**
 * Booking flow — handles booking_request intents.
 *
 * Conversation pattern:
 *  1. Owner sends: "Book Thabo for haircut tomorrow at 2pm"
 *  2. Bot confirms: shows extracted details and asks to confirm
 *  3. Owner replies "yes" → booking created, customer upserted
 *  4. Reminder cron (crons/reminders.ts) fires 24h and 2h before
 */

import { supabase } from '../config/supabase';
import { sendTextMessage } from '../lib/whatsapp';
import { Business, ConversationState } from '../types';
import { parseNaturalDatetime } from '../lib/dateParser';
import { getOrCreateConversationState, clearConversationState } from '../lib/conversationState';

// ── Entry point ────────────────────────────────────────────────────────────

export async function handleBookingRequest(
  business: Business,
  text: string,
  entities: Record<string, unknown>
): Promise<void> {
  const state = await getOrCreateConversationState(business.id, business.whatsapp_number, 'booking');

  if (state.step === 'start' || state.step === 'idle') {
    await beginBooking(business, text, entities);
  } else if (state.step === 'awaiting_confirm') {
    await confirmBooking(business, state, text);
  }
}

// ── Step 1: parse & confirm ────────────────────────────────────────────────

async function beginBooking(
  business: Business,
  _text: string,
  entities: Record<string, unknown>
): Promise<void> {
  const customerName = (entities.customer_name as string) || (entities.customer as string) || null;
  const serviceName = (entities.service as string) || null;
  const rawDatetime = (entities.date as string) || (entities.time as string) || (entities.datetime as string) || null;

  // Try to find matching service
  let serviceRow: { id: string; name: string; price: number; duration_minutes: number } | null = null;
  if (serviceName) {
    const { data } = await supabase
      .from('services')
      .select('id, name, price, duration_minutes')
      .eq('business_id', business.id)
      .eq('active', true)
      .ilike('name', `%${serviceName}%`)
      .limit(1)
      .maybeSingle();
    serviceRow = data;
  }

  const scheduledAt = rawDatetime ? parseNaturalDatetime(rawDatetime, business.timezone) : null;

  if (!customerName || !scheduledAt) {
    await sendTextMessage(
      business.whatsapp_number,
      `To book an appointment, tell me:\n\n` +
        `*Customer name*, *service*, and *date & time*\n\n` +
        `Example: _"Book Thabo for haircut tomorrow at 2pm"_`
    );
    return;
  }

  // Upsert conversation state with booking context
  await supabase
    .from('conversation_state')
    .upsert(
      {
        business_id: business.id,
        whatsapp_number: business.whatsapp_number,
        flow: 'booking',
        step: 'awaiting_confirm',
        context: {
          customer_name: customerName,
          service_id: serviceRow?.id || null,
          service_name: serviceRow?.name || serviceName || 'Appointment',
          price: serviceRow?.price || null,
          duration_minutes: serviceRow?.duration_minutes || 30,
          scheduled_at: scheduledAt.toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'whatsapp_number,business_id' }
    );

  const dateStr = scheduledAt.toLocaleString('en-ZA', {
    timeZone: business.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  const priceStr = serviceRow ? ` — R${serviceRow.price.toFixed(2)}` : '';

  await sendTextMessage(
    business.whatsapp_number,
    `📅 *Confirm booking*\n\n` +
      `Customer: *${customerName}*\n` +
      `Service: *${serviceRow?.name || serviceName || 'Appointment'}*${priceStr}\n` +
      `When: *${dateStr}*\n\n` +
      `Reply *YES* to confirm or *NO* to cancel.`
  );
}

// ── Step 2: create booking after confirmation ──────────────────────────────

async function confirmBooking(
  business: Business,
  state: ConversationState,
  reply: string
): Promise<void> {
  const normalised = reply.trim().toUpperCase();

  if (normalised === 'NO' || normalised === 'CANCEL') {
    await clearConversationState(business.whatsapp_number, business.id);
    await sendTextMessage(business.whatsapp_number, `Booking cancelled. No worries 👍`);
    return;
  }

  if (normalised !== 'YES' && normalised !== 'Y' && normalised !== 'CONFIRM') {
    await sendTextMessage(business.whatsapp_number, `Reply *YES* to confirm or *NO* to cancel.`);
    return;
  }

  const ctx = state.context as {
    customer_name: string;
    service_id: string | null;
    service_name: string;
    price: number | null;
    duration_minutes: number;
    scheduled_at: string;
  };

  // Upsert customer
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .upsert(
      {
        business_id: business.id,
        whatsapp_number: business.whatsapp_number, // owner is proxy for now
        name: ctx.customer_name,
      },
      { onConflict: 'business_id,whatsapp_number' }
    )
    .select('id')
    .single();

  if (custErr || !customer) {
    // Try to find existing
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('business_id', business.id)
      .eq('name', ctx.customer_name)
      .maybeSingle();

    if (!existing) {
      await sendTextMessage(business.whatsapp_number, `Sorry, something went wrong saving the customer. Please try again.`);
      return;
    }
  }

  const customerId = customer?.id ?? (
    await supabase
      .from('customers')
      .select('id')
      .eq('business_id', business.id)
      .eq('name', ctx.customer_name)
      .maybeSingle()
  ).data?.id;

  if (!customerId) {
    await sendTextMessage(business.whatsapp_number, `Sorry, something went wrong. Please try again.`);
    return;
  }

  const { error: bookErr } = await supabase.from('bookings').insert({
    business_id: business.id,
    customer_id: customerId,
    service_id: ctx.service_id,
    scheduled_at: ctx.scheduled_at,
    duration_minutes: ctx.duration_minutes,
    status: 'confirmed',
  });

  if (bookErr) {
    await sendTextMessage(business.whatsapp_number, `Sorry, failed to save the booking: ${bookErr.message}`);
    return;
  }

  // Update customer visit count
  // increment visit count (best effort)
try { await supabase.rpc("increment_visit_count", { cust_id: customerId }); } catch {}

  await clearConversationState(business.whatsapp_number, business.id);

  const dateStr = new Date(ctx.scheduled_at).toLocaleString('en-ZA', {
    timeZone: business.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  await sendTextMessage(
    business.whatsapp_number,
    `✅ *Booking confirmed!*\n\n` +
      `${ctx.customer_name} — ${ctx.service_name}\n` +
      `📅 ${dateStr}\n\n` +
      `I'll remind you 24h and 2h before.`
  );
}
