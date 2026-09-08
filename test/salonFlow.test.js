const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_key';
process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
process.env.TWILIO_AUTH_TOKEN = 'test_token';
const { replyFor } = require('../src/salonFlow');
const { processInboundSms } = require('../src/salonFlow');
test('capture passes destination to atomic RPC without direct reads or sends', async () => {
  const calls = [];
  const db = { rpc: async (...args) => { calls.push(args); return { error: null }; } };
  const result = await processInboundSms({messageSid:'SM-test',from:'+61400000000',to:'+61400000001',body:'Colour'},db);
  assert.equal(result.sent,false);
  assert.deepEqual(calls,[['kaspr_capture_sms',{p_sid:'SM-test',p_phone:'+61400000000',p_to:'+61400000001',p_body:'Colour'}]]);
});
test('capture propagates persistence failures for webhook retry', async () => {
  await assert.rejects(processInboundSms({messageSid:'SM-test',from:'+61400000000',to:'+61400000001',body:'Colour'}, {rpc:async()=>({error:new Error('database unavailable')})}),/database unavailable/);
});
test('capture rejects missing destination before accessing database', async () => {
  await assert.rejects(processInboundSms({messageSid:'SM-test',from:'+61400000000',body:'Colour'},{}),/destination/);
});
test('asks for a service when the reply is not specific', () => {
  const r = replyFor({businessName:'Test Salon',services:['Haircut','Colour'],text:'hello',state:'service'});
  assert.equal(r.state,'service'); assert.match(r.body,/Haircut/);
});
test('offers configured booking link for a named service', () => {
  const r = replyFor({businessName:'Test Salon',services:['Colour'],bookingUrl:'https://book.example',text:'I want to book a colour',state:'service'});
  assert.equal(r.state,'time'); assert.match(r.body,/https:\/\/book\.example/);
});
test('hands off when availability cannot be verified', () => {
  const r = replyFor({businessName:'Test Salon',services:['Colour'],text:'Tuesday afternoon',state:'time'});
  assert.equal(r.state,'handoff');
});
