const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tenantAuth(db) {
  return async (req,res,next) => {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token) return res.status(401).send('Authentication required');
    if (!UUID.test(req.query.client_id || '')) return res.status(400).send('Invalid client');
    try {
      const {data,error} = await db.auth.getUser(token);
      if(error || !data?.user) return res.status(401).send('Authentication required');
      const membership=await db.from('tenant_memberships').select('client_id').eq('user_id',data.user.id).eq('client_id',req.query.client_id).maybeSingle();
      if(membership.error) return res.status(503).send('Authorization unavailable');
      if(!membership.data) return res.status(403).send('Forbidden');
      req.tenantUser=data.user.id; next();
    } catch { return res.status(503).send('Authorization unavailable'); }
  };
}
module.exports={tenantAuth};
