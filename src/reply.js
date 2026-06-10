const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function isSuppressed(phone) {
  const clean = phone.replace('whatsapp:', '');
  const { data, error } = await supabase
    .from('suppressed_contacts')
    .select('id')
    .eq('phone', clean)
    .maybeSingle();
  if (error) {
    console.error('[suppression] Lookup failed:', error.message);
    return false; // fail open — log but don't block on DB error
  }
  return !!data;
}

async function sendReply(to, message, clientId = null) {
  const suppressed = await isSuppressed(to);
  if (suppressed) {
    console.warn('[reply] Suppressed — skipping send to', to);
    return;
  }
  try {
    await client.messages.create({
      from: FROM,
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      body: message,
    });
  } catch (err) {
    console.error('[reply] Failed to send WhatsApp reply:', err.message);
  }
}

const REPLIES = {
  unknown: () =>
    `Hey! This number isn't linked to a Kaspr account yet. If you think that's a mistake, reach out at hello@kaspr.com.au`,
  received: () =>
    `Got it! ✅ Your content is in the queue — we'll take it from here.`,
  unsupportedFile: () =>
    `Hmm, that file type isn't supported. Send a photo (JPG/PNG), video (MP4/MOV), or voice note and I'll take care of the rest! 📸`,
  error: () =>
    `Something went wrong on our end — we're on it. Please try again in a few minutes.`,
};

module.exports = { sendReply, REPLIES };
