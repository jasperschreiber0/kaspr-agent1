-- Revenue recovery foundation for Kaspr.
-- Attribution is recorded by application/business events, never by the model.

-- The original missed-call migration may not have been applied in every
-- Supabase project. Bootstrap this dependency so this migration is safe to
-- run by itself.
create table if not exists missed_calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  caller_phone text not null,
  dial_status text not null,
  sms_sent boolean not null default false,
  created_at timestamptz not null default now()
);

alter table clients
  add column if not exists twilio_voice_number text,
  add column if not exists call_forward_number text;

create unique index if not exists clients_twilio_voice_number_idx
  on clients(twilio_voice_number)
  where twilio_voice_number is not null;

alter table missed_calls add column if not exists twilio_call_sid text;
create unique index if not exists missed_calls_twilio_call_sid_idx
  on missed_calls(twilio_call_sid)
  where twilio_call_sid is not null;

create table if not exists revenue_opportunities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  customer_id uuid,
  customer_phone text,
  source_call_sid text,
  type text not null check (type in ('missed_call', 'cancellation', 'lapsed', 'rebooking', 'abandoned_enquiry')),
  detected_at timestamptz not null default now(),
  estimated_value numeric(12,2),
  status text not null default 'identified' check (status in ('identified', 'contacted', 'responded', 'booked', 'completed', 'lost', 'expired')),
  source_missed_call_id uuid references missed_calls(id) on delete set null,
  booking_id text,
  recovered_value numeric(12,2),
  attribution_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists revenue_opportunities_client_status_idx on revenue_opportunities(client_id, status);
create index if not exists revenue_opportunities_customer_phone_idx on revenue_opportunities(customer_phone);
create unique index if not exists revenue_opportunities_source_call_sid_idx
  on revenue_opportunities(source_call_sid)
  where source_call_sid is not null;
create index if not exists revenue_opportunities_detected_at_idx on revenue_opportunities(detected_at);

create table if not exists revenue_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references revenue_opportunities(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  event_name text not null check (event_name in ('opportunity_created', 'customer_contacted', 'customer_replied', 'appointment_offered', 'appointment_booked', 'appointment_completed', 'appointment_cancelled', 'revenue_attributed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists revenue_events_opportunity_created_idx on revenue_events(opportunity_id, created_at);
create index if not exists revenue_events_client_created_idx on revenue_events(client_id, created_at);

create or replace function set_revenue_opportunity_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists revenue_opportunities_updated_at on revenue_opportunities;
create trigger revenue_opportunities_updated_at
before update on revenue_opportunities
for each row execute function set_revenue_opportunity_updated_at();
