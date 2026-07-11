const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * OpenClaw event bus integration for kaspr-agent1.
 *
 * This is a polling queue backed by openclaw_events, not Supabase
 * Realtime — agent3 polls it every 30s. See agent2/src/openclaw.py for
 * the same clarification; nothing in this system does push-based
 * delivery despite the name.
 */
async function emit(eventName, payload, source = 'kaspr-agent1') {
  try {
    const { data, error } = await supabase
      .from('openclaw_events')
      .insert({
        event_name: eventName,
        source,
        payload,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.warn(`[openclaw] Emit failed for ${eventName}:`, error.message);
      return null;
    }
    console.log(`[openclaw] Emitted: ${eventName} | id: ${data.id}`);
    return data;
  } catch (err) {
    console.warn(`[openclaw] Emit failed for ${eventName}:`, err.message);
    return null;
  }
}

module.exports = { emit };
