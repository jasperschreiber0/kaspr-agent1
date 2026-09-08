// Synthetic signed HTTP requests; no calls are placed and no SMS is sent.
// Requires the existing Test Client to have recovery disabled.
const { createClient }=require('@supabase/supabase-js');
const twilio=require('twilio');
const { randomBytes }=require('crypto');
(async()=>{
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
 const {data:client,error}=await db.from('clients').select('id,twilio_voice_number,recovery_enabled').eq('business_name','Test Client').single();
 if(error||!client?.twilio_voice_number||client.recovery_enabled)throw new Error('unsafe_fixture_configuration');
 const base='https://kaspr-agent1-production.up.railway.app';
 const callSid='CA'+randomBytes(16).toString('hex');
 const messageSid='SM'+randomBytes(16).toString('hex');
 const signed=async(path,params)=>{
  const url=base+path;
  const signature=twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN,url,params);
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature},body:new URLSearchParams(params)});
  if(response.status!==200)throw new Error('signed_request_failed');
 };
 const call={CallSid:callSid,From:'+15005550009',To:client.twilio_voice_number,DialCallStatus:'completed'};
 await signed('/webhook/voice-status',call);await signed('/webhook/voice-status',call);
 const sms={MessageSid:messageSid,From:'+15005550009',To:client.twilio_voice_number,Body:'KASPR SYNTHETIC VERIFICATION - no transport; recovery disabled'};
 await signed('/webhook/sms',sms);await signed('/webhook/sms',sms);
 const {data:calls,error:ce}=await db.from('recovery_call_outcomes').select('sid,outcome').eq('sid',callSid);
 const {data:inbox,error:ie}=await db.from('recovery_inbox').select('sid,status').eq('sid',messageSid);
 const {count,error:oe}=await db.from('recovery_outbox').select('id',{count:'exact',head:true});
 if(ce||ie||oe||calls.length!==1||calls[0].outcome!=='completed'||inbox.length!==1||inbox[0].status!=='unmatched'||count!==0)throw new Error('persistence_assertion_failed');
 console.log(JSON.stringify({result:'PASS',scope:'synthetic signed production webhooks; no SMS/calls',callSid,messageSid,callRows:calls.length,inboxRows:inbox.length,outboxRows:count}));
})().catch(e=>{console.error('verification_failed',e.message);process.exitCode=1;});
