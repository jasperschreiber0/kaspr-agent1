begin;
insert into auth.users(id) values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into clients(id,business_name,niche,whatsapp_numbers,active) values
 ('20000000-0000-4000-8000-000000000001','RLS fixture A','test','{}',false),
 ('20000000-0000-4000-8000-000000000002','RLS fixture B','test','{}',false);
insert into tenant_memberships values
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002');
insert into content_queue(client_id,content_type) values('20000000-0000-4000-8000-000000000001','photo'),('20000000-0000-4000-8000-000000000002','photo');
insert into scheduled_posts(client_id) values('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
insert into trend_briefs(client_id) values('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare n integer; t text; begin
 select count(id) into n from clients;
 if n<>1 then raise exception 'Tenant A client isolation failed'; end if;
 if not exists(select id from clients where id='20000000-0000-4000-8000-000000000001') then raise exception 'Own client missing'; end if;
 foreach t in array array['content_queue','scheduled_posts','trend_briefs'] loop
  execute format('select count(*) from %I',t) into n;
  if n<>1 then raise exception 'Tenant isolation failed: %',t; end if;
  begin execute format('update %I set client_id=''20000000-0000-4000-8000-000000000002''',t); raise exception 'Unexpected write access: %',t;
  exception when insufficient_privilege then null; end;
 end loop;
 begin perform instagram_access_token from clients; raise exception 'Credential column exposed'; exception when insufficient_privilege then null; end;
 begin insert into tenant_memberships values('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'); raise exception 'Membership escalation allowed'; exception when insufficient_privilege then null; end;
 begin perform * from openclaw_events; raise exception 'Operations data exposed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(id) from clients)<>1 or exists(select id from clients where id='20000000-0000-4000-8000-000000000001') then raise exception 'Tenant B isolation failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin if exists(select id from clients) then raise exception 'Nonmember access'; end if; end $$;
set local role anon;
do $$ declare t text; begin
 foreach t in array array['clients','content_queue','scheduled_posts','trend_briefs','openclaw_events','openclaw_agent_status'] loop
  begin execute format('select * from %I',t); raise exception 'Anonymous access: %',t; exception when insufficient_privilege then null; end;
 end loop;
end $$;
set local role service_role;
do $$ declare n integer; begin
 select count(*) into n from clients where id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002');
 if n<>2 then raise exception 'Backend access failed'; end if;
 update content_queue set raw_caption='backend verified' where client_id='20000000-0000-4000-8000-000000000001';
 if not found then raise exception 'Backend write failed'; end if;
end $$;
reset role;
select 'PASS: two-tenant isolation, own reads, nonmember denial, anonymous denial, credential denial, write denial, membership escalation denial, backend read/write' as result;
rollback;
