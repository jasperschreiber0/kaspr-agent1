const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { verifyTwilioSignature } = require('./twilioAuth');
const { recordCustomerReply } = require('./revenueLedger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /webhook/sms
 * Twilio sends inbound SMS replies here — currently only customers
 * replying to a review-request text land on this route. We only care
 * about STOP-style opt-outs; everything else is acknowledged and ignored.
 */
router.post('/sms', verifyTwilioSignature, async (req, res) => {

  const from = (req.body.From || '').trim();
  const rawBody = (req.body.Body || '').trim();
  const body = rawBody.toUpperCase();

  if (!from) return res.status(400).send('Missing sender');

  if (body === 'STOP' || body === 'STOP ALL' || body === 'UNSUBSCRIBE') {
    const { error } = await supabase
      .from('suppressed_contacts')
      .upsert(
        {
          phone: from,
          client_id: null, // unknown at this point — intentional, same as WhatsApp STOP handler
          reason: 'STOP',
          suppressed_at: new Date().toISOString(),
        },
        { onConflict: 'phone' }
      );

    if (error) return res.status(503).send('Could not persist opt-out');
    return res.status(200).type('text/xml').send('<Response></Response>');
  }

  try {
    const opportunity = await recordCustomerReply({
      customerPhone: from,
      body: rawBody,
      messageSid: req.body.MessageSid,
    });
    if (opportunity) {
      console.log(`[sms-revenue] Customer reply linked to opportunity ${opportunity.id}`);
    }
    res.status(200).type('text/xml').send('<Response></Response>');
  } catch (error) {
    // Let Twilio retry after a persistence failure; MessageSid deduplicates it.
    console.error('[sms-revenue] Failed to record customer reply:', error.message);
    res.status(503).send('Reply persistence unavailable');
  }
});

module.exports = router;
