const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { sendSms } = require('./smsSender');
const { verifyTwilioSignature } = require('./twilioAuth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Each client that wants missed-call SMS gets a dedicated Twilio voice
 * number (clients.twilio_voice_number) that forwards to their real mobile
 * (clients.call_forward_number). Multi-tenant, same pattern as identifySender
 * in senderAuth.js but keyed on the dialled number instead of the caller.
 */
async function findClientByVoiceNumber(toNumber) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('active', true)
    .eq('twilio_voice_number', toNumber)
    .maybeSingle();

  if (error) {
    console.error('[voice] Client lookup failed:', error.message);
    return null;
  }
  return data;
}

/**
 * POST /webhook/voice
 * Twilio hits this the moment a call comes in to a client's dedicated
 * number. We forward it to the studio's real mobile and let Twilio tell
 * us the outcome via the action callback below.
 */
router.post('/voice', verifyTwilioSignature, async (req, res) => {
  const to = req.body.To;
  const client = await findClientByVoiceNumber(to);

  res.type('text/xml');

  if (!client || !client.call_forward_number) {
    res.send('<Response><Say>Sorry, this number is not set up yet.</Say></Response>');
    return;
  }

  res.send(
    `<Response><Dial timeout="20" callerId="${to}" action="/webhook/voice-status?clientId=${client.id}">${client.call_forward_number}</Dial></Response>`
  );
});

/**
 * POST /webhook/voice-status
 * Fires once the Dial attempt resolves. Anything other than "completed"
 * (no-answer, busy, failed) means the studio missed the call — text the
 * caller back immediately.
 */
router.post('/voice-status', verifyTwilioSignature, async (req, res) => {
  res.status(200).send('<Response></Response>');

  const dialStatus = req.body.DialCallStatus;
  const caller = req.body.From;
  const clientId = req.query.clientId;

  if (dialStatus === 'completed') return; // answered — nothing to do

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, business_name')
    .eq('id', clientId)
    .maybeSingle();

  if (error || !client) {
    console.error('[voice-status] Client lookup failed:', error?.message || 'not found');
    return;
  }

  const businessName = client.business_name || 'us';
  const body =
    `Hey! Sorry we missed your call at ${businessName} 💛 We'll call you back shortly — ` +
    `or reply here and we'll help you out.\n\nReply STOP to opt out.`;

  const result = await sendSms(caller, body);

  const { error: logError } = await supabase.from('missed_calls').insert({
    client_id: client.id,
    caller_phone: caller,
    dial_status: dialStatus,
    sms_sent: result.sent,
    created_at: new Date().toISOString(),
  });
  if (logError) {
    console.warn('[voice-status] Could not log missed call (table missing?):', logError.message);
  }
});

module.exports = router;
