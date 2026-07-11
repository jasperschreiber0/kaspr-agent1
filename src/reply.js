const twilio = require('twilio');
const { isSuppressed } = require('./suppression');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

// Canonical WhatsApp reply copy, used by webhook.js.
const REPLIES = {
  received: () => `Got it! 📸 Queuing this up now.`,
  unknown: () =>
    `Hi! This number isn't set up with Kaspr yet — message contact@kaspr.com.au and we'll get you connected.`,
  unsupportedFile: () =>
    `Hmm, I can't read that file type yet. Try a JPG, PNG, MP4, MOV, or a voice note.`,
  error: () =>
    `Something went wrong on our end — we've been notified and are looking into it. Try again shortly.`,
};

async function sendReply(to, message) {
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

module.exports = { sendReply, REPLIES };
