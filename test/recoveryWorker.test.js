const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/recoveryWorker.js'),'utf8');
function workerFixture({hang=false}={}) {
 let time=1000;
 const timers=[],alerts=[];
 const runtime={processInbox:async()=>{if(hang)await new Promise(()=>{});},processOne:async()=>{},queueReviews:async()=>{},reconcile:async()=>{},metrics:async()=>({paused:false})};
 const context={module:{exports:{}},process:{env:{PUBLIC_BASE_URL:'https://example.test'}},Date:{now:()=>time},console:{log(){},error(){}},setInterval:(fn,ms)=>{timers.push({fn,ms});return {unref(){}};},require:name=>{
  if(name==='@supabase/supabase-js')return {createClient:()=>({})};
  if(name==='./smsSender')return {};
  if(name==='./recoveryRuntime')return {createRecoveryRuntime:()=>runtime};
  if(name==='./recoveryMonitor')return {createMonitor:()=>async value=>{alerts.push(value);},notifyOperator:async()=>{}};
  throw Error('Unexpected dependency');
 }};
 vm.runInNewContext(source,context,{filename:'recoveryWorker.js'});
 return {worker:context.module.exports,alerts,timers,advance:ms=>{time+=ms;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('watchdog survives its delayed healthy path beyond two minutes',async()=>{
 const f=workerFixture();f.worker.startRecoveryWorker();await flush();
 const tick=f.timers.find(t=>t.ms===5000).fn,watchdog=f.timers.find(t=>t.ms===60000).fn;
 for(let n=0;n<5;n++){
  f.advance(60000);await tick();
  assert.doesNotThrow(()=>watchdog());
  assert.equal(f.worker.workerHealthy(),true);
 }
 assert.equal(f.alerts.filter(a=>a.worker_stalled).length,0);
});
test('watchdog survives a hung async worker and emits an operator alert',async()=>{
 const f=workerFixture({hang:true});f.worker.startRecoveryWorker();
 f.advance(180000);
 assert.doesNotThrow(()=>f.timers.find(t=>t.ms===60000).fn());await flush();
 assert.equal(f.worker.workerHealthy(),false);
 assert.equal(f.alerts.at(-1).worker_stalled,1);
});
