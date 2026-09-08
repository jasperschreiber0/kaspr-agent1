const test=require('node:test');
const assert=require('node:assert/strict');
const {tenantAuth}=require('../src/tenantAuth');
const {createMonitor}=require('../src/recoveryMonitor');
const express=require('express');

test('actual HTTP tenant gate rejects anonymous/forged/cross-tenant and allows membership',async()=>{
 const db={
  auth:{getUser:async token=>token==='valid'?{data:{user:{id:'user'}}}:{error:true}},
  from:()=>{
   const query={select:()=>query,eq:(key,id)=>{if(key==='client_id')query.id=id;return query;},maybeSingle:async()=>({data:query.id.endsWith('1')?{client_id:query.id}:null})};
   return query;
  }
 };
 const app=express();app.get('/connect',tenantAuth(db),(req,res)=>res.sendStatus(204));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const url=`http://127.0.0.1:${server.address().port}/connect?client_id=00000000-0000-0000-0000-00000000000`;
  assert.equal((await fetch(url+'1')).status,401);
  assert.equal((await fetch(url+'1',{headers:{authorization:'Bearer forged'}})).status,401);
  assert.equal((await fetch(url+'2',{headers:{authorization:'Bearer valid'}})).status,403);
  assert.equal((await fetch(url+'1',{headers:{authorization:'Bearer valid'}})).status,204);
 }finally{server.close();}
});
test('operator alerts deduplicate, recover and retry failures without customer data',async()=>{
 let time=100000,calls=0;
 const monitor=createMonitor({now:()=>time,notify:async()=>{calls++;},logger:{error(){}}});
 await monitor({uncertain:1,paused:false});await monitor({uncertain:1,paused:false});assert.equal(calls,1);
 time+=3600001;await monitor({uncertain:1});assert.equal(calls,2);
 await monitor({uncertain:0});time+=60001;await monitor({uncertain:1});assert.equal(calls,3);
 let attempts=0;const retry=createMonitor({now:()=>time,notify:async()=>{attempts++;throw Error('offline');},logger:{error(){}}});
 await retry({uncertain:1});time+=60001;await retry({uncertain:1});assert.equal(attempts,2);
});
