require('dotenv').config();
const express = require('express');
const webhookRouter = require('./src/webhook');
const smsWebhookRouter = require('./src/smsWebhook');
const voiceWebhookRouter = require('./src/voiceWebhook');
const stripeWebhookRouter = require('./src/stripeWebhook');
const metaWebhookRouter = require('./src/metaWebhook');
const igAuthRouter = require('./src/igAuth'); // ← new

const REQUIRED_ENV = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
  'TWILIO_SMS_NUMBER',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',
  'META_VERIFY_TOKEN',
  'META_APP_ID',      // ← new
  'META_APP_SECRET',  // ← new
  'META_REDIRECT_URI', // ← new
];
 
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}
 
const app = express();
 
app.use('/stripe-webhook', stripeWebhookRouter);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
 
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'kaspr-agent1', ts: new Date().toISOString() });
});
 
app.use('/webhook', webhookRouter);
app.use('/webhook', smsWebhookRouter);
app.use('/webhook', voiceWebhookRouter);
app.use('/webhook/meta', metaWebhookRouter);
app.use('/auth/instagram', igAuthRouter); // ← new
 
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});
 
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[kaspr-agent1] Running on port ${PORT}`);
  console.log(`[kaspr-agent1] Webhook: POST /webhook/whatsapp`);
  console.log(`[kaspr-agent1] Webhook: POST /webhook/sms`);
  console.log(`[kaspr-agent1] Webhook: POST /webhook/voice`);
  console.log(`[kaspr-agent1] Webhook: POST /webhook/voice-status`);
  console.log(`[kaspr-agent1] Webhook: POST /webhook/meta`);
  console.log(`[kaspr-agent1] Auth:    GET  /auth/instagram/connect`);
  console.log(`[kaspr-agent1] Auth:    GET  /auth/instagram/callback`);
  console.log(`[kaspr-agent1] Health:  GET  /health`);
});
