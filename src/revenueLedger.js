const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function createMissedCallOpportunity({ clientId, callerPhone, missedCallId, callSid, detectedAt }) {
  if (callSid) {
    const { data: existing, error: lookupError } = await supabase
      .from('revenue_opportunities')
      .select('id, client_id, customer_phone, type, status, detected_at')
      .eq('source_call_sid', callSid)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) return existing;
  }

  const { data: opportunity, error } = await supabase
    .from('revenue_opportunities')
    .insert({
      client_id: clientId,
      customer_phone: callerPhone,
      source_call_sid: callSid || null,
      type: 'missed_call',
      status: 'identified',
      source_missed_call_id: missedCallId || null,
      detected_at: detectedAt || new Date().toISOString(),
    })
    .select('id, client_id, customer_phone, type, status, detected_at')
    .single();
  if (error) throw error;

  await recordRevenueEvent({
    opportunityId: opportunity.id,
    clientId,
    eventName: 'opportunity_created',
    metadata: { source: 'missed_call', missed_call_id: missedCallId || null },
  });
  return opportunity;
}

async function recordRevenueEvent({ opportunityId, clientId, eventName, metadata = {} }) {
  const { error } = await supabase.from('revenue_events').insert({
    opportunity_id: opportunityId,
    client_id: clientId,
    event_name: eventName,
    metadata,
  });
  if (error) throw error;
}

async function markOpportunityContacted(opportunityId, clientId, metadata = {}) {
  const { error } = await supabase.from('revenue_opportunities').update({ status: 'contacted' }).eq('id', opportunityId);
  if (error) throw error;
  await recordRevenueEvent({ opportunityId, clientId, eventName: 'customer_contacted', metadata });
}

async function recordCustomerReply({ customerPhone, body, messageSid }) {
  const { data, error } = await supabase.rpc('kaspr_record_reply', {
    p_phone: customerPhone, p_body: body, p_sid: messageSid,
  });
  if (error) throw error;
  return data ? { id: data } : null;
}

module.exports = { createMissedCallOpportunity, recordRevenueEvent, markOpportunityContacted, recordCustomerReply };
