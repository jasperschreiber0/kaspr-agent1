const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

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
router.post('/sms', async (req, res) => {
  res.status(200).send('<Response></Response>');

  const from = (req.body.From || '').trim();
  const body = (req.body.Body || '').trim().toUpperCase();

  if (!from) return;

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

    if (error) console.error('[sms-stop] Failed to write suppression:', error.message);
    else console.log('[sms-stop] Suppressed:', from);
  }
});

module.exports = router;
