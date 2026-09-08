const twilio = require('twilio');
const { isSuppressed } = require('./suppression');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, { autoRetry: false, timeout: 10000 });
function classifySendError(err) {
  if (err.status === 429) return { sent: false, outcome: 'retry', code: String(err.code || 429) };
  if (err.status >= 400 && err.status < 500 && err.status !== 408) return { sent: false, outcome: 'failed', code: String(err.code || err.status) };
  return { sent: false, outcome: 'uncertain', code: String(err.code || 'transport_unknown') };
}
async function sendSms(to, body, options = {}) {
  if (await isSuppressed(to)) return { sent: false, outcome: 'suppressed', reason: 'suppressed_or_unavailable' };
  const from = options.from || process.env.TWILIO_SMS_NUMBER;
  if (!from) return { sent: false, outcome: 'failed', reason: 'sender_not_configured' };
  try {
    const message = await twilioClient.messages.create({ from, to, body, ...(options.statusCallback ? { statusCallback: options.statusCallback } : {}) });
    return { sent: true, sid: message.sid };
  } catch (err) { return classifySendError(err); }
}
module.exports = { sendSms, isSuppressed, classifySendError, fetchMessage: sid => twilioClient.messages(sid).fetch() };
