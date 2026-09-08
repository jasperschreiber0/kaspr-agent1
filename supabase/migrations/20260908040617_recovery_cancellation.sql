-- Transport controls only: no new enquiry/product model.
alter table public.recovery_outbox add column dispatch_started_at timestamptz;
alter table public.recovery_inbox add column received_order bigint generated always as identity;
alter table public.recovery_inbox add column processing_attempts integer not null default 0;
alter table public.recovery_inbox add column next_attempt_at timestamptz not null default now();
alter table public.recovery_inbox add column last_error text;
create table public.recovery_controls (
 id boolean primary key default true check(id), paused boolean not null default false
);
insert into public.recovery_controls(id) values(true);
alter table public.recovery_controls enable row level security;
revoke all on public.recovery_controls from public,anon,authenticated;
grant select,update on public.recovery_controls to service_role;

create function public.kaspr_cancel_unsent() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_table_name='recovery_threads' then
  if new.state in ('human','closed') then
   update public.recovery_outbox set status='suppressed',last_error='conversation_taken_over'
    where client_id=new.client_id and phone=new.phone and kind in ('reply','recovery')
    and (status='pending' or (status='sending' and dispatch_started_at is null));
  end if;
 elsif tg_table_name='suppressed_contacts' then
  update public.recovery_outbox set status='suppressed',last_error='opt_out'
   where phone=new.phone and (status='pending' or (status='sending' and dispatch_started_at is null));
 end if;
 return new;
end $$;
create trigger cancel_on_takeover after update of state on public.recovery_threads
for each row execute function public.kaspr_cancel_unsent();
create trigger cancel_on_optout after insert or update on public.suppressed_contacts
for each row execute function public.kaspr_cancel_unsent();

-- Only backend callers can take over an existing thread. Tenant identity must
-- also be checked by any future application caller before invoking this RPC.
create function public.kaspr_takeover(p_client uuid,p_thread uuid) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
begin
 update public.recovery_threads set state='human',updated_at=now() where id=p_thread and client_id=p_client;
 return found;
end $$;

-- Final gate executed by the sender after suppression lookup and immediately
-- before calling Twilio. Once this returns true, cancellation is best effort:
-- DB + provider transport cannot share an atomic transaction.
create function public.kaspr_authorize_send(p_id uuid,p_claimed timestamptz) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare o public.recovery_outbox; t public.recovery_threads; blocked boolean;
begin
 select * into o from public.recovery_outbox where id=p_id for update;
 if not found or o.status<>'sending' or o.claimed_at is distinct from p_claimed or o.dispatch_started_at is not null then return false; end if;
 select * into t from public.recovery_threads where client_id=o.client_id and phone=o.phone;
 blocked := (select paused from public.recovery_controls where id)
  or not exists(select 1 from public.clients where id=o.client_id and active and recovery_enabled and recovery_sms_number is not null)
  or exists(select 1 from public.suppressed_contacts where phone=o.phone)
  or (o.kind in ('reply','recovery') and coalesce(t.state in ('human','closed'),false))
  or (o.kind='review' and not exists(select 1 from public.clients c join public.revenue_opportunities r on r.client_id=c.id where c.id=o.client_id and c.review_enabled and r.id=o.opportunity_id and r.status='completed'))
  or (o.kind='recovery' and exists(select 1 from public.recovery_inbox i where i.thread_id=t.id and i.created_at>=o.created_at))
  or (o.kind='reply' and exists(select 1 from public.recovery_inbox newer join public.recovery_inbox source on source.sid=substring(o.dedupe_key from 7) where newer.thread_id=source.thread_id and newer.received_order>source.received_order));
 if blocked then
  update public.recovery_outbox set status='suppressed',last_error='stale_paused_or_suppressed' where id=o.id;
  return false;
 end if;
 update public.recovery_outbox set dispatch_started_at=clock_timestamp() where id=o.id;
 return true;
end $$;

-- Reset dispatch marker only for a definitely rejected, safely retryable send.
create function public.kaspr_reset_dispatch() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.status='pending' and old.status='sending' then new.dispatch_started_at=null; end if;
 return new;
end $$;
create trigger reset_dispatch before update of status on public.recovery_outbox for each row execute function public.kaspr_reset_dispatch();

create or replace function public.kaspr_claim_inbox() returns setof public.recovery_inbox
language plpgsql set search_path=pg_catalog,public as $$
declare i public.recovery_inbox;
begin
 if (select paused from public.recovery_controls where id) then return; end if;
 update public.recovery_inbox set status='pending' where status='processing' and lease_until<now();
 select * into i from public.recovery_inbox a where a.status='pending' and a.processing_attempts<5 and a.next_attempt_at<=now()
 and not exists(select 1 from public.recovery_inbox b where b.thread_id=a.thread_id and b.status='processing')
 order by received_order for update skip locked limit 1;
 if not found then return; end if;
 perform 1 from public.recovery_threads where id=i.thread_id for update;
 if exists(select 1 from public.recovery_inbox where thread_id=i.thread_id and status='processing') then return; end if;
 return query update public.recovery_inbox set status='processing',lease_until=clock_timestamp()+interval '2 minutes',processing_attempts=processing_attempts+1 where id=i.id returning *;
end $$;
create function public.kaspr_fail_inbox(p_id uuid,p_lease timestamptz) returns void
language sql set search_path=pg_catalog,public as $$
 update public.recovery_inbox set status='pending',last_error='processing_failed',next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,processing_attempts-1)))
 where id=p_id and status='processing' and lease_until=p_lease;
$$;

create function public.kaspr_recovery_metrics() returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object(
 'paused',(select paused from public.recovery_controls where id),
 'stalled_outbox',(select count(*) from public.recovery_outbox where status='pending' and available_at<now()-interval '5 minutes'),
 'uncertain',(select count(*) from public.recovery_outbox where status='uncertain' or (status='sending' and claimed_at<now()-interval '5 minutes')),
 'failed_delivery',(select count(*) from public.recovery_outbox where status='failed' or delivery_status in ('failed','undelivered')),
 'stalled_inbox',(select count(*) from public.recovery_inbox where (status='pending' and created_at<now()-interval '5 minutes') or (status='processing' and lease_until<now())),
 'exhausted_inbox',(select count(*) from public.recovery_inbox where status='pending' and processing_attempts>=5),
 'unreconciled',(select count(*) from public.recovery_outbox where status='sent' and coalesce(delivery_status,'sent') in ('accepted','queued','sending','sent') and sent_at<now()-interval '15 minutes')
 );
$$;
revoke execute on function public.kaspr_cancel_unsent(),public.kaspr_takeover(uuid,uuid),public.kaspr_authorize_send(uuid,timestamptz),public.kaspr_reset_dispatch(),public.kaspr_claim_inbox(),public.kaspr_fail_inbox(uuid,timestamptz),public.kaspr_recovery_metrics() from public,anon,authenticated;
grant execute on function public.kaspr_cancel_unsent(),public.kaspr_takeover(uuid,uuid),public.kaspr_authorize_send(uuid,timestamptz),public.kaspr_reset_dispatch(),public.kaspr_claim_inbox(),public.kaspr_fail_inbox(uuid,timestamptz),public.kaspr_recovery_metrics() to service_role;
grant usage on sequence public.recovery_inbox_received_order_seq to service_role;

create function public.kaspr_foundation_version() returns integer
language sql stable set search_path=pg_catalog,public as $$
 select case when public.kaspr_recovery_version()=2
 and has_function_privilege('service_role','public.kaspr_authorize_send(uuid,timestamptz)','EXECUTE')
 and has_function_privilege('service_role','public.kaspr_recovery_metrics()','EXECUTE') then 3 else 0 end;
$$;
revoke execute on function public.kaspr_foundation_version() from public,anon,authenticated;
grant execute on function public.kaspr_foundation_version() to service_role;
