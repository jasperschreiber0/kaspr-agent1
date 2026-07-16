const { createClient } = require('@supabase/supabase-js');
const { sendSms } = require('./smsSender');

// Lazy singleton — see suppression.js for why this isn't built at
// import time.
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
 * Parse "REVIEW <customer name> <mobile>" (case-insensitive on the keyword).
 * The mobile number is matched as a trailing phone-like sequence so it can
 * contain spaces or dashes (e.g. "0412 345 678"); everything before it is
 * the name. Returns { name, rawMobile } or null.
 */
function parseReviewCommand(messageBody) {
  const withoutKeyword = messageBody.trim().replace(/^review\s+/i, '');
  const match = withoutKeyword.match(/^(.*?)\s*(\+?(?:61|0)[\d\s-]{6,14}\d)$/);
  if (!match) return null;

  const name = match[1].trim();
  const rawMobile = match[2].trim();
  if (!name || !rawMobile) return null;

  return { name, rawMobile };
}

/**
 * Normalise an Australian mobile number to E.164 (+614XXXXXXXX).
 * Accepts 04xx xxx xxx, +614xx xxx xxx, 614xx xxx xxx, with spaces/dashes.
 * Returns null if it doesn't look like a valid AU mobile.
 */
function normalizeAuMobile(raw) {
  const digits = raw.replace(/[^\d+]/g, '');

  let national;
  if (/^\+?614\d{8}$/.test(digits)) {
    national = digits.replace(/^\+?61/, '');
  } else if (/^04\d{8}$/.test(digits)) {
    national = digits.slice(1);
  } else {
    return null;
  }

  return `+61${national}`;
}

/**
 * Best-effort log of a sent review request, for the monthly results
 * report. Requires a `review_requests` table (client_id, customer_name,
 * customer_phone, sent_at) — if it doesn't exist yet this just warns
 * instead of blocking the send.
 */
async function logReviewRequest({ clientId, name, phone }) {
  const { error } = await getSupabase().from('review_requests').insert({
    client_id: clientId,
    customer_name: name,
    customer_phone: phone,
    sent_at: new Date().toISOString(),
  });
  if (error) {
    console.warn('[reviewRequest] Could not log review request (table missing?):', error.message);
  }
}

/**
 * Handle an inbound "REVIEW <name> <mobile>" command from an authenticated
 * staff sender. Sends a Google review request SMS to the named customer.
 * Returns the message to reply to staff with.
 */
async function handleReviewCommand(client, messageBody) {
  const parsed = parseReviewCommand(messageBody);
  if (!parsed) {
    return `Format: REVIEW <customer name> <mobile>\ne.g. REVIEW Sarah Mitchell 0412345678`;
  }

  const { name, rawMobile } = parsed;
  const mobile = normalizeAuMobile(rawMobile);
  if (!mobile) {
    return `Couldn't read "${rawMobile}" as an Australian mobile number. Try again, e.g. REVIEW Sarah Mitchell 0412345678`;
  }

  if (!client.google_review_link) {
    console.error(`[reviewRequest] No google_review_link configured for client ${client.id}`);
    return `Your Google review link isn't set up yet — message contact@kaspr.com.au and we'll add it.`;
  }

  const firstName = name.split(' ')[0];
  const businessName = client.business_name || client.name || 'us';
  const body =
    `Hi ${firstName}! Thanks for visiting ${businessName} 💛 ` +
    `If you had a good experience, a quick Google review would mean the world: ${client.google_review_link}\n\n` +
    `Reply STOP to opt out of future messages.`;

  const result = await sendSms(mobile, body);

  if (!result.sent) {
    if (result.reason === 'suppressed') {
      return `${name} (${rawMobile}) has opted out previously — skipped, no message sent.`;
    }
    console.error(`[reviewRequest] Failed to send review SMS: ${result.reason}`);
    return `Couldn't send to ${name} (${rawMobile}) — ${result.reason}`;
  }

  await logReviewRequest({ clientId: client.id, name, phone: mobile });

  return `✅ Review request sent to ${name}.`;
}

module.exports = { handleReviewCommand, parseReviewCommand, normalizeAuMobile };
