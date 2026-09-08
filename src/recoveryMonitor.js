// Operator-only counts. Never forward bodies, numbers, credentials or raw errors.
function createMonitor({ notify, now = Date.now, logger = console }) {
  let previous = '', lastAttempt = 0;
  return async function monitor(metrics) {
    const issues = Object.fromEntries(Object.entries(metrics).filter(([k,v]) => k !== 'paused' && Number(v)>0));
    const key = JSON.stringify(issues);
    if (key === '{}') { previous = ''; return; }
    if (key === previous && now()-lastAttempt < 60*60*1000) return;
    if (lastAttempt && now()-lastAttempt < 60*1000) return;
    lastAttempt = now();
    logger.error('[recovery-alert] ' + key);
    try { await notify(issues); previous = key; }
    catch { logger.error('[recovery-alert] operator_notification_failed'); }
  };
}
async function notifyOperator(counts) {
  const url = process.env.DISCORD_WEBHOOK_KASPR_ERRORS;
  if (!url) throw new Error('operator_alert_not_configured');
  const response = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:'KASPR recovery operator check: '+JSON.stringify(counts)}), signal:AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('operator_alert_failed');
}
module.exports = { createMonitor, notifyOperator };
