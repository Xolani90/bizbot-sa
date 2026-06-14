-- ============================================================================
-- BizBot SA — Initial schema
-- Migration 0001: core tables for businesses, customers, services, bookings,
-- invoices, conversation state (multi-turn WhatsApp flows), and message
-- logging.
--
-- Run with: supabase db push   (or paste into the Supabase SQL editor)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────────────

create type business_type as enum (
  'salon', 'barber', 'plumber', 'mechanic', 'tutor', 'other'
);

create type subscription_tier as enum ('free', 'starter', 'pro');

create type onboarding_status as enum ('pending', 'in_progress', 'completed');

create type booking_status as enum (
  'pending', 'confirmed', 'completed', 'no_show', 'cancelled'
);

create type invoice_status as enum (
  'draft', 'sent', 'paid', 'overdue', 'cancelled'
);

create type message_direction as enum ('inbound', 'outbound');

-- ── businesses ───────────────────────────────────────────────────────────

create table businesses (
  id                       uuid primary key default gen_random_uuid(),
  whatsapp_number          text unique not null,
  name                     text,
  type                     business_type,
  subscription_tier        subscription_tier not null default 'free',
  subscription_expires_at  timestamptz,
  waba_phone_id            text,
  yoco_merchant_id         text,
  timezone                 text not null default 'Africa/Johannesburg',
  -- Onboarding state machine — see src/flows/onboarding.ts
  onboarding_status        onboarding_status not null default 'pending',
  onboarding_step          text not null default 'welcome',
  onboarding_data          jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index idx_businesses_whatsapp_number on businesses (whatsapp_number);

-- ── services ─────────────────────────────────────────────────────────────
-- Each business defines its own service menu. Referenced by bookings.

create table services (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses (id) on delete cascade,
  name              text not null,
  price             numeric(10, 2) not null default 0,
  duration_minutes  int not null default 30,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create index idx_services_business_id on services (business_id);

-- ── customers ────────────────────────────────────────────────────────────

create table customers (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses (id) on delete cascade,
  whatsapp_number  text not null,
  name             text,
  total_spent      numeric(12, 2) not null default 0,
  visit_count      int not null default 0,
  last_visit_at    timestamptz,
  tags             text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique (business_id, whatsapp_number)
);

create index idx_customers_business_id on customers (business_id);
create index idx_customers_whatsapp_number on customers (whatsapp_number);

-- ── bookings ─────────────────────────────────────────────────────────────

create table bookings (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses (id) on delete cascade,
  customer_id         uuid not null references customers (id) on delete cascade,
  service_id          uuid references services (id) on delete set null,
  scheduled_at        timestamptz not null,
  duration_minutes    int not null default 30,
  status              booking_status not null default 'pending',
  reminder_24h_sent   boolean not null default false,
  reminder_2h_sent    boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_bookings_business_id on bookings (business_id);
create index idx_bookings_customer_id on bookings (customer_id);
create index idx_bookings_scheduled_at on bookings (scheduled_at);

-- Speeds up the reminder cron (24h / 2h pre-appointment reminders).
create index idx_bookings_reminders
  on bookings (scheduled_at)
  where status = 'confirmed' and (not reminder_24h_sent or not reminder_2h_sent);

-- ── invoices ─────────────────────────────────────────────────────────────

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses (id) on delete cascade,
  customer_id       uuid not null references customers (id) on delete cascade,
  number            text not null,
  line_items        jsonb not null default '[]'::jsonb,  -- [{desc, qty, unit_price}]
  subtotal          numeric(12, 2) not null default 0,
  vat_amount        numeric(12, 2),
  total             numeric(12, 2) not null default 0,
  status            invoice_status not null default 'draft',
  due_date          date,
  paid_at           timestamptz,
  payment_method    text,  -- yoco, eft, cash, snapscan
  follow_up_count   int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, number)
);

create index idx_invoices_business_id on invoices (business_id);
create index idx_invoices_customer_id on invoices (customer_id);
create index idx_invoices_status on invoices (status);

-- Speeds up the day 3/7/14 overdue-invoice follow-up cron.
create index idx_invoices_follow_up
  on invoices (due_date)
  where status in ('sent', 'overdue');

-- ── conversation_state ───────────────────────────────────────────────────
-- Tracks where a given WhatsApp number is within a multi-turn flow
-- (onboarding, booking, quote creation, etc). business_id is nullable so
-- a not-yet-onboarded number can still hold state.

create table conversation_state (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid references businesses (id) on delete cascade,
  whatsapp_number  text not null,
  flow             text not null default 'idle',
  step             text not null default 'start',
  context          jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  unique (whatsapp_number, business_id)
);

create index idx_conversation_state_number on conversation_state (whatsapp_number);

-- ── messages_log ─────────────────────────────────────────────────────────
-- Audit trail of inbound/outbound WhatsApp messages — useful for debugging,
-- support, and future AI context windows.

create table messages_log (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid references businesses (id) on delete set null,
  whatsapp_number  text not null,
  direction        message_direction not null,
  body             text,
  raw_payload      jsonb,
  created_at       timestamptz not null default now()
);

create index idx_messages_log_business_id on messages_log (business_id);
create index idx_messages_log_number on messages_log (whatsapp_number);

-- ── updated_at trigger helper ───────────────────────────────────────────

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_businesses_updated_at
  before update on businesses
  for each row execute function set_updated_at();

create trigger trg_bookings_updated_at
  before update on bookings
  for each row execute function set_updated_at();

create trigger trg_invoices_updated_at
  before update on invoices
  for each row execute function set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────
-- The Express backend talks to Supabase via the SERVICE ROLE key, which
-- bypasses RLS entirely. These policies only take effect once a dashboard
-- or customer-facing app connects with the anon/authenticated key — they
-- scope every row to its owning business via a `business_id` JWT claim.

alter table businesses enable row level security;
alter table services enable row level security;
alter table customers enable row level security;
alter table bookings enable row level security;
alter table invoices enable row level security;
alter table conversation_state enable row level security;
alter table messages_log enable row level security;

create policy "Business can read own row"
  on businesses for select
  using (id = (auth.jwt() ->> 'business_id')::uuid);

create policy "Tenant isolation: services"
  on services for all
  using (business_id = (auth.jwt() ->> 'business_id')::uuid)
  with check (business_id = (auth.jwt() ->> 'business_id')::uuid);

create policy "Tenant isolation: customers"
  on customers for all
  using (business_id = (auth.jwt() ->> 'business_id')::uuid)
  with check (business_id = (auth.jwt() ->> 'business_id')::uuid);

create policy "Tenant isolation: bookings"
  on bookings for all
  using (business_id = (auth.jwt() ->> 'business_id')::uuid)
  with check (business_id = (auth.jwt() ->> 'business_id')::uuid);

create policy "Tenant isolation: invoices"
  on invoices for all
  using (business_id = (auth.jwt() ->> 'business_id')::uuid)
  with check (business_id = (auth.jwt() ->> 'business_id')::uuid);

create policy "Tenant isolation: conversation_state"
  on conversation_state for all
  using (business_id = (auth.jwt() ->> 'business_id')::uuid)
  with check (business_id = (auth.jwt() ->> 'business_id')::uuid);

create policy "Tenant isolation: messages_log"
  on messages_log for all
  using (business_id = (auth.jwt() ->> 'business_id')::uuid)
  with check (business_id = (auth.jwt() ->> 'business_id')::uuid);
