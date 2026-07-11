const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Matches kaspr-site's components/Pricing.tsx PLANS (Grow / Full Stack).
const TIER_MAP = {
  [process.env.STRIPE_PRICE_GROW]:       'grow',
  [process.env.STRIPE_PRICE_FULL_STACK]: 'full_stack',
};

const TIER_LABELS = {
  grow:       'Grow',
  full_stack: 'Full Stack',
};

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] Signature verification failed:', err.message);
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  if (event.type === 'checkout.session.completed') {
    const sessionRaw = event.data.object;

    // Fetch full session with line items expanded
    const session = await stripe.checkout.sessions.retrieve(sessionRaw.id, {
      expand: ['line_items'],
    });

    const email = session.customer_details?.email;
    const name = session.customer_details?.name?.split(' ')[0] || 'there';
    const priceId = session.line_items?.data?.[0]?.price?.id || null;
    const tier = TIER_MAP[priceId] || 'grow';
    const tierLabel = TIER_LABELS[tier];

    console.log('[stripe] Payment from ' + email + ' | tier: ' + tierLabel + ' | priceId: ' + priceId);

    // Email 1A — immediate
    try {
      await resend.emails.send({
        from: 'Jasper at Kaspr <hello@kaspr.com.au>',
        to: email,
        subject: "You're in — here's what happens next ✓",
        text: `Hi ${name},\n\nPayment confirmed. Welcome to Kaspr.\n\nHere's exactly what happens from here:\n\nToday\nYou'll receive a short questionnaire — takes about 10 minutes. This is how we learn your business, your voice, and what you want Kaspr to handle.\n\nWithin 48 hours\nWe'll review your answers and set up your automations. If we need anything else we'll reach out directly.\n\nDay 3–5\nYour agents go live. You'll get a confirmation message and your first content preview to approve before anything is posted publicly.\n\nAny questions, reply to this email or message us at contact@kaspr.com.au.\n\n— Jasper\nKaspr | kaspr.com.au`,
      });
      console.log('[stripe] Email 1A sent to ' + email);
    } catch (err) {
      console.error('[stripe] Email 1A failed:', err.message);
    }

    // Email 2A — 1 hour delay
    setTimeout(async () => {
      try {
        await resend.emails.send({
          from: 'Jasper at Kaspr <hello@kaspr.com.au>',
          to: email,
          subject: '10 minutes now saves you hours every week — your Kaspr setup',
          text: buildQuestionnaire(name, tier, tierLabel),
        });
        console.log('[stripe] Email 2A sent to ' + email);
      } catch (err) {
        console.error('[stripe] Email 2A failed:', err.message);
      }
    }, 60 * 60 * 1000);

    console.log('[stripe] Email 2A queued for ' + email + ' in 1 hour');
  }

  res.json({ received: true });
});

function buildQuestionnaire(name, tier, tierLabel) {
  const socialSection = `
---

Your platforms

9. Which platform are we setting up first?
(Instagram / TikTok / Both)

10. What's your Instagram handle? What's your TikTok handle?

11. How often do you currently post?
(e.g. "Once a week if I'm lucky", "3x a week when I have time", "Almost never")

12. What kind of content performs best for you?
(e.g. "Before and afters", "Reels of the process", "Client results with music")
`;

  return `Hi ${name},

Before we build anything, we need to understand your business properly. The more detail you give us here, the better Kaspr will sound like you — not a generic bot.

Takes about 10 minutes. Answer as casually as you like.

You're on the ${tierLabel} plan.

---

KASPR ONBOARDING QUESTIONNAIRE

Your business

1. What's your business name and what do you do?
(e.g. "Luna Nails — gel nails, nail art, and lash extensions in Surry Hills")

2. Who are your ideal clients?
(e.g. "Women 25-40, local, book regulars every 3-4 weeks, follow us on Instagram")

3. What are your most popular services and prices?
(List your top 5 — this is what Kaspr will use in automations)

4. What's your booking process?
(e.g. "Book via Fresha", "DM us and we'll send a link", "Call to book")

5. What's your availability like right now?
(e.g. "Fully booked 2 weeks out", "Spots available this week", "Waitlist open")

---

Your voice

6. How would you describe the way you talk to clients?
(e.g. "Casual and friendly, lots of emojis", "Professional but warm", "Like talking to a mate")

7. Paste 3-5 examples of DM replies you've sent that felt right.
(Just copy and paste from your Instagram or TikTok inbox — exactly as you wrote them)

8. Are there any words, phrases, or tones you want Kaspr to avoid?
(e.g. "Don't say leverage or streamline — just talk normally")
${socialSection}
---

Your goals

13. What's the #1 thing you want Kaspr to fix?
(e.g. "Stop missing DMs from new clients", "Post consistently without thinking about it", "Follow up enquiries that go cold")

14. What does a good week look like for your business?
(e.g. "Fully booked, 3 new client enquiries, 1 new follower booking")

15. Anything else we should know before we set up your automations?

---

Reply to this email with your answers, or paste them into a Google Doc and share the link. Either works.

We'll review within 24 hours and reach out if we have any follow-up questions.

— Jasper
Kaspr | kaspr.com.au`;
}

module.exports = router;
