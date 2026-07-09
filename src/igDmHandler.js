const Anthropic = require('@anthropic-ai/sdk');
const { logConversationEvent } = require('./conversationLog');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Called when a new DM is received on a client's IG account.
 * Generates a brand-voice reply that drives toward a booking.
 *
 * @param {object} client - Row from clients table
 * @param {object} value  - Meta webhook change value (messages field or messaging array entry)
 */
async function handleDm({ client, value }) {
  const receivedAt = new Date();
  try {
    const messaging = value.messaging || buildMessagingFromChange(value);
    if (!messaging) {
      console.warn('[dm] Could not parse messaging object — skipping');
      return;
    }
 
    const senderId = messaging.sender?.id;
    const messageText = messaging.message?.text || '';
    const isEcho = messaging.message?.is_echo;
 
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
      igAccountId: client.instagram_account_id,
      accessToken: client.instagram_access_token,
      recipientId: senderId,
      message: reply,
    });

    console.log(`[dm] Reply sent to ${senderId}`);

    await logConversationEvent({
      clientId: client.id,
      platformSenderId: senderId,
      channel: 'dm',
      inboundText: messageText,
      replyText: reply,
      receivedAt,
    });
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
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
 
  return response.content[0].text.trim();
}
 
/**
 * Sends a DM via Meta Graph API.
 * Uses the IG account ID directly (not /me/) to avoid User token issues.
 */
async function sendIgDm({ igAccountId, accessToken, recipientId, message }) {
  const url = `https://graph.facebook.com/v19.0/${igAccountId}/messages`;
 
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: message },
      messaging_type: 'RESPONSE',
    }),
  });
 
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Meta Graph API error: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}
 
module.exports = { handleDm, sendIgDm };
