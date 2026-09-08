const { createClient } = require('@supabase/supabase-js');
const { sendSms, fetchMessage } = require('./smsSender');
const { createRecoveryRuntime } = require('./recoveryRuntime');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const callbackBase = process.env.PUBLIC_BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
const runtime = createRecoveryRuntime({ db, sendSms, fetchMessage, callbackBase, autoReply: process.env.RECOVERY_AUTOREPLY_ENABLED === 'true' });
let lastSuccess = null;
function startRecoveryWorker({ intervalMs = 5000 } = {}) {
  if (!callbackBase.startsWith('https://')) throw new Error('HTTPS PUBLIC_BASE_URL required');
  let running = false, ticks = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runtime.processInbox();
      await runtime.processOne();
      if (ticks++ % 12 === 0) {
        await runtime.queueReviews();
        await runtime.reconcile();
        console.log('[recovery-worker] heartbeat schema=2');
      }
      lastSuccess = Date.now();
    } catch (error) { console.error('[recovery-worker] tick_failed code=' + (error.code || 'runtime')); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return timer;
}
module.exports = { startRecoveryWorker, workerHealthy: () => lastSuccess !== null && Date.now() - lastSuccess < 120000 };
