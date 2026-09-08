const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecoveryRuntime } = require('../src/recoveryRuntime');
function fixture(result, completeError) {
 const calls=[]; const sends=[];
 const db={ rpc: async(name,args)=>{ calls.push({name,args}); return { data:name==='kaspr_claim_outbox'?[{id:'job',client_id:'tenant',phone:'test-recipient',body:'test',attempts:2}]:null,error:name==='kaspr_complete_send'?completeError:null }; }, from:()=>({select:()=>({eq:()=>({single:async()=>({data:{recovery_sms_number:'tenant-sender'},error:null})})})}) };
 return {calls,sends,runtime:createRecoveryRuntime({db,sendSms:async(...args)=>{sends.push(args);return result;},callbackBase:'https://example.test',logger:{log(){},warn(){}}})};
}
test('worker records provider SID and uses tenant sender plus signed callback endpoint',async()=>{
 const f=fixture({sent:true,sid:'SM123'}); await f.runtime.processOne();
 assert.equal(f.sends[0][2].from,'tenant-sender');
 assert.equal(f.sends[0][2].statusCallback,'https://example.test/webhook/sms-status?outboxId=job');
 assert.deepEqual(f.calls.at(-1),{name:'kaspr_complete_send',args:{p_id:'job',p_sid:'SM123'}});
});
test('worker persists a retryable rejection without falsely recording acceptance',async()=>{
 const f=fixture({sent:false,outcome:'retry',code:'20429'});await f.runtime.processOne();
 assert.deepEqual(f.calls.at(-1),{name:'kaspr_fail_send',args:{p_id:'job',p_outcome:'retry',p_code:'20429'}});
});
test('worker propagates completion persistence failure and sends only once',async()=>{
 const f=fixture({sent:true,sid:'SM123'},new Error('offline'));
 await assert.rejects(f.runtime.processOne(),/offline/); assert.equal(f.sends.length,1);
});
test('ambiguous transport outcomes are persisted as uncertain',async()=>{
 const f=fixture({sent:false,code:'ETIMEDOUT'});await f.runtime.processOne();
 assert.equal(f.calls.at(-1).args.p_outcome,'uncertain');
});
