const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const openclaw = require('./openclaw');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Insert a new row into content_queue.
 * Returns the created queue row or throws.
 */
async function writeToQueue({
  clientId,
  senderName,
  contentType,
  storagePath,
  rawCaption,
}) {
  const { data, error } = await supabase
    .from('content_queue')
    .insert({
      client_id: clientId,
      sender_name: senderName,
      content_type: contentType,
      storage_path: storagePath || null,
      raw_caption: rawCaption || null,
      status: 'pending',
      received_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[queueWriter] Insert error:', error.message);
    throw new Error('Queue insert failed');
  }

  console.log(`[queueWriter] Queued item ${data.id} for client ${clientId}`);

  // Emit event to the OpenClaw event bus (agent3 polls this, but also
  // polls content_queue directly regardless — this is a nudge, not the
  // only way the item gets picked up).
  if (contentType !== 'reply_signal') {
    await openclaw.emit('content.received', {
      queue_id: data.id,
      client_id: clientId,
      content_type: contentType,
    });
  }

  // Also post to Discord #kaspr-logs
  await notifyDiscord({
    queueId: data.id,
    clientId,
    senderName,
    contentType,
  });

  return data;
}

/**
 * Notify Discord #kaspr-logs of a new queued item.
 */
async function notifyDiscord({ queueId, clientId, senderName, contentType }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_KASPR_LOGS;
  if (!webhookUrl) return;

  try {
    await axios.post(webhookUrl, {
      embeds: [
        {
          title: '📥 New Content Queued',
          color: 0x4ade80,
          fields: [
            { name: 'Queue ID', value: queueId, inline: true },
            { name: 'Client ID', value: clientId, inline: true },
            { name: 'Sender', value: senderName, inline: true },
            { name: 'Content Type', value: contentType, inline: true },
            { name: 'Status', value: 'pending', inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (err) {
    // Non-fatal — just log locally
    console.warn('[queueWriter] Discord notify failed:', err.message);
  }
}

/**
 * Alert Discord #kaspr-errors of a failure.
 */
async function alertError({ context, error, clientId }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_KASPR_ERRORS;
  if (!webhookUrl) return;

  try {
    await axios.post(webhookUrl, {
      embeds: [
        {
          title: '🚨 Kaspr Agent 1 Error',
          color: 0xef4444,
          fields: [
            { name: 'Context', value: context, inline: false },
            { name: 'Error', value: error, inline: false },
            { name: 'Client ID', value: clientId || 'unknown', inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (err) {
    console.warn('[queueWriter] Discord error alert failed:', err.message);
  }
}

module.exports = { writeToQueue, alertError };
