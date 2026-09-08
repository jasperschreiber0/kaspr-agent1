const router = require('express').Router();
const { createClient } = require('@supabase/supabase-js');
const { verifyTwilioSignature } = require('./twilioAuth');
const { processInboundSms } = require('./salonFlow');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
router.post('/sms', verifyTwilioSignature, async (req, res) => {
  try {
    await processInboundSms({ messageSid: req.body.MessageSid, from: req.body.From, to: req.body.To, body: req.body.Body });
    res.type('text/xml').send('<Response/>');
  } catch { res.status(503).send('Reply persistence unavailable'); }
});
router.post('/sms-status', verifyTwilioSignature, async (req, res) => {
  const { error } = await db.rpc('kaspr_delivery_status', {
    p_id: req.query.outboxId, p_sid: req.body.MessageSid,
    p_status: req.body.MessageStatus, p_error: req.body.ErrorCode || null,
  });
  if (error) return res.status(503).send('Delivery persistence unavailable');
  console.log(`[recovery-worker] delivery outbox=${req.query.outboxId} status=${req.body.MessageStatus}`);
  res.sendStatus(204);
});
module.exports = router;
