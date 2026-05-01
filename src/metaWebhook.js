const express = require('express');
const router = express.Router();
const { handleComment } = require('./igCommentHandler');
const { handleDm } = require('./igDmHandler');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /webhook/meta
 * Meta sends a verification challenge when you register the webhook.
 * Responds with hub.challenge to confirm ownership.
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[meta-webhook] Verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('[meta-webhook] Verification failed — token mismatch');
  return res.status(403).json({ error: 'Forbidden' });
});

/**
 * POST /webhook/meta
 * Receives all Instagram events: comments, DMs, mentions, etc.
 * Dispatches to the appropriate handler.
 */
router.post('/', async (req, res) => {
  // Acknowledge immediately — Meta expects a fast 200
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body;

  if (body.object !== 'instagram') {
    console.log('[meta-webhook] Ignoring non-instagram event:', body.object);
    return;
  }

  try {
    for (const entry of body.entry || []) {
      const igAccountId = entry.id;

      // Look up client by instagram_account_id
      const { data: clientRow, error } = await supabase
        .from('clients')
        .select('id, business_name, brand_voice, niche, instagram_access_token')
        .eq('instagram_account_id', igAccountId)
        .maybeSingle();

      if (error) {
        console.error('[meta-webhook] Supabase error:', error.message);
        continue;
      }

      if (!clientRow) {
        console.warn('[meta-webhook] No client found for IG account:', igAccountId);
        continue;
      }

      for (const change of entry.changes || []) {
        const field = change.field;
        const value = change.value;

        console.log(`[meta-webhook] Event: ${field} | client: ${clientRow.business_name}`);

        if (field === 'comments') {
          await handleComment({ client: clientRow, value });
        } else if (field === 'messages') {
          await handleDm({ client: clientRow, value });
        } else {
          console.log('[meta-webhook] Unhandled field type:', field);
        }
      }

      // Also handle messaging events (DMs come through entry.messaging)
      for (const messaging of entry.messaging || []) {
        if (messaging.message && !messaging.message.is_echo) {
          await handleDm({ client: clientRow, value: { messaging } });
        }
      }
    }
  } catch (err) {
    console.error('[meta-webhook] Unhandled error:', err.message);
  }
});

module.exports = router;
