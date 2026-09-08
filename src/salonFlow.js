const { createClient } = require('@supabase/supabase-js');
// Capture only at the HTTP boundary. A worker must claim the durable inbox
// and atomically enqueue a reply before any transport is invoked.
function servicesOf(value) { return Array.isArray(value) ? value.map(s => typeof s === 'string' ? s : s?.name).filter(Boolean) : []; }
function replyFor({ businessName, services, bookingUrl, text, state }) {
  const lower = text.toLowerCase();
  const service = services.find(s => lower.includes(s.toLowerCase()));
  if (service && /book|appointment|available/.test(lower)) return { state: 'time', service, body: bookingUrl ? `Great — choose a time for ${service} here: ${bookingUrl}` : `Great — what day or time would suit you for ${service}?` };
  if (state === 'service' && !service) return { state: 'service', body: services.length ? `Thanks for getting back to ${businessName}. Which service would you like? We offer ${services.join(', ')}.` : `Thanks for getting back to ${businessName}. What service would you like to book?` };
  if (state === 'time' && !bookingUrl) return { state: 'handoff', body: `Thanks — I’ll pass that request to the team at ${businessName} so they can confirm availability.` };
  return { state: 'handoff', body: `Thanks — I’ll pass this to the team at ${businessName} so they can help you personally.` };
}
async function processInboundSms({ messageSid, from, to, body }, database) {
  if (!messageSid || !from || !to || typeof body !== 'string' || !body.trim() || body.length > 1600) {
    throw new Error('Valid message identity, sender, destination and body required');
  }
  const db = database || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await db.rpc('kaspr_capture_sms', { p_sid: messageSid, p_phone: from, p_to: to, p_body: body });
  if (error) throw error;
  return { handled: true, sent: false };
}
module.exports = { processInboundSms, replyFor, servicesOf };
