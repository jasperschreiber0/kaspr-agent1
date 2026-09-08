-- Platform-independent conversations. Backend access only; sending requires opt-in.
alter table clients add column if not exists recovery_enabled boolean not null default false;
alter table clients add column if not exists recovery_sms_number text;
alter table clients add column if not exists booking_url text;
alter table clients add column if not exists recovery_services jsonb not null default '[]';
alter table clients add column if not exists recovery_policies text;
alter table clients add column if not exists review_url text;
alter table clients add column if not exists review_enabled boolean not null default false;
create unique index if not exists recovery_sms_number_unique on clients(recovery_sms_number) where recovery_sms_number is not null;
create table if not exists suppressed_contacts (
 id uuid primary key default gen_random_uuid(),phone text not null unique,
 client_id uuid references clients(id),reason text not null default 'STOP',suppressed_at timestamptz not null default now()
);
-- Preserve existing per-client suppression rows and allow global opt-outs.
alter table suppressed_contacts alter column client_id drop not null;
create unique index if not exists suppressed_global_phone on suppressed_contacts(phone) where client_id is null;
create table recovery_call_outcomes (
 sid text primary key, client_id uuid references clients(id), phone text not null,
 outcome text not null, created_at timestamptz not null default now()
);
alter table recovery_call_outcomes enable row level security;
revoke all on recovery_call_outcomes from anon,authenticated;
grant all on recovery_call_outcomes to service_role;
create table recovery_threads (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references clients(id),
 phone text not null, opportunity_id uuid references revenue_opportunities(id),
 state text not null default 'service' check(state in ('service','time','handoff','human','closed')),
 service text,preferred_time text,summary text, updated_at timestamptz not null default now(),
 unique(client_id,phone)
);
create table recovery_inbox (
 id uuid primary key default gen_random_uuid(),sid text not null unique,
 phone text not null,destination text not null,body text not null,
 thread_id uuid references recovery_threads(id),status text not null default 'pending'
 check(status in ('pending','processing','done','unmatched')),lease_until timestamptz,
 created_at timestamptz not null default now()
);
create table recovery_outbox (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references clients(id),
 phone text not null,body text not null,kind text not null check(kind in ('recovery','reply','review')),
 opportunity_id uuid references revenue_opportunities(id),dedupe_key text not null unique,
 status text not null default 'pending' check(status in ('pending','sending','sent','suppressed','uncertain','failed')),
 attempts integer not null default 0, last_error text, delivery_status text, delivery_error text, delivered_at timestamptz, reconciled_at timestamptz, provider_sid text unique,available_at timestamptz not null default now(),claimed_at timestamptz,
 created_at timestamptz not null default now(),sent_at timestamptz
);
create index recovery_inbox_pending on recovery_inbox(status,created_at);
create index recovery_outbox_pending on recovery_outbox(status,available_at);
alter table recovery_threads enable row level security;
alter table recovery_inbox enable row level security;
alter table recovery_outbox enable row level security;
alter table suppressed_contacts enable row level security;
revoke all on recovery_threads,recovery_inbox,recovery_outbox,suppressed_contacts from anon,authenticated;
grant all on recovery_threads,recovery_inbox,recovery_outbox,suppressed_contacts to service_role;

create function kaspr_capture_sms(p_sid text,p_phone text,p_to text,p_body text) returns void
language plpgsql set search_path=public as $$
declare c clients; t recovery_threads; ids uuid[];
begin
 if p_sid is null or p_sid='' or length(p_body)>1600 then raise exception 'Invalid message'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_sid,0));
 if exists(select 1 from recovery_inbox where sid=p_sid) then return; end if;
 if upper(trim(p_body)) in ('STOP','STOP ALL','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT') then
  insert into suppressed_contacts(phone,reason) values(p_phone,'STOP') on conflict(phone) where client_id is null do nothing;
  update recovery_outbox set status='suppressed' where phone=p_phone and status='pending';
  insert into recovery_inbox(sid,phone,destination,body,status) values(p_sid,p_phone,p_to,p_body,'done') on conflict do nothing;
  return;
 end if;
 select * into c from clients where active and recovery_enabled and recovery_sms_number=p_to;
 if not found then
  insert into recovery_inbox(sid,phone,destination,body,status) values(p_sid,p_phone,p_to,p_body,'unmatched') on conflict do nothing;
  return;
 end if;
 insert into recovery_threads(client_id,phone) values(c.id,p_phone) on conflict do nothing;
 select * into t from recovery_threads where client_id=c.id and phone=p_phone for update;
 select array_agg(id) into ids from revenue_opportunities where client_id=c.id and customer_phone=p_phone
 and status in ('identified','contacted','responded') and detected_at>now()-interval '7 days';
 if coalesce(array_length(ids,1),0)=1 then
  update recovery_threads set opportunity_id=ids[1] where id=t.id;
  insert into revenue_events(opportunity_id,client_id,event_name,source_message_sid,metadata)
  values(ids[1],c.id,'customer_replied',p_sid,jsonb_build_object('body',p_body,'channel','sms')) on conflict do nothing;
  update revenue_opportunities set status='responded' where id=ids[1] and status in ('identified','contacted','responded');
 end if;
 insert into recovery_inbox(sid,phone,destination,body,thread_id) values(p_sid,p_phone,p_to,p_body,t.id) on conflict do nothing;
end; $$;

create function kaspr_capture_missed_call(p_sid text,p_to text,p_phone text,p_status text) returns void
language plpgsql set search_path=public as $$
declare c clients; m uuid; o uuid;
begin
 if p_status not in ('no-answer','busy','failed','canceled','completed') then raise exception 'Unsupported call outcome'; end if;
 if p_sid is null or p_sid='' then raise exception 'Call SID required'; end if;
 select * into c from clients where active and twilio_voice_number=p_to;
 if not found then return; end if;
 insert into recovery_call_outcomes(sid,client_id,phone,outcome) values(p_sid,c.id,p_phone,p_status) on conflict do nothing;
 if not found or p_status='completed' or not c.recovery_enabled then return; end if;
 insert into missed_calls(client_id,caller_phone,dial_status,twilio_call_sid) values(c.id,p_phone,p_status,p_sid)
 on conflict do nothing returning id into m;
 if m is null then return; end if;
 insert into revenue_opportunities(client_id,customer_phone,type,source_call_sid,source_missed_call_id)
 values(c.id,p_phone,'missed_call',p_sid,m) returning id into o;
 insert into revenue_events(opportunity_id,client_id,event_name) values(o,c.id,'opportunity_created');
 insert into recovery_outbox(client_id,phone,body,kind,opportunity_id,dedupe_key,available_at)
 values(c.id,p_phone,'Hi from '||c.business_name||'. Sorry we missed your call. What service would you like to book? Reply STOP to opt out.',
 'recovery',o,'call:'||p_sid,now()+interval '60 seconds');
end; $$;

create function kaspr_claim_inbox() returns setof recovery_inbox language plpgsql set search_path=public as $$
declare i recovery_inbox;
begin
 update recovery_inbox set status='pending' where status='processing' and lease_until<now();
 select * into i from recovery_inbox a where a.status='pending'
 and not exists(select 1 from recovery_inbox b where b.thread_id=a.thread_id and b.status='processing')
 order by created_at,id for update skip locked limit 1;
 if not found then return; end if;
 perform 1 from recovery_threads where id=i.thread_id for update;
 if exists(select 1 from recovery_inbox where thread_id=i.thread_id and status='processing') then return; end if;
 return query update recovery_inbox set status='processing',lease_until=now()+interval '2 minutes' where id=i.id returning *;
end; $$;

create function kaspr_finish_reply(p_id uuid,p_lease timestamptz,p_state text,p_service text,p_time text,p_summary text,p_reply text)
returns void language plpgsql set search_path=public as $$
declare i recovery_inbox; t recovery_threads;
begin
 select * into i from recovery_inbox where id=p_id for update;
 if i.status<>'processing' or i.lease_until is distinct from p_lease then return; end if;
 select * into t from recovery_threads where id=i.thread_id for update;
 if t.state in ('handoff','human','closed') then
  update recovery_inbox set status='done' where id=i.id; return;
 end if;
 update recovery_threads set state=p_state,service=p_service,preferred_time=p_time,summary=p_summary,updated_at=now() where id=t.id;
 if p_reply is not null and p_reply<>'' then
  insert into recovery_outbox(client_id,phone,body,kind,opportunity_id,dedupe_key)
  values(t.client_id,t.phone,p_reply,'reply',t.opportunity_id,'reply:'||i.sid) on conflict do nothing;
 end if;
 update recovery_inbox set status='done' where id=i.id;
end; $$;

create function kaspr_queue_reviews() returns void language plpgsql set search_path=public as $$
begin
 insert into recovery_outbox(client_id,phone,body,kind,opportunity_id,dedupe_key)
 select o.client_id,o.customer_phone,'Thanks for visiting '||c.business_name||'. We would appreciate your honest Google review: '||c.review_url||' Reply STOP to opt out.',
 'review',o.id,'review:'||o.client_id||':'||o.booking_id
 from revenue_opportunities o join clients c on c.id=o.client_id
 where c.active and c.recovery_enabled and c.review_enabled and c.review_url like 'https://%'
 and o.status='completed' and o.booking_id is not null and o.customer_phone is not null
 and exists(select 1 from revenue_events e where e.opportunity_id=o.id and e.event_name='appointment_completed'
 and e.created_at between now()-interval '7 days' and now()-interval '24 hours')
 on conflict do nothing;
end; $$;

create function kaspr_claim_outbox() returns setof recovery_outbox language plpgsql set search_path=public as $$
declare o recovery_outbox; c clients;
begin
 -- Delivery is ambiguous after a crash. Never blindly resend it.
 update recovery_outbox set status='uncertain' where status='sending' and claimed_at<now()-interval '5 minutes';
 select * into o from recovery_outbox where status='pending' and available_at<=now() order by created_at,id for update skip locked limit 1;
 if not found then return; end if;
 select * into c from clients where id=o.client_id for update;
 if c.active is not true or c.recovery_enabled is not true or c.recovery_sms_number is null
 or exists(select 1 from suppressed_contacts where phone=o.phone)
 or (o.kind='review' and (not c.review_enabled or not exists(select 1 from revenue_opportunities where id=o.opportunity_id and status='completed')))
 or (o.kind='reply' and exists(select 1 from recovery_threads where client_id=o.client_id and phone=o.phone and state='closed'))
 or exists(select 1 from recovery_outbox b where b.client_id=o.client_id and b.phone=o.phone and b.id<>o.id
 and b.kind=o.kind and b.status in ('sending','sent','uncertain') and b.created_at>now()-case when o.kind='review' then interval '90 days' when o.kind='recovery' then interval '24 hours' else interval '0 seconds' end)
 or (select count(*) from recovery_outbox b where b.client_id=o.client_id and b.phone=o.phone and b.status in ('sending','sent','uncertain') and b.created_at>now()-interval '24 hours')>=8 then
  update recovery_outbox set status='suppressed' where id=o.id; return;
 end if;
 return query update recovery_outbox set status='sending',claimed_at=now(),attempts=attempts+1 where id=o.id returning *;
end; $$;

create function kaspr_complete_send(p_id uuid,p_sid text) returns void language plpgsql set search_path=public as $$
declare o recovery_outbox;
begin
 select * into o from recovery_outbox where id=p_id for update;
 if o.status='sent' then
  if o.provider_sid is distinct from p_sid then raise exception 'Provider SID mismatch'; end if;
  return; end if;
 if not found or o.status not in ('sending','uncertain') or p_sid is null or p_sid='' then raise exception 'Invalid send completion'; end if;
 update recovery_outbox set status='sent',provider_sid=p_sid,sent_at=now() where id=o.id;
 if o.kind='recovery' then
  update revenue_opportunities set status='contacted' where id=o.opportunity_id and status='identified';
  update missed_calls set sms_sent=true where id=(select source_missed_call_id from revenue_opportunities where id=o.opportunity_id);
  insert into revenue_events(opportunity_id,client_id,event_name,metadata) values(o.opportunity_id,o.client_id,'customer_contacted',jsonb_build_object('provider_sid',p_sid));
 end if;
end; $$;

create function kaspr_fail_send(p_id uuid,p_outcome text,p_code text) returns void
language plpgsql set search_path=public as $$
declare o recovery_outbox;
begin
 select * into o from recovery_outbox where id=p_id for update;
 if not found or o.status<>'sending' then return; end if;
 if p_outcome not in ('retry','failed','uncertain','suppressed') then raise exception 'Invalid outcome'; end if;
 update recovery_outbox set
 status=case when p_outcome='retry' and attempts<5 then 'pending' when p_outcome='retry' then 'failed' else p_outcome end,
 last_error=left(p_code,100),
 available_at=now()+make_interval(secs=>least(3600,30*power(2,attempts-1))*(0.9+random()*0.2))
 where id=o.id;
end; $$;

create table recovery_delivery_events (
 id uuid primary key default gen_random_uuid(),outbox_id uuid not null references recovery_outbox(id),
 provider_sid text not null,status text not null,error_code text,created_at timestamptz not null default now(),
 unique(provider_sid,status)
);
alter table recovery_delivery_events enable row level security;
revoke all on recovery_delivery_events from anon,authenticated;
grant all on recovery_delivery_events to service_role;
create function kaspr_delivery_status(p_id uuid,p_sid text,p_status text,p_error text) returns void
language plpgsql set search_path=public as $$
declare o recovery_outbox; old_rank integer; new_rank integer;
begin
 if p_status not in ('accepted','queued','sending','sent','delivered','undelivered','failed','read','canceled') then raise exception 'Invalid delivery status'; end if;
 select * into o from recovery_outbox where id=p_id for update;
 if not found then raise exception 'Outbox not found'; end if;
 if o.provider_sid is not null and o.provider_sid<>p_sid then raise exception 'Provider SID mismatch'; end if;
 -- Callback may arrive before the worker records acceptance, or after a crash.
 perform kaspr_complete_send(p_id,p_sid);
 insert into recovery_delivery_events(outbox_id,provider_sid,status,error_code) values(p_id,p_sid,p_status,p_error) on conflict do nothing;
 old_rank=case o.delivery_status when 'accepted' then 1 when 'queued' then 2 when 'sending' then 3 when 'sent' then 4 when 'failed' then 5 when 'undelivered' then 5 when 'canceled' then 5 when 'delivered' then 6 when 'read' then 7 else 0 end;
 new_rank=case p_status when 'accepted' then 1 when 'queued' then 2 when 'sending' then 3 when 'sent' then 4 when 'failed' then 5 when 'undelivered' then 5 when 'canceled' then 5 when 'delivered' then 6 when 'read' then 7 end;
 update recovery_outbox set reconciled_at=now() where id=p_id;
 if new_rank>=old_rank then
  update recovery_outbox set delivery_status=p_status,delivery_error=p_error,
  delivered_at=case when p_status in ('delivered','read') then coalesce(delivered_at,now()) else delivered_at end where id=p_id;
 end if;
end; $$;
create function kaspr_recovery_version() returns integer language sql stable as $$ select 2; $$;

-- Functions use invoker rights; no anonymous or dashboard-user RPC access.
do $$ declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
 and proname in ('kaspr_capture_sms','kaspr_capture_missed_call','kaspr_claim_inbox','kaspr_finish_reply','kaspr_queue_reviews','kaspr_claim_outbox','kaspr_complete_send','kaspr_fail_send','kaspr_delivery_status','kaspr_recovery_version') loop
 execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
 execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end $$;
