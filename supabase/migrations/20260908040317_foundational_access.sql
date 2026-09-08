-- No tenant key exists on these legacy operational tables. Preserve server
-- callers; do not invent a shared tenant policy or delete their records.
drop policy if exists pq_all on public.product_queue;
drop policy if exists am_all on public.agent_memory;
drop policy if exists el_all on public.email_list;
revoke all on public.product_queue,public.agent_memory,public.email_list from public,anon,authenticated;
grant select,insert,update,delete on public.product_queue,public.agent_memory,public.email_list to service_role;
alter view public.v_pack_usage_current_month set (security_invoker=true);
revoke all on public.v_pack_usage_current_month from public,anon,authenticated;
grant select on public.v_pack_usage_current_month to service_role;

-- Individually reviewed: one server-only pack creator; four trigger functions.
-- Storage trigger retains definer execution to write its server-only queue.
-- There are no browser storage policies; never trust its metadata for public upload.
alter function public.create_content_pack(uuid,public.content_pack_tier,text) set search_path=pg_catalog,public;
alter function public.handle_new_upload() set search_path=pg_catalog,public;
alter function public.update_updated_at() set search_path=pg_catalog,public;
alter function public.set_revenue_opportunity_updated_at() set search_path=pg_catalog,public;
alter function public.kaspr_protect_events() set search_path=pg_catalog,public;
revoke execute on function public.create_content_pack(uuid,public.content_pack_tier,text),public.handle_new_upload(),public.update_updated_at(),public.set_revenue_opportunity_updated_at(),public.kaspr_protect_events() from public,anon,authenticated;
grant execute on function public.create_content_pack(uuid,public.content_pack_tier,text),public.handle_new_upload(),public.update_updated_at(),public.set_revenue_opportunity_updated_at(),public.kaspr_protect_events() to service_role;
