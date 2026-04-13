const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

async function sendReply(to, message) {
  try {
    await client.messages.create({
      from: FROM,
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      body: message,
    });
  } catch (err) {
    // Non-fatal — log but don't throw
    console.error('[reply] Failed to send WhatsApp reply:', err.message);
  }
}

const REPLIES = {
  received: () =>
    `Got it ✅ We'll have this posted soon!`,

  preview: (instagramCaption, tiktokCaption, scheduledAt) =>
    `📋 *Caption Preview*\n\n*Instagram:*\n${instagramCaption}\n\n*TikTok:*\n${tiktokCaption}\n\n📅 Scheduled: ${scheduledAt}\n\nReply *GO* to confirm or *EDIT [your changes]* to adjust.`,

  unknown: () =>
    `Hi! I don't recognise this number. Ask your manager to add you to the Kaspr system.`,

  unsupportedFile: () =>
    `Sorry, I can only accept photos, videos, or text. Try again! 📸`,

  error: () =>
    `Something went wrong on our end — we're looking into it. Try sending again in a few minutes.`,

  go: (platform) =>
    `✅ Locked in! Your post is confirmed for ${platform}.`,

  edited: () =>
    `Got it — updating the caption now. I'll send a new preview shortly.`,
};

module.exports = { sendReply, REPLIES };
