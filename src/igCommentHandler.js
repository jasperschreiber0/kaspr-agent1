const Anthropic = require('@anthropic-ai/sdk');
const { sendIgDm } = require('./igDmHandler'); // sendIgDm now lives in igDmHandler
const { logConversationEvent } = require('./conversationLog');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Called when a new comment is detected on a client's IG post.
 * Sends a brand-voice DM to the commenter to drive toward a booking.
 *
 * @param {object} client - Row from clients table
 * @param {object} value  - Meta webhook change value
 */
async function handleComment({ client, value }) {
  const receivedAt = new Date();
  try {
    const commentId = value.id;
    const commentText = value.text || '';
    const commenterId = value.from?.id;
    const commenterName = value.from?.name || 'there';
 
    if (!commenterId) {
      console.warn('[comment] No commenter ID — skipping');
      return;
    }
 
    // Don't reply to the client's own comments
    if (commenterId === value.media?.owner?.id) {
      console.log('[comment] Own comment — skipping');
      return;
    }
 
    console.log(`[comment] New comment from ${commenterName} (${commenterId}): "${commentText}"`);
 
    const reply = await generateCommentReply({
      businessName: client.business_name,
      niche: client.niche,
      brandVoice: client.brand_voice,
      commenterName,
      commentText,
    });
 
    await sendIgDm({
      igAccountId: client.instagram_account_id,
      accessToken: client.instagram_access_token,
      recipientId: commenterId,
      message: reply,
    });

    console.log(`[comment] DM sent to ${commenterName} (${commenterId})`);

    await logConversationEvent({
      clientId: client.id,
      platformSenderId: commenterId,
      channel: 'comment',
      inboundText: commentText,
      replyText: reply,
      receivedAt,
    });
  } catch (err) {
    console.error('[comment] Error handling comment:', err.message);
  }
}
 
/**
 * Generates a brand-voice DM reply to a commenter using Claude.
 */
async function generateCommentReply({ businessName, niche, brandVoice, commenterName, commentText }) {
  const prompt = `You are the social media voice for ${businessName}, a ${niche} studio in Australia.
Brand voice: ${brandVoice}
Someone just commented on one of the studio's Instagram posts. Your job is to write a warm, natural DM to send to them that:
- Feels personal and genuine, not automated
- Matches the brand voice exactly
- Thanks them for engaging
- Naturally leads toward a booking or enquiry (don't be pushy — make it feel like a helpful next step)
- Is short — 2-4 sentences max
- Varies in tone and phrasing so it never sounds copy-pasted
Commenter's name: ${commenterName}
Their comment: "${commentText}"
Write ONLY the DM message. No quotes, no explanation, no label. Just the message itself.`;
 
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
 
  return response.content[0].text.trim();
}
 
module.exports = { handleComment };
