const test=require('node:test');const assert=require('node:assert/strict');
let transports=0,suppressed=false;
require('twilio');
require.cache[require.resolve('twilio')].exports=()=>({messages:{create:async()=>{transports++;return {sid:'SM-synthetic'};}}});
require.cache[require.resolve('../src/suppression')]={id:require.resolve('../src/suppression'),filename:require.resolve('../src/suppression'),loaded:true,exports:{isSuppressed:async()=>suppressed}};
const {sendSms,classifySendError}=require('../src/smsSender');
test('final sender gate prevents transport after takeover/opt-out or unavailable database',async()=>{
 assert.equal((await sendSms('fixture','fixture',{from:'fixture',authorize:async()=>false})).sent,false);
 assert.equal(transports,0);
 await assert.rejects(sendSms('fixture','fixture',{from:'fixture',authorize:async()=>{throw Error('offline');}}));
 assert.equal(transports,0);
 suppressed=true;
 assert.equal((await sendSms('fixture','fixture',{from:'fixture',authorize:async()=>true})).sent,false);assert.equal(transports,0);
 suppressed=false;
 assert.equal((await sendSms('fixture','fixture',{from:'fixture',authorize:async()=>true})).sid,'SM-synthetic');assert.equal(transports,1);
});
test('non-textable rejection is permanent, throttling retries, ambiguous transport quarantines',()=>{
 assert.equal(classifySendError({status:400,code:21614}).outcome,'failed');
 assert.equal(classifySendError({status:429}).outcome,'retry');
 assert.equal(classifySendError({status:500}).outcome,'uncertain');
 assert.equal(classifySendError({code:'ETIMEDOUT'}).outcome,'uncertain');
});
