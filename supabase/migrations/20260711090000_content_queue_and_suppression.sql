-- Backfills schema that has existed in production since early on but was
-- never checked into version control. Columns/tables here are inferred
-- from actual application code usage (src/webhook.js, src/queueWriter.js,
-- src/senderAuth.js, src/reply.js, src/smsSender.js, src/igAuth.js) —
-- verify against the live Supabase schema before applying, in case any
-- column was hand-added with a different type or default than assumed
-- here. All statements are idempotent (IF NOT EXISTS) so re-running this
-- against a database that already has some of these objects is safe.

-- ─── Content intake queue ───────────────────────────────────────────────────
-- Written by: agent1 (src/queueWriter.js)
-- Read by:    agent3 (src/supabase.js — processQueue/publishDue),
--             kaspr-site dashboard (last-30-days content received count)

create table if not exists content_queue (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  sender_name text,
  content_type text not null, -- 'photo' | 'video' | 'voice' | 'text' | 'reply_signal'
  storage_path text,
  raw_caption text,
  status text not null default 'pending', -- 'pending' | 'scheduled' | 'processed' | 'failed'
  post_id uuid, -- set once a scheduled_posts row is created from this item
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists content_queue_client_id_idx on content_queue(client_id);
create index if not exists content_queue_status_idx on content_queue(status);
create index if not exists content_queue_received_at_idx on content_queue(received_at);
-- Matches agent3's db.getPendingQueueItems() / getReplySignals() filters
create index if not exists content_queue_client_type_status_idx
  on content_queue(client_id, content_type, status);

-- ─── Global message suppression (Spam Act compliance) ──────────────────────
-- Written by: agent1 (src/webhook.js STOP handler, src/smsWebhook.js)
-- Read by:    agent1 (src/reply.js, src/smsSender.js) before every outbound
--             WhatsApp/SMS send

create table if not exists suppressed_contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  client_id uuid references clients(id) on delete set null, -- nullable: STOP
                                                              -- is handled before
                                                              -- sender identity is known
  reason text not null default 'STOP',
  suppressed_at timestamptz not null default now()
);

create index if not exists suppressed_contacts_phone_idx on suppressed_contacts(phone);

-- ─── Missing `clients` columns referenced throughout agent1 ────────────────
alter table clients
  add column if not exists whatsapp_numbers text[] not null default array[]::text[],
  add column if not exists staff_names jsonb not null default '{}'::jsonb,
  add column if not exists brand_voice text,
  add column if not exists instagram_access_token text,
  add column if not exists instagram_account_id text,
  add column if not exists instagram_connected_at timestamptz,
  add column if not exists instagram_token_expires_at timestamptz;

-- senderAuth.js does `.contains('whatsapp_numbers', [phone])` on every
-- inbound WhatsApp message — without this index that's a sequential scan
-- of the whole clients table on every single message.
create index if not exists clients_whatsapp_numbers_idx on clients using gin(whatsapp_numbers);

create index if not exists clients_instagram_account_id_idx on clients(instagram_account_id)
  where instagram_account_id is not null;
