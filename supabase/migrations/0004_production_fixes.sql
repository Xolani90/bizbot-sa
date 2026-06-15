-- ============================================================================
-- BizBot SA — Migration 0004
-- Production fixes:
-- 1. Add unique constraint on customers(business_id, name) for name-based lookups
-- 2. Allow placeholder whatsapp_number pattern for customers without known numbers
-- 3. Ensure invoices.number column exists (was already in 0001, this is a safety check)
-- ============================================================================

-- Allow customers to have duplicate placeholder numbers (when we don't know their real number)
-- Drop old unique constraint and add a partial one
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_business_id_whatsapp_number_key;

-- Unique real numbers per business (exclude placeholder numbers)
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_real_number
  ON customers (business_id, whatsapp_number)
  WHERE whatsapp_number NOT LIKE 'customer-%';

-- Index for name-based lookups
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (business_id, lower(name));

-- Index for invoice number lookups
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices (business_id, number);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
