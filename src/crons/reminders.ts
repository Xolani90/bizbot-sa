/**
 * Booking reminder cron.
 *
 * Runs every 15 minutes (via node-cron).
 * Sends WhatsApp reminders:
 *   - 24h before a confirmed booking
 *   - 2h before a confirmed booking
 *
 * Uses reminder_24h_sent / reminder_2h_sent flags on the bookings table
 * to prevent duplicate messages.
 */

import cron from 'node-cron';
import { supabase } from '../config/supabase';
import { sendTextMessage } from '../lib/whatsapp';

interface BookingWithDetails {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  reminder_24h_sent: boolean;
  reminder_2h_sent: boolean;
  businesses: {
    whatsapp_number: string;
    name: string | null;
    timezone: string;
  };
  customers: {
    name: string | null;
  };
  services: {
    name: string;
    price: number;
  } | null;
}

export function startReminderCron(): void {
  // Every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await sendReminders();
    } catch (err) {
      console.error('[reminders] Error running reminder cron:', err);
    }
  });

  console.log('[reminders] Reminder cron started (every 15 min)');
}

async function sendReminders(): Promise<void> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in26h = new Date(now.getTime() + 26 * 60 * 60 * 1000); // window: 24-26h out
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const in3h = new Date(now.getTime() + 3 * 60 * 60 * 1000); // window: 2-3h out

  // 24h reminders
  const { data: reminders24h, error: err24 } = await supabase
    .from('bookings')
    .select('*, businesses(whatsapp_number, name, timezone), customers(name), services(name, price)')
    .eq('status', 'confirmed')
    .eq('reminder_24h_sent', false)
    .gte('scheduled_at', in24h.toISOString())
    .lte('scheduled_at', in26h.toISOString());

  if (err24) console.error('[reminders] 24h query error:', err24);

  for (const booking of (reminders24h || []) as BookingWithDetails[]) {
    await sendReminderMessage(booking, '24h');
    await supabase
      .from('bookings')
      .update({ reminder_24h_sent: true })
      .eq('id', booking.id);
  }

  // 2h reminders
  const { data: reminders2h, error: err2 } = await supabase
    .from('bookings')
    .select('*, businesses(whatsapp_number, name, timezone), customers(name), services(name, price)')
    .eq('status', 'confirmed')
    .eq('reminder_2h_sent', false)
    .gte('scheduled_at', in2h.toISOString())
    .lte('scheduled_at', in3h.toISOString());

  if (err2) console.error('[reminders] 2h query error:', err2);

  for (const booking of (reminders2h || []) as BookingWithDetails[]) {
    await sendReminderMessage(booking, '2h');
    await supabase
      .from('bookings')
      .update({ reminder_2h_sent: true })
      .eq('id', booking.id);
  }
}

async function sendReminderMessage(
  booking: BookingWithDetails,
  window: '24h' | '2h'
): Promise<void> {
  const business = booking.businesses;
  const customerName = booking.customers?.name || 'Your customer';
  const serviceName = booking.services?.name || 'appointment';

  const scheduledStr = new Date(booking.scheduled_at).toLocaleString('en-ZA', {
    timeZone: business.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  const emoji = window === '24h' ? '⏰' : '🔔';
  const timeLabel = window === '24h' ? 'tomorrow' : 'in 2 hours';

  await sendTextMessage(
    business.whatsapp_number,
    `${emoji} *Booking reminder*\n\n` +
      `${customerName} has a *${serviceName}* ${timeLabel}:\n` +
      `📅 ${scheduledStr}\n\n` +
      `Reply MENU to manage bookings.`
  );
}
