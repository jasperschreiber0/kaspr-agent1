const test = require('node:test');
const assert = require('node:assert/strict');

// Fake credentials so the twilio/supabase client constructors don't
// throw on import — no network calls happen in this test.
process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'AC00000000000000000000000000000000';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test_auth_token';
process.env.TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || '+61400000000';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test_key';

test('reply.js exports sendReply and REPLIES with the methods webhook.js calls', () => {
  const { sendReply, REPLIES } = require('../src/reply');

  assert.equal(typeof sendReply, 'function', 'sendReply must be exported as a function');
  assert.equal(typeof REPLIES, 'object', 'REPLIES must be exported as an object');

  for (const key of ['received', 'unknown', 'unsupportedFile', 'error']) {
    assert.equal(typeof REPLIES[key], 'function', `REPLIES.${key} should be a function`);
    assert.equal(typeof REPLIES[key](), 'string', `REPLIES.${key}() should return a string`);
    assert.ok(REPLIES[key]().length > 0, `REPLIES.${key}() should not return an empty string`);
  }
});
