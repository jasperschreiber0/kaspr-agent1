const twilio = require('twilio');

/**
 * Rejects any POST that doesn't carry a valid X-Twilio-Signature header for
 * this exact URL + body. Without this check, anyone who discovers these
 * webhook URLs can POST forged WhatsApp/SMS/voice events — including fake
 * STOP opt-outs (silently suppressing a real customer's phone number
 * forever) or a flood of fake missed-call events — and the server has no
 * way to tell they didn't come from Twilio.
 */
function verifyTwilioSignature(req, res, next) {
  const signature = req.headers['x-twilio-signature'];
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body
  );

  if (!valid) {
    console.warn(`[twilio-auth] Rejected unsigned/invalid request to ${url}`);
    return res.status(403).send('Forbidden');
  }

  next();
}

module.exports = { verifyTwilioSignature };
