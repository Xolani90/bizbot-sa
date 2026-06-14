/**
 * Quote / Invoice flow — handles quote_command and invoice_command intents.
 *
 * Quotes and invoices follow the same parsing path — the only difference
 * is the document type and whether a Yoco payment link is attached.
 *
 * Conversation pattern:
 *  1. "Quote for Sipho — 2x tyres R850 each, labour R300"
 *  2. Bot parses line items via Claude Haiku, sends back a formatted preview
 *  3. Owner replies YES → PDF generated, sent as WhatsApp document
 *     (For invoices: also generates a Yoco payment link if configured)
 */

import { supabase } from '../config/supabase';
import { sendTextMessage } from '../lib/whatsapp';
import { sendDocument } from '../lib/whatsappMedia';
import { Business, ConversationState } from '../types';
import { parseLineItems, LineItem } from '../lib/lineItemParser';
import { generateInvoicePdf } from '../lib/pdf';
import { getOrCreateConversationState, clearConversationState } from '../lib/conversationState';
import { generateYocoLink } from '../lib/yoco';

// ── Entry points ──────────────────────────────────────────────────────────

export async function handleQuoteCommand(
  business: Business,
  text: string,
  entities: Record<string, unknown>
): Promise<void> {
  await handleDocumentFlow(business, text, entities, 'quote');
}

export async function handleInvoiceCommand(
  business: Business,
  text: string,
  entities: Record<string, unknown>
): Promise<void> {
  await handleDocumentFlow(business, text, entities, 'invoice');
}

// ── Shared flow ────────────────────────────────────────────────────────────

async function handleDocumentFlow(
  business: Business,
  text: string,
  entities: Record<string, unknown>,
  docType: 'quote' | 'invoice'
): Promise<void> {
  const state = await getOrCreateConversationState(business.id, business.whatsapp_number, docType);

  if (state.step === 'start' || state.step === 'idle') {
    await beginDocument(business, text, entities, docType);
  } else if (state.step === 'awaiting_confirm') {
    await confirmDocument(business, state, text, docType);
  }
}

async function beginDocument(
  business: Business,
  text: string,
  entities: Record<string, unknown>,
  docType: 'quote' | 'invoice'
): Promise<void> {
  const customerName =
    (entities.customer_name as string) ||
    (entities.customer as string) ||
    extractCustomerFromText(text);

  const { items, error } = await parseLineItems(text, business.name || 'Business');

  if (error || items.length === 0) {
    await sendTextMessage(
      business.whatsapp_number,
      `To create a ${docType}, tell me:\n\n` +
        `*"${docType === 'quote' ? 'Quote' : 'Invoice'} for [customer] — [items and prices]"*\n\n` +
        `Example: _"Quote for Sipho — 2x tyres R850 each, labour R300"_`
    );
    return;
  }

  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const linesSummary = items
    .map((i) => `  • ${i.description}: R${i.amount.toFixed(2)}`)
    .join('\n');

  await supabase
    .from('conversation_state')
    .upsert(
      {
        business_id: business.id,
        whatsapp_number: business.whatsapp_number,
        flow: docType,
        step: 'awaiting_confirm',
        context: {
          customer_name: customerName || 'Customer',
          items,
          total,
          doc_type: docType,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'whatsapp_number,business_id' }
    );

  const emoji = docType === 'quote' ? '📋' : '🧾';

  await sendTextMessage(
    business.whatsapp_number,
    `${emoji} *${docType === 'quote' ? 'Quote' : 'Invoice'} preview*\n\n` +
      `Customer: *${customerName || 'Customer'}*\n\n` +
      `${linesSummary}\n\n` +
      `*Total: R${total.toFixed(2)}*\n\n` +
      `Reply *YES* to generate the PDF, or *NO* to cancel.`
  );
}

async function confirmDocument(
  business: Business,
  state: ConversationState,
  reply: string,
  docType: 'quote' | 'invoice'
): Promise<void> {
  const normalised = reply.trim().toUpperCase();

  if (normalised === 'NO' || normalised === 'CANCEL') {
    await clearConversationState(business.whatsapp_number, business.id);
    await sendTextMessage(business.whatsapp_number, `${docType === 'quote' ? 'Quote' : 'Invoice'} cancelled.`);
    return;
  }

  if (normalised !== 'YES' && normalised !== 'Y') {
    await sendTextMessage(business.whatsapp_number, `Reply *YES* to generate or *NO* to cancel.`);
    return;
  }

  const ctx = state.context as {
    customer_name: string;
    items: LineItem[];
    total: number;
    doc_type: 'quote' | 'invoice';
  };

  // Upsert customer record
  const { data: custData } = await supabase
    .from('customers')
    .upsert(
      {
        business_id: business.id,
        whatsapp_number: business.whatsapp_number,
        name: ctx.customer_name,
      },
      { onConflict: 'business_id,whatsapp_number' }
    )
    .select('id')
    .maybeSingle();

  let customerId = custData?.id;
  if (!customerId) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('business_id', business.id)
      .ilike('name', ctx.customer_name)
      .maybeSingle();
    customerId = data?.id;
  }

  // Generate invoice number
  const invoiceNumber = await nextInvoiceNumber(business.id, docType);

  // Save invoice/quote to DB
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      business_id: business.id,
      customer_id: customerId || null,
      invoice_number: invoiceNumber,
      line_items: ctx.items,
      subtotal: ctx.total,
      total: ctx.total,
      status: docType === 'quote' ? 'draft' : 'sent',
      due_date: docType === 'invoice' ? dueDateIn14Days() : null,
    })
    .select('id, invoice_number')
    .single();

  if (invErr || !invoice) {
    await sendTextMessage(business.whatsapp_number, `Failed to save the ${docType}. Please try again.`);
    return;
  }

  // Generate PDF
  const pdfBuffer = await generateInvoicePdf({
    docType,
    invoiceNumber: invoice.invoice_number,
    businessName: business.name || 'My Business',
    customerName: ctx.customer_name,
    items: ctx.items,
    total: ctx.total,
    dueDate: docType === 'invoice' ? dueDateIn14Days() : null,
  });

  // Send PDF
  await sendDocument(
    business.whatsapp_number,
    pdfBuffer,
    `${docType}-${invoice.invoice_number}.pdf`,
    `${docType === 'quote' ? 'Quote' : 'Invoice'} ${invoice.invoice_number} — R${ctx.total.toFixed(2)}`
  );

  // If invoice and Yoco configured, generate payment link
  if (docType === 'invoice' && business.yoco_merchant_id) {
    const paymentLink = await generateYocoLink({
      merchantId: business.yoco_merchant_id,
      amount: ctx.total,
      description: `Invoice ${invoice.invoice_number} — ${business.name}`,
      invoiceId: invoice.id,
    }).catch(() => null);

    if (paymentLink) {
      await sendTextMessage(
        business.whatsapp_number,
        `💳 *Payment link:*\n${paymentLink}\n\nShare this link with ${ctx.customer_name} to accept card payments.`
      );

      // Update invoice with payment link
      await supabase
        .from('invoices')
        .update({ payment_link: paymentLink })
        .eq('id', invoice.id);
    }
  }

  await clearConversationState(business.whatsapp_number, business.id);

  await sendTextMessage(
    business.whatsapp_number,
    `✅ ${docType === 'quote' ? 'Quote' : 'Invoice'} *${invoice.invoice_number}* sent!\n\n` +
      `Total: R${ctx.total.toFixed(2)}`
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractCustomerFromText(text: string): string | null {
  const match = text.match(/(?:for|to)\s+([A-Za-z\s]+?)(?:\s*[-–—]|\s*,|\s*:)/i);
  return match ? match[1].trim() : null;
}

async function nextInvoiceNumber(businessId: string, docType: 'quote' | 'invoice'): Promise<string> {
  const prefix = docType === 'quote' ? 'QT' : 'INV';
  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId);
  const seq = (count ?? 0) + 1;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

function dueDateIn14Days(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString();
}
