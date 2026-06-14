import { supabase } from '../config/supabase';
import { sendTextMessage } from '../lib/whatsapp';
import { classifyIntent } from '../lib/claude';
import { startOnboarding, continueOnboarding } from './onboarding';
import { handleBookingRequest } from './booking';
import { handleQuoteCommand, handleInvoiceCommand } from './quoteInvoice';
import { handleExpenseLog, handlePaymentRecord } from './expensePayment';
import { handleMarketingRequest } from './marketing';
import { handleReportRequest } from './report';
import { handleGeneralQuery } from './generalQuery';
import { getOrCreateConversationState } from '../lib/conversationState';
import { Business, InboundMessage } from '../types';

export async function routeMessage(message: InboundMessage): Promise<void> {
  if (!message.text) {
    await sendTextMessage(
      message.from,
      `For now I can only read text messages — please type your request and I'll take it from there 🙂`
    );
    return;
  }

  await logMessage(null, message.from, 'inbound', message.text, message.raw);

  const business = await findBusinessByNumber(message.from);

  if (!business) {
    await startOnboarding(message.from);
    return;
  }

  if (business.onboarding_status !== 'completed') {
    await continueOnboarding(business, message.text);
    return;
  }

  await handleOwnerMessage(business, message.text);
}

async function handleOwnerMessage(business: Business, text: string): Promise<void> {
  const upper = text.trim().toUpperCase();

  if (upper === 'MENU' || upper === 'HELP') {
    await handleGeneralQuery(business, text);
    return;
  }

  // Check for active multi-turn conversation state
  const state = await getOrCreateConversationState(
    business.id,
    business.whatsapp_number,
    'idle'
  );

  if (state.step !== 'idle' && state.step !== 'start' && state.flow !== 'idle') {
    await routeToFlow(business, text, state.flow, {}, state);
    return;
  }

  const intent = await classifyIntent(text);

  await logMessage(
    business.id,
    business.whatsapp_number,
    'outbound',
    `[intent: ${intent.intent}, confidence: ${intent.confidence}]`,
    intent
  );

  await routeToFlow(business, text, intent.intent, intent.entities, null);
}

async function routeToFlow(
  business: Business,
  text: string,
  flow: string,
  entities: Record<string, unknown>,
  _existingState: unknown
): Promise<void> {
  switch (flow) {
    case 'booking_request':
    case 'booking':
      await handleBookingRequest(business, text, entities);
      break;
    case 'quote_command':
    case 'quote':
      await handleQuoteCommand(business, text, entities);
      break;
    case 'invoice_command':
    case 'invoice':
      await handleInvoiceCommand(business, text, entities);
      break;
    case 'payment_record':
      await handlePaymentRecord(business, text, entities);
      break;
    case 'expense_log':
      await handleExpenseLog(business, text, entities);
      break;
    case 'marketing_request':
      await handleMarketingRequest(business, text);
      break;
    case 'report_request':
      await handleReportRequest(business);
      break;
    case 'general_query':
    default:
      await handleGeneralQuery(business, text);
      break;
  }
}

async function findBusinessByNumber(whatsappNumber: string): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('whatsapp_number', whatsappNumber)
    .maybeSingle();

  if (error) throw error;
  return data as Business | null;
}

async function logMessage(
  businessId: string | null,
  whatsappNumber: string,
  direction: 'inbound' | 'outbound',
  body: string,
  rawPayload: unknown
): Promise<void> {
  const { error } = await supabase.from('messages_log').insert({
    business_id: businessId,
    whatsapp_number: whatsappNumber,
    direction,
    body,
    raw_payload: rawPayload,
  });

  if (error) console.error('Failed to write messages_log row', error);
}
