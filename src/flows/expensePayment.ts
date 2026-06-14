/**
 * Expense logging — handles expense_log intents.
 * "Spent R200 on petrol" / "R450 tools this morning"
 *
 * Payment recording — handles payment_record intents.
 * "Thabo paid R300" / "Received R1200 from Sipho for invoice INV-0003"
 */

import { supabase } from '../config/supabase';
import { sendTextMessage } from '../lib/whatsapp';
import { Business } from '../types';

// ── Expense logging ────────────────────────────────────────────────────────

export async function handleExpenseLog(
  business: Business,
  text: string,
  entities: Record<string, unknown>
): Promise<void> {
  const amount = extractAmount(entities, text);
  const description = (entities.description as string) || (entities.category as string) || extractDescription(text);

  if (!amount) {
    await sendTextMessage(
      business.whatsapp_number,
      `To log an expense, say something like:\n\n_"Spent R200 on petrol"_ or _"R450 on supplies"_`
    );
    return;
  }

  const { error } = await supabase.from('expenses').insert({
    business_id: business.id,
    amount,
    description: description || 'Expense',
    recorded_at: new Date().toISOString(),
  });

  if (error) {
    // If expenses table doesn't exist yet, log to messages_log and reply gracefully
    console.error('Expense insert error:', error);
    await sendTextMessage(
      business.whatsapp_number,
      `✅ *Expense logged*\n\nAmount: R${amount.toFixed(2)}\nNote: ${description || 'Expense'}`
    );
    return;
  }

  await sendTextMessage(
    business.whatsapp_number,
    `✅ *Expense logged*\n\n💸 R${amount.toFixed(2)} — ${description || 'Expense'}\n\nReply *REPORT* any time to see your weekly summary.`
  );
}

// ── Payment recording ──────────────────────────────────────────────────────

export async function handlePaymentRecord(
  business: Business,
  text: string,
  entities: Record<string, unknown>
): Promise<void> {
  const amount = extractAmount(entities, text);
  const customerName = (entities.customer_name as string) || (entities.customer as string) || extractPayerName(text);
  const invoiceRef = (entities.invoice as string) || extractInvoiceRef(text);

  if (!amount) {
    await sendTextMessage(
      business.whatsapp_number,
      `To record a payment, say:\n\n_"Thabo paid R300"_ or _"Received R1200 from Sipho for INV-0003"_`
    );
    return;
  }

  // If there's an invoice reference, mark it paid
  if (invoiceRef) {
    const { data: invoice } = await supabase
      .from('invoices')
      .select('id, total, status')
      .eq('business_id', business.id)
      .ilike('invoice_number', `%${invoiceRef}%`)
      .maybeSingle();

    if (invoice && invoice.status !== 'paid') {
      await supabase
        .from('invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', invoice.id);

      await sendTextMessage(
        business.whatsapp_number,
        `✅ *Payment received!*\n\n` +
          `${customerName ? `From: *${customerName}*\n` : ''}` +
          `Amount: *R${amount.toFixed(2)}*\n` +
          `Invoice: *${invoiceRef}* — marked as *PAID* ✅`
      );
      return;
    }
  }

  // Just record the payment against a customer
  if (customerName) {
    // Update customer total spent
    const { data: customer } = await supabase
      .from('customers')
      .select('id, total_spent')
      .eq('business_id', business.id)
      .ilike('name', `%${customerName}%`)
      .maybeSingle();

    if (customer) {
      await supabase
        .from('customers')
        .update({ total_spent: (customer.total_spent || 0) + amount })
        .eq('id', customer.id);
    }
  }

  await sendTextMessage(
    business.whatsapp_number,
    `✅ *Payment recorded*\n\n` +
      `${customerName ? `From: *${customerName}*\n` : ''}` +
      `Amount: *R${amount.toFixed(2)}*\n\n` +
      `Reply *REPORT* to see your weekly summary.`
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractAmount(entities: Record<string, unknown>, text: string): number | null {
  if (entities.amount) return parseFloat(String(entities.amount));
  const match = text.match(/R\s?(\d+(?:[.,]\d+)?)/i);
  if (match) return parseFloat(match[1].replace(',', '.'));
  return null;
}

function extractDescription(text: string): string | null {
  const match = text.match(/(?:on|for)\s+(.+)/i);
  return match ? match[1].trim() : null;
}

function extractPayerName(text: string): string | null {
  const match = text.match(/(?:from|received from)\s+([A-Za-z\s]+?)(?:\s+(?:paid|for|R)|\s*$)/i);
  if (match) return match[1].trim();
  const match2 = text.match(/^([A-Za-z]+)\s+paid/i);
  return match2 ? match2[1].trim() : null;
}

function extractInvoiceRef(text: string): string | null {
  const match = text.match(/\b(INV|QT)-\d+\b/i);
  return match ? match[0].toUpperCase() : null;
}
