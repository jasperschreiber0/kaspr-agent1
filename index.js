require('dotenv').config();
const express = require('express');
const webhookRouter = require('./src/webhook');

// Validate required env vars on startup
const REQUIRED_ENV = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'OPENAI_API_KEY',
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();

// Parse URL-encoded bodies (Twilio sends form data)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'kaspr-agent1', ts: new Date().toISOString() });
});

// Twilio webhook routes
app.use('/webhook', webhookRouter);

// 404 catch-all
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[kaspr-agent1] Content Receiver running on port ${PORT}`);
  console.log(`[kaspr-agent1] Webhook: POST /webhook/whatsapp`);
  console.log(`[kaspr-agent1] Health:  GET  /health`);
});
