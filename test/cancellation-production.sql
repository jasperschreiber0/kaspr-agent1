-- No global queue claims. Only rows created inside this rollback transaction.
begin;
do $$
declare c uuid; t uuid; o public.recovery_outbox; marker timestamptz; phone text='foundation-rollback-only';
begin
 insert into public.clients(business_name,niche,whatsapp_numbers,active,recovery_enabled,recovery_sms_number)
 values('Kaspr cancellation rollback fixture','test','{}',true,true,'+15005550006') returning id into c;
 insert into public.recovery_threads(client_id,phone) values(c,phone) returning id into t;
 insert into public.recovery_outbox(client_id,phone,body,kind,dedupe_key,status,claimed_at)
 values(c,phone,'fixture','reply','foundation-rollback-1','sending',clock_timestamp()) returning * into o;
 if public.kaspr_takeover(gen_random_uuid(),t) then raise exception 'Cross-tenant takeover'; end if;
 perform public.kaspr_takeover(c,t);
 if public.kaspr_authorize_send(o.id,o.claimed_at) then raise exception 'Takeover did not cancel'; end if;
 if (select status from public.recovery_outbox where id=o.id)<>'suppressed' then raise exception 'Claim not suppressed'; end if;
 update public.recovery_threads set state='service' where id=t;
 insert into public.recovery_outbox(client_id,phone,body,kind,dedupe_key,status,claimed_at)
 values(c,phone,'fixture','reply','foundation-rollback-2','sending',clock_timestamp()) returning * into o;
 if not public.kaspr_authorize_send(o.id,o.claimed_at) then raise exception 'Valid dispatch blocked'; end if;
 if public.kaspr_authorize_send(o.id,o.claimed_at) then raise exception 'Lease replay'; end if;
 perform public.kaspr_takeover(c,t);
 perform public.kaspr_complete_send(o.id,'SM-foundation-rollback-accepted');
 if (select provider_sid from public.recovery_outbox where id=o.id)<>'SM-foundation-rollback-accepted' then raise exception 'Accepted SID lost'; end if;
 update public.recovery_threads set state='service' where id=t;
 insert into public.recovery_outbox(client_id,phone,body,kind,dedupe_key,status,claimed_at)
 values(c,phone,'fixture','reply','foundation-rollback-3','sending',clock_timestamp()) returning * into o;
 insert into public.suppressed_contacts(phone) values(phone);
 if public.kaspr_authorize_send(o.id,o.claimed_at) then raise exception 'STOP did not cancel'; end if;
end $$;
select 'PASS: scoped live SQL takeover, tenant mismatch, claim cancellation, dispatch replay, accepted SID preservation, STOP; no transport' as result;
rollback;
