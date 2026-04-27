const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const name = session.customer_details?.name?.split(' ')[0] || 'there';

    try {
      await resend.emails.send({
        from: 'Jasper at Kaspr <hello@kaspr.com.au>',
        to: email,
        subject: "You're in — here's what happens next ✓",
        text: `Hi ${name},\n\nPayment confirmed. Welcome to Kaspr.\n\nHere's exactly what happens from here:\n\nToday\nYou'll receive a short questionnaire — takes about 10 minutes.\n\nWithin 48 hours\nWe'll review your answers and set up your automations.\n\nDay 3–5\nYour agents go live.\n\nAny questions, reply to this email or message us at contact@kaspr.com.au.\n\n— Jasper\nKaspr | kaspr.com.au`,
      });
      console.log(`[stripe] Welcome email sent to ${email}`);
    } catch (err) {
      console.error('[stripe] Resend failed:', err.message);
    }
  }

  res.json({ received: true });
});

module.exports = router;
