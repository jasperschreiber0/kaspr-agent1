// Run via Railway CLI environment injection. Never print credentials or raw errors.
const { createClient }=require('@supabase/supabase-js');
const twilio=require('twilio');
(async()=>{
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
 const base='https://kaspr-agent1-production.up.railway.app';
 const health=await fetch(base+'/health');console.log('health',health.status,await health.json());
 const {data:clients,error}=await db.from('clients').select('id,business_name,active,recovery_enabled,recovery_sms_number,twilio_voice_number,call_forward_number').limit(50);
 if(error)throw new Error('database_read_failed');
 console.log('clients',clients.map(c=>({id:c.id,name:c.business_name,active:c.active,recovery_enabled:c.recovery_enabled,sms_configured:!!c.recovery_sms_number,voice_configured:!!c.twilio_voice_number,forward_configured:!!c.call_forward_number})));
 const provider=twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);
 const numbers=await provider.incomingPhoneNumbers.list({limit:50});
 console.log('twilio_numbers',numbers.map(n=>({suffix:n.phoneNumber.slice(-4),smsUrl:n.smsUrl,voiceUrl:n.voiceUrl,smsCapable:n.capabilities.sms,voiceCapable:n.capabilities.voice})));
 for(const table of ['recovery_outbox','recovery_inbox','recovery_threads']) {
  const {count,error}=await db.from(table).select('id',{count:'exact',head:true});
  if(error)throw new Error('queue_read_failed');console.log(table,{count});
 }
 const unsigned=await fetch(base+'/webhook/sms',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'From=test&To=test&Body=test'});
 console.log('unsigned_sms_status',unsigned.status);
})().catch(e=>{console.error('verification_failed',e.code||e.name);process.exitCode=1;});
