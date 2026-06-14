/**
 * Business report — handles report_request intents.
 * Also called by the weekly cron (crons/weeklyReport.ts) on Sundays.
 *
 * "Report" / "Show me this week" / "How did I do?"
 * Returns a WhatsApp-formatted summary:
 *   - Revenue (invoices paid)
 *   - Bookings (count, completed, cancelled)
 *   - Expenses
 *   - Net profit estimate
 *   - Top customers
 */

import { supabase } from '../config/supabase';
import { sendTextMessage } from '../lib/whatsapp';
import { Business } from '../types';

export async function handleReportRequest(business: Business): Promise<void> {
  await sendTextMessage(business.whatsapp_number, `📊 Pulling your report...`);
  await sendWeeklyReport(business);
}

export async function sendWeeklyReport(business: Business): Promise<void> {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const weekStartStr = weekStart.toISOString();

  // Revenue: invoices paid this week
  const { data: paidInvoices } = await supabase
    .from('invoices')
    .select('total')
    .eq('business_id', business.id)
    .eq('status', 'paid')
    .gte('paid_at', weekStartStr);

  const revenue = (paidInvoices ?? []).reduce((s, i) => s + Number(i.total), 0);

  // Outstanding: sent but unpaid invoices
  const { data: outstandingInvoices } = await supabase
    .from('invoices')
    .select('total, invoice_number')
    .eq('business_id', business.id)
    .in('status', ['sent', 'overdue']);

  const outstanding = (outstandingInvoices ?? []).reduce((s, i) => s + Number(i.total), 0);

  // Bookings this week
  const { data: bookings } = await supabase
    .from('bookings')
    .select('status')
    .eq('business_id', business.id)
    .gte('scheduled_at', weekStartStr);

  const totalBookings = bookings?.length ?? 0;
  const completedBookings = bookings?.filter((b) => b.status === 'completed').length ?? 0;
  const noShows = bookings?.filter((b) => b.status === 'no_show').length ?? 0;

  // Expenses this week
  let expenses: { amount: number }[] = [];
  try {
    const { data: expData } = await supabase
      .from('expenses')
      .select('amount')
      .eq('business_id', business.id)
      .gte('recorded_at', weekStartStr);
    expenses = expData ?? [];
  } catch {}

  const expensesTotal = expenses.reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0);
  const profit = revenue - expensesTotal;

  // Top customers by bookings this week
  const { data: topCustomers } = await supabase
    .from('customers')
    .select('name, visit_count, total_spent')
    .eq('business_id', business.id)
    .order('total_spent', { ascending: false })
    .limit(3);

  const dateRange = `${weekStart.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} – ${now.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`;

  let report = `📊 *Weekly Report — ${business.name || 'Your Business'}*\n`;
  report += `_${dateRange}_\n\n`;

  report += `💰 *Revenue*\n`;
  report += `Paid invoices: R${revenue.toFixed(2)}\n`;
  if (outstanding > 0) {
    report += `Outstanding: R${outstanding.toFixed(2)} ⚠️\n`;
  }
  report += `\n`;

  report += `📅 *Bookings*\n`;
  report += `Total: ${totalBookings}\n`;
  if (completedBookings > 0) report += `Completed: ${completedBookings} ✅\n`;
  if (noShows > 0) report += `No-shows: ${noShows} ❌\n`;
  report += `\n`;

  if (expensesTotal > 0) {
    report += `💸 *Expenses*: R${expensesTotal.toFixed(2)}\n\n`;
  }

  if (revenue > 0 || expensesTotal > 0) {
    const profitEmoji = profit >= 0 ? '📈' : '📉';
    report += `${profitEmoji} *Est. Profit*: R${profit.toFixed(2)}\n\n`;
  }

  if (topCustomers && topCustomers.length > 0) {
    report += `⭐ *Top Customers*\n`;
    topCustomers.forEach((c) => {
      report += `${c.name || 'Unknown'} — R${Number(c.total_spent).toFixed(2)} lifetime\n`;
    });
  }

  if (outstandingInvoices && outstandingInvoices.length > 0) {
    report += `\n⚠️ *Follow up on:*\n`;
    outstandingInvoices.slice(0, 3).forEach((i) => {
      report += `${i.invoice_number} — R${Number(i.total).toFixed(2)}\n`;
    });
  }

  await sendTextMessage(business.whatsapp_number, report);
}
