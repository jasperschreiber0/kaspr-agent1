begin;
do $$
declare r text; t text; f text;
begin
 foreach r in array array['anon','authenticated'] loop
  execute format('set local role %I',r);
  foreach t in array array['product_queue','agent_memory','email_list','v_pack_usage_current_month'] loop
   begin
    execute format('select * from public.%I where false',t);
    raise exception 'Unexpected browser access to %',t;
   exception when insufficient_privilege then null; end;
  end loop;
  execute 'reset role';
  foreach t in array array['product_queue','agent_memory','email_list'] loop
   if has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Browser write grant on %',t; end if;
  end loop;
  foreach f in array array['public.create_content_pack(uuid,public.content_pack_tier,text)','public.handle_new_upload()','public.update_updated_at()','public.set_revenue_opportunity_updated_at()','public.kaspr_protect_events()'] loop
   if has_function_privilege(r,f,'EXECUTE') then raise exception 'Browser execute grant on %',f; end if;
  end loop;
 end loop;
 execute 'set local role service_role';
 foreach t in array array['product_queue','agent_memory','email_list','v_pack_usage_current_month'] loop
  execute format('select * from public.%I where false',t);
 end loop;
 -- Synthetic insertion/update exercises preserved writer and timestamp trigger.
 insert into public.agent_memory(agent_name,total_runs) values('kaspr-foundation-rollback-fixture',0);
 update public.agent_memory set total_runs=1 where agent_name='kaspr-foundation-rollback-fixture';
 execute 'reset role';
end $$;
select 'PASS: browser read/write/execute denial; service reads and rollback-only write' as result;
rollback;
