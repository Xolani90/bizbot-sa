/**
 * Quote / Invoice flow.
 *
 * Conversation pattern:
 *  1. "Quote for Sipho — 2x tyres R850 each, labour R300"
 *  2. Bot parses line items, sends formatted preview
 *  3. Owner replies YES → PDF generated, sent as WhatsApp document
 *     (Invoices also get a Yoco payment link if configured)
 */

import { supabase } from '../config/supabase';
import { sendTextMessage } from '../lib/whatsapp';
import { sendDocument } from '../lib/whatsappMedia';
import { Business, ConversationState } from '../types';
import { parseLineItems, LineItem } from '../lib/lineItemParser';
import { generateInvoicePdf } from '../lib/pdf';
import { getOrCreateConversationState, clearConversationState } from '../lib/conversationState';
import { generateYocoLink } from '../lib/yoco';
import { checkInvoiceLimit } from '../lib/usageLimits';

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
  // Check usage limits for invoices
  if (docType === 'invoice') {
    const limit = await checkInvoiceLimit(business);
    if (!limit.allowed) {
      await sendTextMessage(business.whatsapp_number, limit.message!);
      return;
    }
  }

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
    await sendTextMessage(business.whatsapp_number, `${docType === 'quote' ? 'Quote' : 'Invoice'} cancelled. Reply MENU any time.`);
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

  // Find or create customer
  let customerId: string | null = null;
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', business.id)
    .ilike('name', ctx.customer_name.trim())
    .maybeSingle();

  if (existingCustomer) {
    customerId = existingCustomer.id;
  } else {
    const { data: newCustomer } = await supabase
      .from('customers')
      .insert({
        business_id: business.id,
        whatsapp_number: `customer-${Date.now()}`,
        name: ctx.customer_name,
      })
      .select('id')
      .single();
    customerId = newCustomer?.id ?? null;
  }

  // Generate document number (QT-0001 or INV-0001)
  const docNumber = await nextDocNumber(business.id, docType);

  // Save to DB — 'number' is the correct column name per schema
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      business_id: business.id,
      customer_id: customerId,
      number: docNumber,
      line_items: ctx.items,
      subtotal: ctx.total,
      total: ctx.total,
      status: docType === 'quote' ? 'draft' : 'sent',
      due_date: docType === 'invoice' ? dueDateIn14Days() : null,
    })
    .select('id, number')
    .single();

  if (invErr || !invoice) {
    console.error('[quoteInvoice] Failed to save document:', invErr);
    await sendTextMessage(business.whatsapp_number, `Failed to save the ${docType}. Please try again.`);
    await clearConversationState(business.whatsapp_number, business.id);
    return;
  }

  // Generate PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateInvoicePdf({
      docType,
      invoiceNumber: invoice.number,
      businessName: business.name || 'My Business',
      customerName: ctx.customer_name,
      items: ctx.items,
      total: ctx.total,
      dueDate: docType === 'invoice' ? dueDateIn14Days() : null,
    });
  } catch (pdfErr) {
    console.error('[quoteInvoice] PDF generation failed:', pdfErr);
    // Still confirm even if PDF fails
    await clearConversationState(business.whatsapp_number, business.id);
    await sendTextMessage(
      business.whatsapp_number,
      `✅ ${docType === 'quote' ? 'Quote' : 'Invoice'} *${invoice.number}* saved!\n\n` +
        `Total: R${ctx.total.toFixed(2)}\n\n` +
        `_(PDF generation failed — your ${docType} is saved in the system)_`
    );
    return;
  }

  // Send PDF
  try {
    await sendDocument(
      business.whatsapp_number,
      pdfBuffer,
      `${docType}-${invoice.number}.pdf`,
      `${docType === 'quote' ? 'Quote' : 'Invoice'} ${invoice.number} — R${ctx.total.toFixed(2)}`
    );
  } catch (mediaErr) {
    console.error('[quoteInvoice] PDF send failed:', mediaErr);
    // Continue — still generate payment link and confirm
  }

  // Yoco payment link for invoices
  if (docType === 'invoice' && business.yoco_merchant_id) {
    const paymentLink = await generateYocoLink({
      merchantId: business.yoco_merchant_id,
      amount: ctx.total,
      description: `Invoice ${invoice.number} — ${business.name}`,
      invoiceId: invoice.id,
    }).catch(() => null);

    if (paymentLink) {
      await sendTextMessage(
        business.whatsapp_number,
        `💳 *Payment link:*\n${paymentLink}\n\nShare this with ${ctx.customer_name} to accept card payments.`
      );
      await supabase
        .from('invoices')
        .update({ payment_link: paymentLink })
        .eq('id', invoice.id);
    }
  }

  await clearConversationState(business.whatsapp_number, business.id);

  await sendTextMessage(
    business.whatsapp_number,
    `✅ ${docType === 'quote' ? 'Quote' : 'Invoice'} *${invoice.number}* sent!\n\n` +
      `Total: R${ctx.total.toFixed(2)}\n\n` +
      `Reply MENU for more.`
  );
}

function extractCustomerFromText(text: string): string | null {
  const match = text.match(/(?:for|to)\s+([A-Za-z\s]+?)(?:\s*[-–—]|\s*,|\s*:)/i);
  return match ? match[1].trim() : null;
}

async function nextDocNumber(businessId: string, docType: 'quote' | 'invoice'): Promise<string> {
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
  return d.toISOString().split('T')[0]; // date only
}
