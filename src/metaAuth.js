const crypto = require('crypto');
/**
 * Rejects any POST that doesn't carry a valid X-Hub-Signature-256 header
 * computed with META_APP_SECRET over the raw body. Without this, anyone
 * who finds /webhook/meta can POST forged Instagram DM/comment events and
 * trigger real AI-generated replies (and real Anthropic API spend) sent
 * from a client's actual Instagram account to an attacker-controlled
 * recipient ID.
 */
function verifyMetaSignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !req.rawBody) {
    console.warn('[meta-auth] Missing signature header or raw body');
    return res.status(403).send('Forbidden');
  }

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(req.rawBody)
      .digest('hex');

  console.log('[meta-auth] received signature:', signature);
  console.log('[meta-auth] expected signature:', expected);

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  if (!valid) {
    console.warn('[meta-auth] Signature mismatch — rejecting');
    return res.status(403).send('Forbidden');
  }
  next();
}
module.exports = { verifyMetaSignature };
