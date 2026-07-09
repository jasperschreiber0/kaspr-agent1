const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Best-effort log of a handled DM or comment-triggered conversation, for
 * the owner dashboard (conversations started, response times, etc).
 * Requires a `conversations` table (client_id, platform_sender_id, channel,
 * inbound_text, reply_text, is_new_conversation, received_at, responded_at)
 * — if it doesn't exist yet this just warns instead of blocking the reply.
 */
async function logConversationEvent({
  clientId,
  platformSenderId,
  channel, // 'dm' | 'comment'
  inboundText,
  replyText,
  receivedAt,
}) {
  try {
    const { data: existing, error: lookupError } = await supabase
      .from('conversations')
      .select('id')
      .eq('client_id', clientId)
      .eq('platform_sender_id', platformSenderId)
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.warn('[conversationLog] Lookup failed (table missing?):', lookupError.message);
      return;
    }

    const respondedAt = new Date();

    const { error: insertError } = await supabase.from('conversations').insert({
      client_id: clientId,
      platform_sender_id: platformSenderId,
      channel,
      inbound_text: inboundText,
      reply_text: replyText,
      is_new_conversation: !existing,
      received_at: receivedAt.toISOString(),
      responded_at: respondedAt.toISOString(),
      response_ms: respondedAt.getTime() - receivedAt.getTime(),
    });

    if (insertError) {
      console.warn('[conversationLog] Insert failed:', insertError.message);
    }
  } catch (err) {
    console.warn('[conversationLog] Unexpected error:', err.message);
  }
}

module.exports = { logConversationEvent };
