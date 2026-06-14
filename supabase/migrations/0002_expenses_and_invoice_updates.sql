-- ============================================================================
-- BizBot SA — Migration 0002
-- Adds: expenses table, paid_at + payment_link columns on invoices,
--       increment_visit_count RPC helper.
-- Run AFTER 0001_init.sql
-- ============================================================================

-- ── expenses ─────────────────────────────────────────────────────────────────

create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses (id) on delete cascade,
  amount        numeric(10, 2) not null,
  description   text not null default 'Expense',
  category      text,
  recorded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_expenses_business_id on expenses (business_id);
create index if not exists idx_expenses_recorded_at on expenses (business_id, recorded_at);

alter table expenses enable row level security;

create policy "Tenant isolation: expenses"
  on expenses for all
  using (business_id = (auth.jwt() ->> 'business_id')::uuid)
  with check (business_id = (auth.jwt() ->> 'business_id')::uuid);

-- ── invoices: add paid_at and payment_link if they don't exist ─────────────

alter table invoices
  add column if not exists paid_at timestamptz,
  add column if not exists payment_link text;

-- ── visit count helper ────────────────────────────────────────────────────────

create or replace function increment_visit_count(cust_id uuid)
returns void as $$
  update customers
  set visit_count = visit_count + 1,
      last_visit_at = now()
  where id = cust_id;
$$ language sql;
