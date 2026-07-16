const { createClient } = require('@supabase/supabase-js');

// Lazy singleton: constructing the client at import time makes this
// module (and anything that requires it) throw the moment it's loaded
// if SUPABASE_URL isn't set yet — including in tests that never touch
// the network. Deferring to first use means importing this file is
// always safe; the client is still built once and reused after that.
let supabase;
function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabase;
}

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
  const { data, error } = await getSupabase()
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
