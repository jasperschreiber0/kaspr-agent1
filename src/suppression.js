const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Global (not per-client) suppression check shared by every outbound
 * WhatsApp/SMS sender. A phone number that texted STOP to any one Kaspr
 * client is suppressed for all of them — see the suppressed_contacts
 * migration for why that's deliberate, not a bug.
 *
 * Block sending when opt-out status cannot be verified.
 */
async function isSuppressed(phone) {
  const clean = phone.replace('whatsapp:', '').trim();
  const { data, error } = await supabase
    .from('suppressed_contacts')
    .select('id')
    .eq('phone', clean).limit(1)
    .maybeSingle();

  if (error) {
    console.error('[suppression] Lookup failed:', error.message);
    return true;
  }
  return !!data;
}

module.exports = { isSuppressed };

