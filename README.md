# BizBot SA — Backend (Week 1 scaffold)

WhatsApp Business Operating System for South African micro-businesses.
This is the Week 1 slice of the 30-day MVP plan: **infrastructure +
onboarding** — a working Express/TypeScript backend, the full Supabase
schema, a WhatsApp Cloud API webhook handler, signature verification, an
AI intent classifier, and a guided WhatsApp onboarding flow for new
businesses.

## What's implemented

- **Database** — `supabase/migrations/0001_init.sql`: `businesses`,
  `services`, `customers`, `bookings`, `invoices`, `conversation_state`,
  `messages_log`. Enums, indexes (incl. partial indexes for the reminder
  and overdue-invoice crons), `updated_at` triggers, and tenant-isolation
  RLS policies for future dashboard/customer-facing access.
- **WhatsApp webhook** — `GET /webhooks/whatsapp` (Meta verification
  challenge) and `POST /webhooks/whatsapp` (inbound messages), with
  `X-Hub-Signature-256` verification.
- **Onboarding flow** — a brand-new WhatsApp number messaging the bot
  triggers a guided setup: business name → business type → first service
  (name, price, duration) → done. Creates the `businesses` row and seeds
  `services`.
- **Message router** — every message from an onboarded business owner is
  logged and classified by Claude Haiku into one of the 8 product intents
  (`booking_request`, `quote_command`, `invoice_command`, `payment_record`,
  `expense_log`, `marketing_request`, `report_request`, `general_query`).
  The owner gets an immediate acknowledgement.
- **Message logging** — every inbound/outbound message is written to
  `messages_log` for debugging and future AI context.

## What's intentionally stubbed (Weeks 2-4)

The intent classifier routes correctly, but the actual feature handlers —
booking engine + reminders, quote/invoice PDF generation + Yoco payment
links, automated payment follow-up, marketing writer, weekly business
report — aren't built yet. `handleOwnerMessage` in
`src/flows/router.ts` is the plug-in point for each of those, keyed off
`intent.intent`.

## Setup

```bash
npm install
cp .env.example .env   # fill in real values
npm run dev             # tsx watch — local dev
npm run build && npm start   # production
npm run typecheck        # tsc --noEmit
```

### Environment variables

See `.env.example`. You'll need:

- A **Supabase** project — run `supabase/migrations/0001_init.sql` against
  it (Supabase SQL editor, or `supabase db push` if using the CLI), then
  copy the project URL and **service role key** (server-side only).
- A **Meta WhatsApp Business Account (WABA)** with the Cloud API — phone
  number ID, a permanent access token, a verify token of your choosing,
  and (for production) the App Secret for webhook signature verification.
- An **Anthropic API key** for the intent classifier (Claude Haiku).

### Connecting the webhook

1. Deploy the app (e.g. Render — per the architecture spec) so
   `/webhooks/whatsapp` is publicly reachable over HTTPS.
2. In the Meta App Dashboard, set the webhook callback URL to
   `https://your-domain/webhooks/whatsapp` and the verify token to match
   `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe to the `messages` webhook field.

## Project structure

```
src/
  server.ts                  # Express app entry point
  config/
    env.ts                   # env var loading + validation
    supabase.ts              # Supabase service-role client
  lib/
    whatsapp.ts              # send messages, verify signatures, parse payloads
    claude.ts                # Claude Haiku intent classifier
  flows/
    onboarding.ts            # guided new-business setup state machine
    router.ts                # top-level message router
  webhooks/
    whatsapp.controller.ts   # GET verification + POST message handler
  types/
    index.ts                 # shared domain types
    express.d.ts             # Request.rawBody augmentation

supabase/
  migrations/
    0001_init.sql            # full schema, indexes, triggers, RLS
```

## Notes

- The Express layer uses the Supabase **service role key**, which bypasses
  RLS — the policies in the migration matter once a dashboard or
  customer-facing app connects with the anon/authenticated key.
- `WHATSAPP_APP_SECRET` can be left blank for local development (signature
  verification is skipped); set it in production.
- The onboarding service parser (`parseServiceLine`) is a deliberately
  simple heuristic — the richer natural-language quote/invoice parser
  (Section 7 of the product spec) is a Week 3 deliverable.
