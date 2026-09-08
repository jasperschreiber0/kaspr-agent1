-- Readiness verifies the schema and backend RPC access, not only a version literal.
create or replace function public.kaspr_recovery_version() returns integer
language plpgsql stable set search_path=public as $$
declare fn text;
begin
 if to_regclass('public.recovery_outbox') is null or to_regclass('public.recovery_inbox') is null
 or to_regclass('public.recovery_delivery_events') is null then return 0; end if;
 foreach fn in array array[
 'public.kaspr_capture_sms(text,text,text,text)',
 'public.kaspr_capture_missed_call(text,text,text,text)',
 'public.kaspr_claim_inbox()', 'public.kaspr_claim_outbox()',
 'public.kaspr_complete_send(uuid,text)', 'public.kaspr_fail_send(uuid,text,text)',
 'public.kaspr_delivery_status(uuid,text,text,text)', 'public.kaspr_queue_reviews()'] loop
  if to_regprocedure(fn) is null then return 0; end if;
  if not has_function_privilege('service_role',fn,'EXECUTE') then return 0; end if;
 end loop;
 return 2;
end $$;
