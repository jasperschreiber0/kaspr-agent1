import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
try {
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 await db.exec(await readFile(new URL('../test/fixtures/clients.sql',import.meta.url),'utf8'));
 for(const file of ['20260906090000_revenue_ledger.sql','20260906100000_booking_controls.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 // Reproduce the live suppression table, including its incompatible old constraint.
 await db.exec(`create table suppressed_contacts(id uuid primary key default gen_random_uuid(),client_id uuid not null references clients(id),phone text not null,reason text default 'STOP',suppressed_at timestamptz default now(),unique(client_id,phone));`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260908025753_salon_flow_reconciliation.sql',import.meta.url),'utf8'));
 const q=(sql,args=[])=>db.query(sql,args);
 const first=async(sql,args=[]) => (await q(sql,args)).rows[0];
 const c=await first(`insert into clients(slug,business_name,niche,icp,tone,goals,active,recovery_enabled,recovery_sms_number,twilio_voice_number,recovery_services) values('test','Test','hair','x','x','x',true,true,'+15005550006','+15005550006','["Colour"]') returning id`);
 const call=()=>q(`select kaspr_capture_missed_call('CA-test','+15005550006','+15005550009','no-answer')`);
 await call(); await call();
 assert.equal((await first('select count(*)::int n from recovery_outbox')).n,1);
 await q('update recovery_outbox set available_at=now()');
 let o=await first('select * from kaspr_claim_outbox()'); assert.equal(o.attempts,1);
 await q("select kaspr_fail_send($1,'retry','20429')",[o.id]);
 assert.equal((await first('select status from recovery_outbox')).status,'pending');
 assert.equal((await first('select count(*)::int n from kaspr_claim_outbox()')).n,0);
 await q('update recovery_outbox set available_at=now()');
 o=await first('select * from kaspr_claim_outbox()'); assert.equal(o.attempts,2);
 await q("select kaspr_delivery_status($1,'SM-test','delivered',null)",[o.id]);
 await q("select kaspr_complete_send($1,'SM-test')",[o.id]);
 await q("select kaspr_delivery_status($1,'SM-test','queued',null)",[o.id]);
 await q("select kaspr_delivery_status($1,'SM-test','delivered',null)",[o.id]);
 assert.equal((await first('select delivery_status from recovery_outbox')).delivery_status,'delivered');
 assert.equal((await first("select count(*)::int n from revenue_events where event_name='customer_contacted'")).n,1);
 await assert.rejects(q("select kaspr_complete_send($1,'SM-wrong')",[o.id]));
 const sms=()=>q("select kaspr_capture_sms('SM-reply','+15005550009','+15005550006','Colour')");
 await sms();await sms();
 assert.equal((await first('select count(*)::int n from recovery_inbox')).n,1);
 assert.equal((await first("select count(*)::int n from revenue_events where event_name='customer_replied'")).n,1);
 const i=await first('select * from kaspr_claim_inbox()');
 await q("select kaspr_finish_reply($1,$2,'time','Colour',null,'Colour','What time?')",[i.id,i.lease_until]);
 await q("select kaspr_finish_reply($1,$2,'time','Colour',null,'Colour','What time?')",[i.id,i.lease_until]);
 assert.equal((await first("select count(*)::int n from recovery_outbox where kind='reply'")).n,1);
 await q("select kaspr_capture_sms('SM-stop','+15005550009','+15005550006','QUIT')");
 assert.equal((await first("select count(*)::int n from suppressed_contacts where client_id is null")).n,1);
 assert.equal((await first("select status from recovery_outbox where kind='reply'")).status,'suppressed');
 await q("select kaspr_capture_missed_call('CA-answer','+15005550006','+15005550008','completed')");
 assert.equal((await first("select count(*)::int n from recovery_call_outcomes")).n,2);
 // Exhausted safe retries dead-letter; ambiguous crashes are never reclaimed.
 await q("select kaspr_capture_missed_call('CA-retry','+15005550006','+15005550007','busy')");
 await q("update recovery_outbox set available_at=now(),attempts=4 where dedupe_key='call:CA-retry'");
 const retry=await first('select * from kaspr_claim_outbox()');
 await q("select kaspr_fail_send($1,'retry','20429')",[retry.id]);
 assert.equal((await first('select status from recovery_outbox where id=$1',[retry.id])).status,'failed');
 await q("select kaspr_capture_missed_call('CA-crash','+15005550006','+15005550008','busy')");
 await q("update recovery_outbox set available_at=now() where dedupe_key='call:CA-crash'");
 const crash=await first('select * from kaspr_claim_outbox()');
 await q("update recovery_outbox set claimed_at=now()-interval '6 minutes' where id=$1",[crash.id]);
 assert.equal((await first('select count(*)::int n from kaspr_claim_outbox()')).n,0);
 assert.equal((await first('select status from recovery_outbox where id=$1',[crash.id])).status,'uncertain');
 await q("select kaspr_booking_transition($1,$2,'appointment_booked','LOCAL-BOOKING',280)",[o.opportunity_id,c.id]);
 await q("select kaspr_booking_transition($1,$2,'appointment_completed','LOCAL-BOOKING',280)",[o.opportunity_id,c.id]);
 await q("insert into revenue_events(opportunity_id,client_id,event_name,created_at) values($1,$2,'appointment_completed',now()-interval '25 hours')",[o.opportunity_id,c.id]);
 await q("update clients set review_enabled=true,review_url='https://example.test/review' where id=$1",[c.id]);
 await q('select kaspr_queue_reviews()');await q('select kaspr_queue_reviews()');
 assert.equal((await first("select count(*)::int n from recovery_outbox where kind='review'")).n,1);
 await q('select kaspr_claim_outbox()');
 assert.equal((await first("select status from recovery_outbox where kind='review'")).status,'suppressed');
 await db.exec('set role anon');
 await assert.rejects(q('select * from recovery_outbox'));
 await assert.rejects(q('select kaspr_claim_outbox()'));
 await db.exec('reset role');
 console.log('PASS: suppression drift, atomic capture, dedupe, retry/backoff/exhaustion, crash quarantine, delivery ordering, SID mismatch, STOP, answered-call persistence, completion-gated review dedupe/suppression, anon denial');
} catch(e) { console.error(e.message, e.code, e.where); process.exitCode=1; } finally {await db.close();}



