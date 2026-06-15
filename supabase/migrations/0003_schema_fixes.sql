-- ============================================================================
-- BizBot SA — Migration 0003
-- Fixes: conversation_state null business_id constraint, schema refresh.
-- Run AFTER 0001 and 0002.
-- ============================================================================

-- Fix conversation_state unique constraint so null business_id works correctly
-- for pre-onboarded numbers (NULL != NULL in postgres, so duplicates can occur)
ALTER TABLE conversation_state DROP CONSTRAINT IF EXISTS conversation_state_whatsapp_number_business_id_key;

-- Partial unique index: when business_id is set, enforce uniqueness per business
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_state_with_business
  ON conversation_state (whatsapp_number, business_id)
  WHERE business_id IS NOT NULL;

-- Partial unique index: when business_id is null (pre-onboarding), one row per number
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_state_no_business
  ON conversation_state (whatsapp_number)
  WHERE business_id IS NULL;

-- Notify PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
