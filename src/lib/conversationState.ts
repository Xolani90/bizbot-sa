/**
 * Helpers for reading and clearing conversation state from Supabase.
 * Includes a 30-minute timeout to prevent users getting stuck in flows.
 */

import { supabase } from '../config/supabase';
import { ConversationState } from '../types';

const CONVERSATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

  if (error) console.error('[conversation_state] fetch error:', error);

  if (data) {
    // Auto-reset stale conversations older than 30 minutes
    const lastUpdated = new Date(data.updated_at).getTime();
    const isStale = Date.now() - lastUpdated > CONVERSATION_TIMEOUT_MS;

    if (isStale && data.step !== 'idle') {
      console.log(`[conversation_state] Resetting stale state for ${whatsappNumber}`);
      await supabase
        .from('conversation_state')
        .update({ flow: 'idle', step: 'idle', context: {}, updated_at: new Date().toISOString() })
        .eq('whatsapp_number', whatsappNumber)
        .eq('business_id', businessId);

      return { ...data, flow: 'idle', step: 'idle', context: {} };
    }

    return data as ConversationState;
  }

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

export async function clearConversationState(
  whatsappNumber: string,
  businessId: string
): Promise<void> {
  await supabase
    .from('conversation_state')
    .update({ flow: 'idle', step: 'idle', context: {}, updated_at: new Date().toISOString() })
    .eq('whatsapp_number', whatsappNumber)
    .eq('business_id', businessId);
}
