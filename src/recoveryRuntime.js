const { replyFor, servicesOf } = require('./salonFlow');
function createRecoveryRuntime({ db, sendSms, fetchMessage, autoReply = false, callbackBase, logger = console }) {
  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  }
  async function processInbox() {
    if (!autoReply) return false;
    const item = (await rpc('kaspr_claim_inbox'))?.[0];
    if (!item) return false;
    const { data: thread, error } = await db.from('recovery_threads').select('*,clients(business_name,recovery_services,booking_url)').eq('id', item.thread_id).single();
    if (error) throw error;
    const client = thread.clients;
    const reply = replyFor({ businessName: client.business_name, services: servicesOf(client.recovery_services), bookingUrl: client.booking_url, text: item.body, state: thread.state });
    await rpc('kaspr_finish_reply', { p_id: item.id, p_lease: item.lease_until, p_state: reply.state, p_service: reply.service || thread.service, p_time: thread.state === 'time' ? item.body : thread.preferred_time, p_summary: `Service: ${reply.service || thread.service || 'unknown'}; request: ${item.body}`, p_reply: reply.body });
    return true;
  }
  async function processOne() {
    const item = (await rpc('kaspr_claim_outbox'))?.[0];
    if (!item) return false;
    const { data: client, error } = await db.from('clients').select('recovery_sms_number').eq('id', item.client_id).single();
    if (error) {
      await rpc('kaspr_fail_send', { p_id: item.id, p_outcome: 'retry', p_code: 'database_lookup' });
      throw error;
    }
    const result = await sendSms(item.phone, item.body, { from: client.recovery_sms_number, statusCallback: `${callbackBase}/webhook/sms-status?outboxId=${item.id}` });
    if (!result.sent) {
      await rpc('kaspr_fail_send', { p_id: item.id, p_outcome: result.outcome || 'uncertain', p_code: result.code || result.reason || 'unknown' });
      logger.warn(`[recovery-worker] outcome=${result.outcome || 'uncertain'} outbox=${item.id} attempt=${item.attempts}`);
      return true;
    }
    await rpc('kaspr_complete_send', { p_id: item.id, p_sid: result.sid });
    logger.log(`[recovery-worker] accepted outbox=${item.id} sid=${result.sid} attempt=${item.attempts}`);
    return true;
  }
  async function reconcile() {
    const { data, error } = await db.from('recovery_outbox').select('id,provider_sid').eq('status', 'sent').not('provider_sid', 'is', null).or('delivery_status.is.null,delivery_status.in.(accepted,queued,sending,sent)').order('reconciled_at', { ascending: true, nullsFirst: true }).limit(5);
    if (error) throw error;
    for (const item of data) {
      const message = await fetchMessage(item.provider_sid);
      await rpc('kaspr_delivery_status', { p_id: item.id, p_sid: message.sid, p_status: message.status, p_error: message.errorCode ? String(message.errorCode) : null });
    }
  }
  return { processOne, processInbox, reconcile, queueReviews: () => rpc('kaspr_queue_reviews') };
}
module.exports = { createRecoveryRuntime };
