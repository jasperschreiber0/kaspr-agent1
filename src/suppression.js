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
 * Fails open on a Supabase error: logs it, but returns "not suppressed"
 * rather than blocking sends on an infrastructure hiccup.
 */
async function isSuppressed(phone) {
  const clean = phone.replace('whatsapp:', '').trim();
  const { data, error } = await supabase
    .from('suppressed_contacts')
    .select('id')
    .eq('phone', clean)
    .maybeSingle();

  if (error) {
    console.error('[suppression] Lookup failed:', error.message);
    return false;
  }
  return !!data;
}

module.exports = { isSuppressed };
