require('dotenv').config();
const express = require('express');
const webhookRouter = require('./src/webhook');
const stripeWebhookRouter = require('./src/stripeWebhook');
const metaWebhookRouter = require('./src/metaWebhook'); // ← new

const REQUIRED_ENV = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',  // ← new
  'META_VERIFY_TOKEN',  // ← new
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
app.use('/webhook/meta', metaWebhookRouter); // ← new

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[kaspr-agent1] Content Receiver running on port ${PORT}`);
  console.log(`[kaspr-agent1] Webhook: POST /webhook/whatsapp`);
  console.log(`[kaspr-agent1] Webhook: POST /webhook/meta`);  // ← new
  console.log(`[kaspr-agent1] Health:  GET  /health`);
});
