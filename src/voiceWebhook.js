const router = require('express').Router();
const { createClient } = require('@supabase/supabase-js');
const { twiml } = require('twilio');
const { verifyTwilioSignature } = require('./twilioAuth');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
router.post('/voice', verifyTwilioSignature, async (req, res) => {
  const { data: client, error } = await db.from('clients').select('id,call_forward_number').eq('active', true).eq('twilio_voice_number', req.body.To).maybeSingle();
  if (error) return res.status(503).send('Routing unavailable');
  const response = new twiml.VoiceResponse();
  if (!client?.call_forward_number) response.say('Sorry, this number is not set up yet.');
  else response.dial({ timeout: 20, callerId: req.body.To, action: '/webhook/voice-status' }, client.call_forward_number);
  res.type('text/xml').send(response.toString());
});
router.post('/voice-status', verifyTwilioSignature, async (req, res) => {
  if (!req.body.CallSid || !req.body.From || !req.body.To || !req.body.DialCallStatus) return res.status(400).send('Call identity required');
  const { error } = await db.rpc('kaspr_capture_missed_call', { p_sid: req.body.CallSid, p_to: req.body.To, p_phone: req.body.From, p_status: req.body.DialCallStatus });
  if (error) return res.status(503).send('Call persistence unavailable');
  res.type('text/xml').send('<Response/>');
});
module.exports = router;
