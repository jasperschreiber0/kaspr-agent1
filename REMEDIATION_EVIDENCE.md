# Kaspr remediation — 8 September 2026

## Verified production target

- GitHub: jasperschreiber0/kaspr-agent1, main.
- Railway: chic-happiness / production / kaspr-agent1.
- Project: d970b516-501e-4f7d-b363-56f71bbcf1e4.
- Service: 26f942e7-b797-4092-a5b2-18774a4e412a.
- Supabase: mhsygkmdfrpkmhohieql.

## Applied migrations

- 20260908025753 salon_flow_reconciliation: additive durable inbox/outbox,
  retries, provider SID and final-delivery reconciliation, global opt-out
  compatibility without deleting prior tenant suppression records.
- 20260908030447 tenant_access_controls: all six original RLS exposures closed.
  Tenant membership grants safe read access to owned records. Client credential
  columns remain backend-only. Cross-tenant operational tables remain backend-only.
- 20260908030800 recovery_guardrails: readiness checks required tables and RPC access.

The older ledger/booking schema already existed without migration history.
It was inspected rather than replayed. Production migration identifiers match
the new committed filenames; do not blindly replay the older baseline files.

## Evidence and reproducible checks

- `npm test`: 23 tests passed locally; production pre-deploy runs the same suite.
- `npm run test:database`: PostgreSQL fixtures cover production suppression drift,
  duplicate call/SMS/reply handling, retries/backoff/exhaustion, crash quarantine,
  delivery ordering, provider SID mismatch, STOP, completion-gated reviews,
  tenant access and anonymous denial.
- `test/recovery-production.sql`: ran against production with transaction rollback;
  verified recovery, reply, manual booking, attendance/value and exactly one AUD 280
  attribution. Independently verified zero leftover fixture clients/outbox rows.
- `test/tenant-isolation.sql`: ran against production with rollback; two tenants,
  nonmember and anonymous access, credential denial, write denial, membership
  escalation denial, service-role read/write all passed.
- Live `/health` independently returned the deployed Git SHA, schema 2 and healthy
  worker. Railway runtime logs showed `[recovery-worker] heartbeat schema=2`.
- Unsigned SMS request returned 403.
- Signed synthetic production webhooks were replayed twice and persisted exactly
  one call outcome and one unmatched inbox entry, with zero outbox records:
  `CA65e6bdb9c6a4602f68c4bdc47b893660`,
  `SM814578ef1cbc650e0cba8bead9a85755`.
  These identifiers are synthetic fixtures, not Twilio delivery evidence.

## Manual-pilot decision: FAIL / HOLD

- Meta secret logging removed from deployed code. Rotation in Meta and replacement
  in Railway require owner interaction and have not been confirmed. Neither secret
  is recorded here.
- Controlled handset recipient not yet confirmed; no real outbound messages or
  calls were generated. Carrier delivery and handset receipt remain unverified.
- Test Client recovery remains disabled; no recovery SMS number, service catalogue,
  booking link or review link was enabled. Automatic replies remain disabled.
- Voicemail still cannot be distinguished from a human answer when Twilio reports
  completed. Completed outcomes are persisted, but do not trigger recovery SMS.
- Manual booking remains explicit. There is no external booking-system integration
  or verified automatic attendance/revenue attribution.
- Shared operator dashboard is not a tenant-login interface; RLS does not scope a
  server-side service-role dashboard to an individual salon.
- Additional security findings outside the six original tables remain: permissive
  public policies on product_queue, agent_memory and email_list; privileged view
  v_pack_usage_current_month; legacy function hardening warnings.
- Dependency audit reported 7 existing vulnerabilities (2 moderate, 5 high).
- Ambiguous sends are quarantined, never blindly retried. Resolving a lost provider
  response with no SID requires operator investigation; no alert integration was added.

## Secret rotation handoff

In Meta Developers, select Kaspr → Settings → Basic → reset App Secret. Enter the
replacement directly in Railway's verified service variable META_APP_SECRET and
save. Do not paste it into chat, files, scripts or logs. Confirm completion without
revealing its value. Until rotation is verified, the pilot remains on hold.
