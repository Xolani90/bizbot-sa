/**
 * Weekly business report cron.
 * Fires every Sunday at 8am (Africa/Johannesburg).
 * Sends each onboarded business their weekly summary via WhatsApp.
 */

import cron from 'node-cron';
import { supabase } from '../config/supabase';
import { sendWeeklyReport } from '../flows/report';
import { Business } from '../types';

export function startWeeklyReportCron(): void {
  // Sunday at 8:00am SAST
  cron.schedule('0 8 * * 0', async () => {
    try {
      await sendAllWeeklyReports();
    } catch (err) {
      console.error('[weeklyReport] Error:', err);
    }
  }, { timezone: 'Africa/Johannesburg' });

  console.log('[weeklyReport] Weekly report cron started (Sundays 8am SAST)');
}

async function sendAllWeeklyReports(): Promise<void> {
  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('onboarding_status', 'completed');

  if (error) {
    console.error('[weeklyReport] Failed to fetch businesses:', error);
    return;
  }

  console.log(`[weeklyReport] Sending reports to ${businesses?.length ?? 0} businesses`);

  for (const business of (businesses || []) as Business[]) {
    try {
      await sendWeeklyReport(business);
      // Stagger sends to avoid WhatsApp rate limits
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`[weeklyReport] Failed for ${business.id}:`, err);
    }
  }
}
