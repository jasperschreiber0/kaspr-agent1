import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table clients(id uuid primary key default gen_random_uuid(),business_name text,niche text,whatsapp_numbers text[],active boolean,created_at timestamptz,instagram_access_token text);
 create table content_queue(id uuid default gen_random_uuid(),client_id uuid,content_type text,raw_caption text);
 create table scheduled_posts(id uuid default gen_random_uuid(),client_id uuid);
 create table trend_briefs(id uuid default gen_random_uuid(),client_id uuid);
 create table openclaw_events(id uuid); create table openclaw_agent_status(agent text);`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260908030447_tenant_access_controls.sql',import.meta.url),'utf8'));
 const result=await db.exec(await readFile(new URL('../test/tenant-isolation.sql',import.meta.url),'utf8'));
 console.log(JSON.stringify(result.flatMap(r=>r.rows).filter(r=>r.result)));
} catch(e){console.error(e.message,e.code,e.where);process.exitCode=1;} finally{await db.close();}


