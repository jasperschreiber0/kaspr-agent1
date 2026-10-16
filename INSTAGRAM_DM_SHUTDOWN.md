# Account-scoped Instagram automated DM shutdown

`IG_DM_BLOCKED_ACCOUNT_IDS` is a comma-separated list of exact Instagram
business account IDs. Both inbound DM replies and comment-triggered DMs stop
before Claude generation for listed accounts. The shared DM send function checks
again before calling Meta. No publishing code or credentials are changed.

The default is empty; deploying this patch alone disables no account.

## Activation prerequisites

1. Verify the numeric Instagram business account ID belonging to `@kaspr_social`
   through an authenticated Meta identity lookup or account settings. Independently
   confirm it differs from the intended growth account `@kasprsocial`.
2. Reconcile the missing `clients.instagram_account_id` mapping before changing
   production. Do not use a client UUID, business display name, or a DM sender ID.
3. Obtain approval to deploy this patch and set `IG_DM_BLOCKED_ACCOUNT_IDS` to the
   verified underscore account ID in the kaspr-agent1 production service.
4. Verify deployment success and the effective configuration. Observe subsequent
   naturally occurring events: the blocked account should log disabled automation
   with no generation or send. Do not send test DMs without authorization.

To reverse the block, remove only that ID from the variable and roll out the
updated configuration. No database migration or access changes are required.

## Investigation evidence (2026-10-16 UTC)

- Deployment `986d8985-af00-4cf6-bea8-7ea00bed2a0c` runs commit
  `13d4b188f8858547d3e5a928ea0d92310d5c62fa` from `main`.
- Deployment DNS logs during 09:52–09:54 confirm calls to
  `mhsygkmdfrpkmhohieql.supabase.co`, `graph.facebook.com`, and `api.anthropic.com`.
- Runtime logs report DM replies at 08:58:53, 08:59:11, 09:11:05, 09:52:41,
  and 09:53:31. Their logged IDs are message senders, not the business account ID.
- Read-only database lookup found two client rows with null Instagram account
  IDs. The Kaspr Social row has an Instagram token, but its display name does not
  establish its Instagram username. No token values were retrieved.
- Railway CLI authentication succeeds, but SSH reports no registered key.
  No key was added and no credentials or access settings were changed.
- No production setting has been changed. Exact handle-to-ID verification and
  deployment approval remain outstanding.
