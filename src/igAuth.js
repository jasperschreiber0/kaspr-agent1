const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
 
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI;
 
const SCOPES = [
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_manage_comments',
  'instagram_content_publish',
].join(',');

// In-memory CSRF state store: state token -> { clientId, createdAt }.
// Survives the OAuth round-trip (~10 min window); fine for this
// low-volume onboarding flow. Same pattern as tiktokAuth.js.
const stateStore = new Map();

function pruneStaleStates() {
  for (const [key, val] of stateStore.entries()) {
    if (Date.now() - val.createdAt > 10 * 60 * 1000) stateStore.delete(key);
  }
}
 
/**
 * GET /auth/instagram/connect?client_id=UUID
 * Redirects the studio owner to Meta's OAuth consent screen.
 * client_id is their row UUID in the clients table. We mint a random
 * state token bound to it server-side rather than passing client_id
 * directly as state, so the callback can't be tricked into binding a
 * token to an arbitrary client row.
 */
router.get('/connect', (req, res) => {
  const clientId = req.query.client_id;
  if (!clientId) {
    return res.status(400).send('Missing client_id');
  }

  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { clientId, createdAt: Date.now() });
  pruneStaleStates();
 
  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  url.searchParams.set('client_id', APP_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
 
  console.log(`[ig-auth] Redirecting client ${clientId} to Meta OAuth`);
  res.redirect(url.toString());
});
 
/**
 * GET /auth/instagram/callback
 * Meta redirects here after the user approves. We:
 * 1. Validate the state token and recover the client_id
 * 2. Exchange the code for a short-lived token
 * 3. Exchange that for a long-lived token (60 days)
 * 4. Fetch their IG account ID
 * 5. Save token + expiry to clients table
 */
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
 
  if (error) {
    console.error('[ig-auth] OAuth error:', error, error_description);
    return res.status(400).send(`OAuth error: ${error_description || error}`);
  }
 
  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  const stateData = stateStore.get(state);
  if (!stateData) {
    return res.status(400).send('Invalid or expired state. Please start the auth flow again.');
  }
  stateStore.delete(state);
  const clientId = stateData.clientId;
 
  try {
    // Step 1: Exchange code for short-lived token
    const tokenRes = await fetch('https://graph.facebook.com/v19.0/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: APP_ID,
        client_secret: APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData.error)}`);
    }
    const shortToken = tokenData.access_token;
    console.log('[ig-auth] Short-lived token obtained');
 
    // Step 2: Exchange for long-lived token (60 days)
    const longTokenRes = await fetch(
      `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${shortToken}`
    );
    const longTokenData = await longTokenRes.json();
    if (longTokenData.error) {
      throw new Error(`Long token exchange failed: ${JSON.stringify(longTokenData.error)}`);
    }
    const longToken = longTokenData.access_token;
    const expiresInSeconds = longTokenData.expires_in || 60 * 24 * 60 * 60; // Meta default: 60 days
    console.log('[ig-auth] Long-lived token obtained');
 
    // Step 3: Get their Facebook Page ID, then IG account ID
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken}`
    );
    const pagesData = await pagesRes.json();
    if (pagesData.error) {
      throw new Error(`Pages fetch failed: ${JSON.stringify(pagesData.error)}`);
    }
 
    // Get the first page's IG account
    const page = pagesData.data?.[0];
    if (!page) {
      throw new Error('No Facebook Pages found for this account');
    }
 
    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
    );
    const igData = await igRes.json();
    const igAccountId = igData.instagram_business_account?.id;
 
    if (!igAccountId) {
      throw new Error('No Instagram Business Account linked to this Facebook Page');
    }
    console.log(`[ig-auth] IG account ID: ${igAccountId}`);
 
    // Step 4: Save to clients table, including when this token expires so
    // a monitoring job can warn us before it silently stops working.
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const { error: dbError } = await supabase
      .from('clients')
      .update({
        instagram_access_token: longToken,
        instagram_account_id: igAccountId,
        instagram_connected_at: new Date().toISOString(),
        instagram_token_expires_at: expiresAt,
      })
      .eq('id', clientId);
 
    if (dbError) {
      throw new Error(`Supabase update failed: ${dbError.message}`);
    }
 
    console.log(`[ig-auth] Client ${clientId} connected IG account ${igAccountId}, expires ${expiresAt}`);
 
    // Success — show a simple confirmation page
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Instagram Connected — Kaspr</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fafaf9; }
            .card { background: white; border-radius: 16px; padding: 48px; text-align: center; max-width: 400px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .icon { font-size: 48px; margin-bottom: 16px; }
            h1 { font-size: 22px; color: #1c1917; margin: 0 0 8px; }
            p { color: #78716c; font-size: 15px; margin: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✅</div>
            <h1>Instagram Connected</h1>
            <p>Your Instagram account is now linked to Kaspr. You can close this window.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('[ig-auth] Error:', err.message);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Error — Kaspr</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h2>Something went wrong</h2>
          <p>${err.message}</p>
          <p>Please contact hello@kaspr.com.au</p>
        </body>
      </html>
    `);
  }
});
 
module.exports = router;
