const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function isSuppressed(phone) {
  const { data, error } = await supabase
    .from('suppressed_contacts')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (error) {
    console.error('[smsSender] Suppression lookup failed:', error.message);
    return false; // fail open — log but don't block on DB error
  }
  return !!data;
}

/**
 * Send a plain SMS from the shared Kaspr SMS number, honouring the
 * suppression list. Used for anything customer-facing that isn't the
 * staff WhatsApp channel (review requests, missed-call replies).
 */
async function sendSms(to, body) {
  if (await isSuppressed(to)) {
    console.warn('[smsSender] Suppressed — skipping send to', to);
    return { sent: false, reason: 'suppressed' };
  }

  if (!process.env.TWILIO_SMS_NUMBER) {
    console.error('[smsSender] TWILIO_SMS_NUMBER not configured');
    return { sent: false, reason: 'not_configured' };
  }

  try {
    await twilioClient.messages.create({
      from: process.env.TWILIO_SMS_NUMBER,
      to,
      body,
    });
    return { sent: true };
  } catch (err) {
    console.error('[smsSender] Send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendSms, isSuppressed };
