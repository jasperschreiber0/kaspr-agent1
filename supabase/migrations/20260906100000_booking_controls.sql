-- Backend-only atomic booking lifecycle. Apply after 20260906090000.
alter table public.revenue_opportunities enable row level security;
alter table public.revenue_events enable row level security;
revoke all on public.revenue_opportunities, public.revenue_events from anon, authenticated;
alter table public.revenue_opportunities add column if not exists completed_value numeric(12,2);
create or replace function public.kaspr_booking_transition(
 p_opportunity uuid,p_client uuid,p_action text,p_booking text,p_value numeric
) returns void language plpgsql set search_path=public as $$
declare o public.revenue_opportunities;
begin
 select * into o from public.revenue_opportunities where id=p_opportunity and client_id=p_client for update;
 if not found then raise exception 'Opportunity not found for client'; end if;
 if p_booking is null or length(trim(p_booking))=0 or p_value is null or p_value<0
 or p_value::text in ('NaN','Infinity','-Infinity') then raise exception 'Valid booking and value required'; end if;
 if p_action='appointment_booked' then
   if o.status not in ('contacted','responded') then raise exception 'Contacted opportunity required'; end if;
   update public.revenue_opportunities set status='booked',booking_id=p_booking,estimated_value=p_value where id=o.id;
 elsif p_action='appointment_completed' then
   if o.status<>'booked' or o.booking_id is distinct from p_booking then raise exception 'Matching booking required'; end if;
   update public.revenue_opportunities set status='completed',completed_value=p_value where id=o.id;
 elsif p_action='revenue_attributed' then
   if o.status<>'completed' or o.booking_id is distinct from p_booking or o.completed_value is distinct from p_value then
     raise exception 'Matching completion and value required'; end if;
   if o.recovered_value is not null then
     if o.recovered_value=p_value then return; end if;
     raise exception 'Already attributed';
   end if;
   update public.revenue_opportunities set recovered_value=p_value,attribution_method='verified_completed_booking' where id=o.id;
 else raise exception 'Unsupported transition'; end if;
 insert into public.revenue_events(opportunity_id,client_id,event_name,metadata)
 values(o.id,o.client_id,p_action,jsonb_build_object('booking_id',p_booking,'value',p_value));
end; $$;
revoke all on function public.kaspr_booking_transition(uuid,uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.kaspr_booking_transition(uuid,uuid,text,text,numeric) to service_role;

alter table public.revenue_events add column if not exists source_message_sid text;
create unique index if not exists revenue_events_message_sid_idx on public.revenue_events(source_message_sid)
where source_message_sid is not null;
create or replace function public.kaspr_record_reply(p_phone text,p_body text,p_sid text)
returns uuid language plpgsql set search_path=public as $$
declare ids uuid[]; o public.revenue_opportunities;
begin
 if p_sid is null or p_sid='' or p_body is null or length(trim(p_body))=0 then return null; end if;
 select array_agg(id) into ids from public.revenue_opportunities
 where customer_phone=p_phone and status in ('contacted','responded') and detected_at>=now()-interval '7 days';
 if coalesce(array_length(ids,1),0)<>1 then return null; end if;
 select * into o from public.revenue_opportunities where id=ids[1] for update;
 if o.status not in ('contacted','responded') then return null; end if;
 insert into public.revenue_events(opportunity_id,client_id,event_name,source_message_sid,metadata)
 values(o.id,o.client_id,'customer_replied',p_sid,jsonb_build_object('body',p_body,'channel','sms')) on conflict do nothing;
 if found then update public.revenue_opportunities set status='responded' where id=o.id; end if;
 return o.id;
end; $$;
revoke all on function public.kaspr_record_reply(text,text,text) from public,anon,authenticated;
grant execute on function public.kaspr_record_reply(text,text,text) to service_role;

create or replace function public.kaspr_protect_events() returns trigger language plpgsql as $$
begin raise exception 'Revenue events are append-only'; end; $$;
drop trigger if exists kaspr_events_immutable on public.revenue_events;
create trigger kaspr_events_immutable before update or delete on public.revenue_events
for each row execute function public.kaspr_protect_events();

create or replace function public.kaspr_revenue_summary(p_since timestamptz)
returns table(client_id uuid,recovered_revenue numeric,open_opportunities bigint,recovered_bookings bigint)
language sql stable set search_path=public as $$
 select c.id,
 coalesce((select sum(o.recovered_value) from revenue_opportunities o
 where o.client_id=c.id and exists(select 1 from revenue_events e where e.opportunity_id=o.id
 and e.event_name='revenue_attributed' and e.created_at>=p_since)),0),
 (select count(*) from revenue_opportunities o where o.client_id=c.id and o.status in ('identified','contacted','responded')),
 (select count(*) from revenue_opportunities o where o.client_id=c.id and o.status in ('booked','completed')
 and exists(select 1 from revenue_events e where e.opportunity_id=o.id and e.event_name='appointment_booked' and e.created_at>=p_since))
 from clients c where c.active=true;
$$;
revoke all on function public.kaspr_revenue_summary(timestamptz) from public,anon,authenticated;
grant execute on function public.kaspr_revenue_summary(timestamptz) to service_role;
