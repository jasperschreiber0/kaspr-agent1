const express = require('express');
const router = express.Router();
const { identifySender } = require('./senderAuth');
const { handleMediaItems, transcribeVoice } = require('./mediaHandler');
const { writeToQueue, alertError } = require('./queueWriter');
const { sendReply, REPLIES } = require('./reply');
 
/**
 * POST /webhook/whatsapp
 * Twilio sends ALL inbound WhatsApp messages here.
 */
router.post('/whatsapp', async (req, res) => {
  // Twilio expects a 200 response quickly — acknowledge immediately
  res.status(200).send('<Response></Response>');
 
  const body = req.body;
  const from = body.From; // e.g. "whatsapp:+61412345678"
  const messageBody = (body.Body || '').trim();
  const numMedia = parseInt(body.NumMedia || '0', 10);
 
  // Declare upperMsg once, here, so all handlers below can use it
  const upperMsg = messageBody.toUpperCase();
 
  console.log(`[webhook] Inbound from ${from} | media: ${numMedia} | text: "${messageBody}"`);
 
  try {
    // 1. STOP handler — Australian Spam Act compliance
    // Must run before identifySender so opt-outs always succeed
    if (upperMsg === 'STOP' || upperMsg === 'STOP ALL' || upperMsg === 'UNSUBSCRIBE') {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      const cleanPhone = from.replace('whatsapp:', '');
      const { error } = await supabase
        .from('suppressed_contacts')
        .upsert({
          phone: cleanPhone,
          client_id: null, // unknown at this point — intentional
          reason: 'STOP',
          suppressed_at: new Date().toISOString(),
        }, { onConflict: 'phone' });
 
      if (error) console.error('[stop] Failed to write suppression:', error.message);
      else console.log('[stop] Suppressed:', cleanPhone);
 
      // Don't reply — Twilio handles the opt-out confirmation automatically
      return;
    }
 
    // 2. Identify sender
    const senderResult = await identifySender(from);
 
    if (!senderResult) {
      console.warn(`[webhook] Unknown sender: ${from}`);
      await sendReply(from, REPLIES.unknown());
      return;
    }
 
    const { client, senderName } = senderResult;
 
    // 3. Handle PREVIEW / GO / EDIT reply flows (delegated to Agent 3 via queue flag)
    if (upperMsg === 'PREVIEW' || upperMsg === 'GO' || upperMsg.startsWith('EDIT ')) {
      await handleConversationReply(from, client, messageBody, upperMsg);
      return;
    }
 
    // 4. Must have media or text
    if (numMedia === 0 && !messageBody) {
      await sendReply(from, `Send a photo, video, or caption and I'll take care of the rest! 📸`);
      return;
    }
 
    // 5. Handle media items
    let mediaResults = [];
    if (numMedia > 0) {
      try {
        mediaResults = await handleMediaItems(body, client.id);
      } catch (err) {
        if (err.message.includes('Unsupported file type')) {
          await sendReply(from, REPLIES.unsupportedFile());
          return;
        }
        throw err;
      }
    }
 
    // 6. Queue each media item (or text-only)
    if (mediaResults.length > 0) {
      for (const media of mediaResults) {
        let rawCaption = messageBody || null;
 
        if (media.contentType === 'voice') {
          console.log(`[webhook] Transcribing voice note: ${media.storagePath}`);
          const transcript = await transcribeVoice(media.storagePath);
          rawCaption = transcript || rawCaption;
        }
 
        await writeToQueue({
          clientId: client.id,
          senderName,
          contentType: media.contentType,
          storagePath: media.storagePath,
          rawCaption,
        });
      }
    } else {
      // Text-only message
      await writeToQueue({
        clientId: client.id,
        senderName,
        contentType: 'text',
        storagePath: null,
        rawCaption: messageBody,
      });
    }
 
    // 7. Confirm to sender
    await sendReply(from, REPLIES.received());
 
  } catch (err) {
    console.error('[webhook] Unhandled error:', err.message);
 
    await alertError({
      context: 'Webhook handler crashed',
      error: err.message,
      clientId: 'unknown',
    });
 
    try {
      await sendReply(from, REPLIES.error());
    } catch (_) {}
  }
});
 
/**
 * Handle PREVIEW / GO / EDIT replies from clients.
 * These are signals for Agent 3 — we write a flag row to content_queue
 * with content_type = 'reply_signal' so Agent 3 can pick it up.
 */
async function handleConversationReply(from, client, messageBody, upperMsg) {
  const { writeToQueue } = require('./queueWriter');
  const { sendReply, REPLIES } = require('./reply');
 
  if (upperMsg === 'PREVIEW') {
    await writeToQueue({
      clientId: client.id,
      senderName: 'system',
      contentType: 'reply_signal',
      storagePath: null,
      rawCaption: 'PREVIEW_REQUESTED',
    });
    await sendReply(from, `Fetching your latest caption preview... 🔍`);
 
  } else if (upperMsg === 'GO') {
    await writeToQueue({
      clientId: client.id,
      senderName: 'system',
      contentType: 'reply_signal',
      storagePath: null,
      rawCaption: 'GO_CONFIRMED',
    });
    await sendReply(from, `✅ Confirmed! Your post is locked in and will go live as scheduled.`);
 
  } else if (upperMsg.startsWith('EDIT ')) {
    const editInstructions = messageBody.replace(/^edit\s+/i, '').trim();
    await writeToQueue({
      clientId: client.id,
      senderName: 'system',
      contentType: 'reply_signal',
      storagePath: null,
      rawCaption: `EDIT_REQUEST: ${editInstructions}`,
    });
    await sendReply(from, `Got it — updating the caption now. I'll send a new preview shortly ✍️`);
  }
}
 
module.exports = router;
 
