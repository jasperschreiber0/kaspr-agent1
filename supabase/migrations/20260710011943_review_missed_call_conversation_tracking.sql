-- Schema for three features shipped on claude/live-website-content-fix-i5iovq:
--   1. Google review requests (src/reviewRequest.js)
--   2. Missed-call SMS auto-reply (src/voiceWebhook.js)
--   3. DM/comment conversation logging for the owner dashboard (src/conversationLog.js)
--
-- All application code that reads/writes these already degrades gracefully
-- if a table or column is missing (best-effort inserts, caught lookup
-- errors) — running this is what turns those from silent no-ops into the
-- real thing.

-- ─── 1. Google review requests ─────────────────────────────────────────────

alter table clients
  add column if not exists google_review_link text;

create table if not exists review_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  sent_at timestamptz not null default now()
);

create index if not exists review_requests_client_id_idx
  on review_requests(client_id);

-- ─── 2. Missed-call SMS ─────────────────────────────────────────────────────

alter table clients
  add column if not exists twilio_voice_number text,
  add column if not exists call_forward_number text;

-- Each Twilio voice number is dedicated to exactly one client.
create unique index if not exists clients_twilio_voice_number_idx
  on clients(twilio_voice_number)
  where twilio_voice_number is not null;

create table if not exists missed_calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  caller_phone text not null,
  dial_status text not null, -- 'no-answer' | 'busy' | 'failed' | 'canceled'
  sms_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists missed_calls_client_id_idx
  on missed_calls(client_id);

-- ─── 3. DM / comment conversation logging (owner dashboard) ───────────────

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  platform_sender_id text not null, -- IG-scoped sender/commenter ID
  channel text not null,            -- 'dm' | 'comment'
  inbound_text text,
  reply_text text,
  is_new_conversation boolean not null default true,
  received_at timestamptz not null,
  responded_at timestamptz not null,
  response_ms integer not null,
  created_at timestamptz not null default now()
);

create index if not exists conversations_client_id_idx
  on conversations(client_id);

-- Matches the lookup conversationLog.js does on every inbound event to
-- work out is_new_conversation.
create index if not exists conversations_client_sender_idx
  on conversations(client_id, platform_sender_id);

create index if not exists conversations_received_at_idx
  on conversations(received_at);
