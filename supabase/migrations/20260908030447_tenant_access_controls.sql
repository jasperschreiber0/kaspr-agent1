-- Server workers retain service_role access. Tenant users receive read-only
-- access through explicit, administrator-managed membership; no self-enrolment.
create table public.tenant_memberships (
 user_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid not null references public.clients(id) on delete cascade,
 primary key(user_id,client_id)
);
alter table public.tenant_memberships enable row level security;
revoke all on public.tenant_memberships from anon,authenticated;
grant select on public.tenant_memberships to authenticated;
grant all on public.tenant_memberships to service_role;
create policy membership_self_read on public.tenant_memberships for select to authenticated using (user_id=(select auth.uid()));

alter table public.clients enable row level security;
revoke all on public.clients from anon,authenticated;
-- Provider tokens and credentials in clients must never be readable by a tenant.
grant select(id,business_name,niche,active,created_at) on public.clients to authenticated;
grant all on public.clients to service_role;
create policy clients_tenant_read on public.clients for select to authenticated
using (id in (select client_id from public.tenant_memberships where user_id=(select auth.uid())));

do $$ declare t text; begin
 foreach t in array array['content_queue','scheduled_posts','trend_briefs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy tenant_read on public.%I for select to authenticated using (client_id in (select client_id from public.tenant_memberships where user_id=(select auth.uid())))',t);
 end loop;
end $$;
-- These contain cross-tenant operations and have no trustworthy tenant key.
alter table public.openclaw_agent_status enable row level security;
alter table public.openclaw_events enable row level security;
revoke all on public.openclaw_agent_status,public.openclaw_events from anon,authenticated;
grant all on public.openclaw_agent_status,public.openclaw_events to service_role;
