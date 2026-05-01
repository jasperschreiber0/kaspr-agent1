const Anthropic = require('@anthropic-ai/sdk');
const { sendIgDm } = require('./igCommentHandler');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Called when a new DM is received on a client's IG account.
 * Generates a brand-voice reply that drives toward a booking.
 *
 * @param {object} client - Row from clients table
 * @param {object} value  - Meta webhook change value (messages field or messaging array entry)
 */
async function handleDm({ client, value }) {
  try {
    // Handle both entry.changes (field: messages) and entry.messaging formats
    const messaging = value.messaging || buildMessagingFromChange(value);

    if (!messaging) {
      console.warn('[dm] Could not parse messaging object — skipping');
      return;
    }

    const senderId = messaging.sender?.id;
    const messageText = messaging.message?.text || '';
    const isEcho = messaging.message?.is_echo;

    // Don't reply to echoes (outbound messages from the page itself)
    if (isEcho) {
      console.log('[dm] Echo message — skipping');
      return;
    }

    if (!senderId) {
      console.warn('[dm] No sender ID — skipping');
      return;
    }

    if (!messageText) {
      console.log('[dm] No text in DM (possibly a sticker/media) — skipping for now');
      return;
    }

    console.log(`[dm] New DM from ${senderId}: "${messageText}"`);

    const reply = await generateDmReply({
      businessName: client.business_name,
      niche: client.niche,
      brandVoice: client.brand_voice,
      incomingMessage: messageText,
    });

    await sendIgDm({
      accessToken: client.instagram_access_token,
      recipientId: senderId,
      message: reply,
    });

    console.log(`[dm] Reply sent to ${senderId}`);

  } catch (err) {
    console.error('[dm] Error handling DM:', err.message);
  }
}

/**
 * Converts a webhook change value (field: messages format) into a messaging object.
 */
function buildMessagingFromChange(value) {
  if (!value || !value.sender) return null;
  return {
    sender: value.sender,
    recipient: value.recipient,
    message: value.message,
  };
}

/**
 * Generates a brand-voice DM reply using Claude.
 * Responds directly to what the person said, guides toward a booking.
 */
async function generateDmReply({ businessName, niche, brandVoice, incomingMessage }) {
  const prompt = `You are the social media voice for ${businessName}, a ${niche} studio in Australia.

Brand voice: ${brandVoice}

Someone has just sent a DM to the studio's Instagram. Your job is to write a warm, helpful reply that:
- Directly responds to what they said
- Sounds like a real person, not a bot
- Matches the brand voice exactly
- Naturally guides them toward booking or making an enquiry (don't be pushy — just make it easy and inviting)
- Is conversational and short — 2-5 sentences max
- Varies naturally in tone and phrasing each time

Their message: "${incomingMessage}"

Write ONLY the reply message. No quotes, no explanation, no label. Just the message.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}

module.exports = { handleDm };
