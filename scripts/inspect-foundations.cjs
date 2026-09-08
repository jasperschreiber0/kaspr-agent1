// Read-only; deliberately emit no credentials, phone numbers or message bodies.
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');
(async () => {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await db.from('clients').select('id,recovery_enabled,recovery_sms_number,twilio_voice_number,call_forward_number');
  if (error) throw new Error('client_read_failed');
  console.log(JSON.stringify({ alertConfigured: !!process.env.DISCORD_WEBHOOK_KASPR_ERRORS, autoReply: process.env.RECOVERY_AUTOREPLY_ENABLED === 'true', clients: data.map(c => ({ id:c.id, enabled:c.recovery_enabled, smsConfigured:!!c.recovery_sms_number, voiceConfigured:!!c.twilio_voice_number, forwardConfigured:!!c.call_forward_number })) }));
  const api=twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);
  for(const c of data.filter(c=>c.twilio_voice_number)) {
    const numbers=await api.incomingPhoneNumbers.list({phoneNumber:c.twilio_voice_number,limit:2});
    console.log(JSON.stringify({client:c.id,numberMatches:numbers.length,configuration:numbers.map(n=>({voiceUrl:n.voiceUrl,smsUrl:n.smsUrl,voiceMethod:n.voiceMethod,smsMethod:n.smsMethod,capabilities:n.capabilities}))}));
  }
})().catch(()=>{console.error('Read-only inspection failed; credentials and provider errors withheld');process.exitCode=1;});
