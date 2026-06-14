/**
 * Helpers for reading and clearing conversation state from Supabase.
 */

import { supabase } from '../config/supabase';
import { ConversationState } from '../types';

export async function getOrCreateConversationState(
  businessId: string,
  whatsappNumber: string,
  flow: string
): Promise<ConversationState> {
  const { data, error } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('whatsapp_number', whatsappNumber)
    .eq('business_id', businessId)
    .maybeSingle();

  if (error) console.error('conversation_state fetch error:', error);

  if (!data) {
    return {
      id: '',
      business_id: businessId,
      whatsapp_number: whatsappNumber,
      flow,
      step: 'idle',
      context: {},
      updated_at: new Date().toISOString(),
    };
  }

  return data as ConversationState;
}

export async function clearConversationState(
  whatsappNumber: string,
  businessId: string
): Promise<void> {
  await supabase
    .from('conversation_state')
    .update({ flow: 'idle', step: 'idle', context: {} })
    .eq('whatsapp_number', whatsappNumber)
    .eq('business_id', businessId);
}
