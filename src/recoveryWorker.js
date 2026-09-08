const { createClient } = require('@supabase/supabase-js');
const { sendSms, fetchMessage } = require('./smsSender');
const { createRecoveryRuntime } = require('./recoveryRuntime');
const { createMonitor, notifyOperator } = require('./recoveryMonitor');
const monitor = createMonitor({ notify: notifyOperator });
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const callbackBase = process.env.PUBLIC_BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
const runtime = createRecoveryRuntime({ db, sendSms, fetchMessage, callbackBase, autoReply: process.env.RECOVERY_AUTOREPLY_ENABLED === 'true' });
let lastSuccess = null;
let failures = 0;
function workerHealthy() {
  return lastSuccess !== null && Date.now() - lastSuccess < 120000;
}
function startRecoveryWorker({ intervalMs = 5000 } = {}) {
  if (!callbackBase.startsWith('https://')) throw new Error('HTTPS PUBLIC_BASE_URL required');
  let running = false, ticks = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      let failed = false;
      for (const operation of [runtime.processInbox, runtime.processOne]) {
        try { await operation(); } catch { failed=true; }
      }
      if (ticks++ % 12 === 0) {
        await runtime.queueReviews();
        await runtime.reconcile();
        await monitor({...await runtime.metrics(), repeated_worker_failures:failures>=3?failures:0});
        console.log('[recovery-worker] heartbeat schema=3');
      }
      if (failed) { failures++; if(failures>=3) await monitor({repeated_worker_failures:failures}); }
      else { failures=0; lastSuccess = Date.now(); }
    } catch { failures++; console.error('[recovery-worker] tick_failed'); if(failures>=3) await monitor({repeated_worker_failures:failures}); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  const startedAt = Date.now();
  // Independent timer still alerts if a pending network promise stalls tick().
  // A dead process/host itself remains the hosting platform's responsibility.
  const watchdog = setInterval(() => {
    if (Date.now()-startedAt>120000 && !workerHealthy()) void monitor({worker_stalled:1});
  }, 60000);
  watchdog.unref?.();
  timer.unref?.();
  void tick();
  return timer;
}
module.exports = { startRecoveryWorker, workerHealthy };
