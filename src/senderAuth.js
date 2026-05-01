const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Given a raw Twilio "From" value like "whatsapp:+61412345678",
 * find the matching client and sender name.
 * Returns { client, senderName } or null if not found.
 */
async function identifySender(twilioFrom) {
  // Strip "whatsapp:" prefix
  const phone = twilioFrom.replace('whatsapp:', '').trim();

  // Search all active clients whose whatsapp_numbers array contains this phone
  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('active', true)
    .contains('whatsapp_numbers', [phone]);

  if (error) {
    console.error('[senderAuth] Supabase error:', error.message);
    throw new Error('DB lookup failed');
  }

  if (!clients || clients.length === 0) {
    return null;
  }

  const client = clients[0];

  // Try to find a friendly name from client.staff_names map if it exists
  // Format: { "+61412345678": "Jade" }
  let senderName = 'Team Member';
  if (client.staff_names && client.staff_names[phone]) {
    senderName = client.staff_names[phone];
  }

  return { client, senderName };
}

module.exports = { identifySender };
