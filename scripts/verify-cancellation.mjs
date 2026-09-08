import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const q=(sql,args=[])=>db.query(sql,args);
const first=async(sql,args=[]) => (await q(sql,args)).rows[0];
try {
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 await db.exec(await readFile(new URL('../test/fixtures/clients.sql',import.meta.url),'utf8'));
 for(const file of ['20260906090000_revenue_ledger.sql','20260906100000_booking_controls.sql','20260908025753_salon_flow_reconciliation.sql','20260908030800_recovery_guardrails.sql','20260908040617_recovery_cancellation.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 const c=await first(`insert into clients(slug,business_name,niche,icp,tone,goals,active,recovery_enabled,recovery_sms_number,twilio_voice_number) values('cancel-test','Synthetic','x','x','x','x',true,true,'+15005550006','+15005550006') returning id`);
 let serial=0;
 const queued=async()=>{
  const phone='synthetic-'+(++serial);
  const t=await first('insert into recovery_threads(client_id,phone) values($1,$2) returning *',[c.id,phone]);
  const o=await first("insert into recovery_outbox(client_id,phone,body,kind,dedupe_key) values($1,$2,'fixture','reply',$2) returning *",[c.id,phone]);
  return {t,o};
 };
 const claim=()=>first('select * from kaspr_claim_outbox()');
 const allow=o=>first('select kaspr_authorize_send($1,$2) allowed',[o.id,o.claimed_at]);
 let f=await queued();
 assert.equal((await first('select kaspr_takeover($1,$2) ok',['00000000-0000-0000-0000-000000000099',f.t.id])).ok,false);
 await q('select kaspr_takeover($1,$2)',[c.id,f.t.id]);
 assert.equal((await first('select status from recovery_outbox where id=$1',[f.o.id])).status,'suppressed');
 f=await queued();let o=await claim();
 await q('select kaspr_takeover($1,$2)',[c.id,f.t.id]);
 assert.equal((await allow(o)).allowed,false);
 f=await queued();o=await claim();
 assert.equal((await allow({...o,claimed_at:new Date(0)})).allowed,false);
 assert.equal((await allow(o)).allowed,true);
 assert.equal((await allow(o)).allowed,false); // cannot dispatch the same lease twice
 await q('select kaspr_takeover($1,$2)',[c.id,f.t.id]);
 await q("select kaspr_complete_send($1,'SM-accepted-before-takeover')",[o.id]);
 assert.equal((await first('select status from recovery_outbox where id=$1',[o.id])).status,'sent');
 f=await queued();o=await claim();
 await q('insert into suppressed_contacts(phone) values($1)',[f.t.phone]);
 assert.equal((await allow(o)).allowed,false);
 f=await queued();o=await claim();
 await q('update recovery_controls set paused=true');
 assert.equal((await allow(o)).allowed,false);
 await q('update recovery_controls set paused=false');
 f=await queued();o=await claim();
 await q('update clients set recovery_enabled=false where id=$1',[c.id]);
 assert.equal((await allow(o)).allowed,false);
 await q('update clients set recovery_enabled=true where id=$1',[c.id]);
 f=await queued();o=await claim();assert.equal((await allow(o)).allowed,true);
 await q("select kaspr_fail_send($1,'retry','429')",[o.id]);
 await q('update recovery_outbox set available_at=now() where id=$1',[o.id]);
 const next=await claim();assert.equal(next.dispatch_started_at,null);
 assert.equal((await allow(next)).allowed,true);
 await q("update recovery_outbox set claimed_at=now()-interval '6 minutes' where id=$1",[next.id]);
 await claim();
 assert.equal((await first('select status from recovery_outbox where id=$1',[next.id])).status,'uncertain');
 // A later inbound reply makes a prepared response stale, even with equal timestamps.
 f=await queued();
 await q("insert into recovery_inbox(sid,phone,destination,body,thread_id,status) values('SM-source',$1,'fixture','first',$2,'done'),('SM-newer',$1,'fixture','newer',$2,'done')",[f.t.phone,f.t.id]);
 await q("update recovery_outbox set dedupe_key='reply:SM-source' where id=$1",[f.o.id]);
 o=await claim();assert.equal((await allow(o)).allowed,false);
 // Repeated processing failures stop at five and are visible to the operator.
 await q("insert into recovery_inbox(sid,phone,destination,body,thread_id) values('SM-poison','fixture','fixture','fixture',$1)",[f.t.id]);
 for(let n=1;n<=5;n++){
  const i=await first('select * from kaspr_claim_inbox()');assert.equal(i.processing_attempts,n);
  await q('select kaspr_fail_inbox($1,$2)',[i.id,i.lease_until]);
  await q('update recovery_inbox set next_attempt_at=now() where id=$1',[i.id]);
 }
 assert.equal(await first('select * from kaspr_claim_inbox()'),undefined);
 const m=(await first('select kaspr_recovery_metrics() metrics')).metrics;
 assert.equal(m.exhausted_inbox,1);assert.equal(m.uncertain,1);
 assert.equal((await first('select kaspr_foundation_version() version')).version,3);
 await db.exec('set role authenticated');
 await assert.rejects(q('select kaspr_takeover($1,$2)',[c.id,f.t.id]));
 await assert.rejects(q('select * from recovery_controls'));
 console.log('PASS cancellation: pending/claimed/takeover/accepted boundary, wrong tenant, lease replay, STOP, pause, disabled tenant, safe retry, restart quarantine, stale reply ordering, poison inbox limit, metrics, RPC denial');
}catch(e){console.error(e.message,e.code,e.where);process.exitCode=1;}finally{await db.close();}
