// Explicit synthetic auth fixtures only. Never print tokens/passwords or follow
// OAuth redirects. Remove only IDs returned by this run; no messages/calls.
const {randomUUID,randomBytes}=require('node:crypto');
const {createClient}=require('@supabase/supabase-js');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const users=[],clients=[];
const base='https://kaspr-agent1-production.up.railway.app';
const check=(ok,label)=>{if(!ok)throw Error(label);console.log('PASS '+label);};
(async()=>{
 for(let n=0;n<2;n++){
  const email=`kaspr-security-${randomUUID()}@example.com`, password=randomBytes(32).toString('base64url');
  const u=await db.auth.admin.createUser({email,password,email_confirm:true});if(u.error)throw Error('fixture_auth_create');users.push(u.data.user.id);
  const c=await db.from('clients').insert({business_name:'Kaspr synthetic authorization fixture',niche:'test',whatsapp_numbers:[],active:false,recovery_enabled:false}).select('id').single();if(c.error)throw Error('fixture_client_create');clients.push(c.data.id);
  const m=await db.from('tenant_memberships').insert({user_id:u.data.user.id,client_id:c.data.id});if(m.error)throw Error('fixture_membership');
  if(n===0){
   const auth=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
   const session=await auth.auth.signInWithPassword({email,password});if(session.error)throw Error('fixture_login');
   globalThis.fixtureToken=session.data.session.access_token;
  }
 }
 const request=(id,token)=>fetch(`${base}/auth/instagram/connect?client_id=${id}`,{headers:token?{Authorization:`Bearer ${token}`}:{},redirect:'manual'});
 check((await request(clients[0])).status===401,'live anonymous connection denied');
 check((await request(clients[0],'invalid')).status===401,'live forged token denied');
 check((await request(clients[1],globalThis.fixtureToken)).status===403,'live other-tenant connection denied');
 const own=await request(clients[0],globalThis.fixtureToken);check(own.status===302,'live own-tenant setup allowed (redirect not followed)');
 const state=new URL(own.headers.get('location')).searchParams.get('state');
 check((await fetch(`${base}/auth/instagram/callback?code=synthetic&state=${state}`,{redirect:'manual'})).status===400,'callback without browser binding denied before exchange');
})().catch(e=>{console.error('FAIL '+e.message);process.exitCode=1;}).finally(async()=>{
 delete globalThis.fixtureToken;
 for(const id of users){const r=await db.auth.admin.deleteUser(id);if(r.error){console.error('Synthetic user cleanup failed: '+id);process.exitCode=1;}}
 for(const id of clients){const r=await db.from('clients').delete().eq('id',id);if(r.error){console.error('Synthetic client cleanup failed: '+id);process.exitCode=1;}}
 console.log('Synthetic cleanup attempted for exact created IDs; verify absence separately');
});
