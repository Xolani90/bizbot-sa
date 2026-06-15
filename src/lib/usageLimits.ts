/**
 * Usage limit enforcement for the free tier.
 * Free plan: 10 bookings/month, 5 invoices/month.
 * Starter/Pro: unlimited.
 */

import { supabase } from '../config/supabase';
import { Business } from '../types';

const FREE_LIMITS = {
  bookings_per_month: 10,
  invoices_per_month: 5,
};

function monthStart(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function checkBookingLimit(business: Business): Promise<{ allowed: boolean; message?: string }> {
  if (business.subscription_tier !== 'free') return { allowed: true };

  const { count } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', business.id)
    .gte('created_at', monthStart());

  if ((count ?? 0) >= FREE_LIMITS.bookings_per_month) {
    return {
      allowed: false,
      message:
        `⚠️ You've reached your free plan limit of ${FREE_LIMITS.bookings_per_month} bookings this month.\n\n` +
        `Upgrade to Starter to unlock unlimited bookings. Reply UPGRADE for details.`,
    };
  }

  return { allowed: true };
}

export async function checkInvoiceLimit(business: Business): Promise<{ allowed: boolean; message?: string }> {
  if (business.subscription_tier !== 'free') return { allowed: true };

  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', business.id)
    .gte('created_at', monthStart());

  if ((count ?? 0) >= FREE_LIMITS.invoices_per_month) {
    return {
      allowed: false,
      message:
        `⚠️ You've reached your free plan limit of ${FREE_LIMITS.invoices_per_month} invoices this month.\n\n` +
        `Upgrade to Starter to unlock unlimited invoices. Reply UPGRADE for details.`,
    };
  }

  return { allowed: true };
}
