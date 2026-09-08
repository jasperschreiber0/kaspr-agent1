// Backend operator tool; no HTTP control endpoint or customer interface.
const {createClient}=require('@supabase/supabase-js');
const {notifyOperator}=require('../src/recoveryMonitor');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
 const [action='status',client,thread]=process.argv.slice(2);let result;
 if(action==='status') result=await db.rpc('kaspr_recovery_metrics');
 else if(action==='pause'||action==='resume') result=await db.from('recovery_controls').update({paused:action==='pause'}).eq('id',true).select('paused').single();
 else if(action==='takeover' && /^[0-9a-f-]{36}$/i.test(client||'') && /^[0-9a-f-]{36}$/i.test(thread||'')) result=await db.rpc('kaspr_takeover',{p_client:client,p_thread:thread});
 else if(action==='test-alert'){await notifyOperator({controlled_operator_transport_test:1});console.log('Operator endpoint accepted test; human receipt not established');return;}
 else throw Error('usage');
 if(result.error)throw Error('operation_failed');console.log(JSON.stringify(result.data));
})().catch(()=>{console.error('Operator action failed; inspect configuration securely. No provider error or credential emitted.');process.exitCode=1;});
