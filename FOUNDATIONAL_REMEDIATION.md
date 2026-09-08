# Foundational remediation — 8 September 2026

Follow-up: deployment 12ad199 later crashed when its delayed watchdog called an
undefined local workerHealthy function. The follow-up fix defines and exports the
same health function. Regression tests reproduce the original ReferenceError and
exercise five minutes of healthy timer ticks and a stalled asynchronous worker.
Initial health checks alone are insufficient; observe the replacement deployment
beyond the delayed watchdog interval before recording release success.

Scope: security, recovery transport, cancellation, operator visibility. Builder
questions, new enquiry models, attachments, handoff UI, Worka and other product
features remain deferred. Customer recovery stays disabled.

## Database changes

- `20260908040317_foundational_access`: removes public access to product_queue,
  agent_memory and email_list; preserves service-role CRUD. No tenant keys exist
  and no callers were found in the available KASPR source. No rows were deleted.
- Makes v_pack_usage_current_month security-invoker and backend-only, retaining
  the view definition and underlying application access.
- Individually reviewed create_content_pack (invoker, inserts content_packs),
  handle_new_upload (definer storage trigger, inserts upload_queue), and three
  timestamp/append-only trigger functions. Pins their paths and removes browser
  execution; retains service execution and storage-trigger behaviour. Public
  schema CREATE is denied to browser roles; storage has no browser policies.
- `20260908040617_recovery_cancellation`: send-time authorisation, takeover and
  opt-out cancellation, ordered inbound freshness checks, bounded inbox retry,
  backend pause control and count-only operational metrics. Old schema-2 readiness
  remains for rollout compatibility; the new application requires foundation 3.

The advisor returned no warnings/errors after these migrations. Backend-only
tables intentionally retain RLS without browser policies. This is not a claim
that every unrelated service has undergone a comprehensive security audit.

## Application changes

- Instagram setup requires a real user token and membership in the requested
  tenant; callback additionally requires an expiring browser binding and current
  membership. Provider errors are not reflected into HTML or logs. Existing
  anonymous setup links now correctly fail closed; no tenant login UI was built.
- Ambiguous WhatsApp sender membership fails closed rather than selecting the
  first client. WhatsApp STOP uses durable database suppression before HTTP ack.
- Twilio validation uses the configured public origin rather than a supplied host.
- Recovery sends recheck their claim, tenant enablement, pause, suppression,
  takeover and newer replies after suppression lookup, immediately before Twilio.
- Compatible dependency fixes plus qs 6.16.0 override: zero npm audit findings.

## Operator procedure

Use the authenticated Railway CLI to inject environment variables directly into
the child process. Never dump environment variables, copy secrets into commands,
or expose raw provider errors. Verified target:

- Project d970b516-501e-4f7d-b363-56f71bbcf1e4 (chic-happiness)
- Environment production
- Service 26f942e7-b797-4092-a5b2-18774a4e412a (kaspr-agent1)

Run `node scripts/recovery-ops.cjs status` through that service environment for
counts only. `pause` stops recovery dispatch globally. `resume` requires first
checking pending work, suppression and operator ownership; it does not enable
disabled clients. `takeover CLIENT_UUID THREAD_UUID` validates that pair and
cancels unsent conversational work. These controls are backend-only, with no new
customer dashboard or public control endpoint.

The existing DISCORD_WEBHOOK_KASPR_ERRORS destination receives only issue counts.
Identical issues repeat at most hourly within a process, with a one-minute minimum
between attempts; restart can repeat an alert. A separate watchdog detects an
async-stalled worker. `/health` checks schema and worker freshness. A dead process,
blocked event loop or host outage cannot report through its own timer; platform
or external uptime notifications remain a separate coverage boundary.

Investigate:

1. Pause if sends may be incorrect; do not clear opt-outs.
2. Read status and inspect only the specific affected IDs with backend access.
3. Failed/undelivered: inspect the provider result securely and correct the cause.
   Do not repeatedly retry a non-textable destination.
4. Uncertain: reconcile using the provider SID if known. With no SID, investigate
   provider records before considering another send. Never reset all uncertain
   rows to pending. A crash after an API request may have delivered a message.
5. Exhausted inbox: fix the fault, then reset attempts/next_attempt_at only for
   reviewed rows. Newer replies and takeover must still win.
6. Delivery callback problems: inspect endpoint/signature and run reconciliation.
7. Resume only reviewed work. Existing clients remain disabled in this release.

## Cancellation boundary

Pending and claimed-but-not-dispatched work is cancelled. A final database gate
marks dispatch start and immediately calls the provider. Database state and a
remote provider request cannot share one atomic transaction: takeover arriving
after that gate may overlap an in-flight request. Provider-accepted messages
cannot be recalled here. Preserve their SID and delivery evidence; never falsely
label them cancelled or resend them after a restart.

## Routing findings and limits

Read-only Twilio inspection confirmed the configured number supports voice/SMS
and points both webhooks to the verified service. No calls/messages were placed.
Answered/voicemail both arrive as `completed` in this forwarding flow. The code
must not relabel every completed call as missed. The existing 20-second Dial
timeout is not proof of avoiding voicemail: provider timing can include a buffer.
Resolve with an authorised handset test and carrier voicemail/ring configuration
so carrier voicemail cannot answer the forwarded leg first. No press-1 screening,
speculative machine detection or guessed routing change was introduced.

Repeated events are idempotent; distinct calls remain distinct recorded outcomes,
while recovery cooldown prevents repeated messages. Non-textable rejections are
permanent failures; timeouts/server errors are uncertain, not safe retries.

## Verification and remaining prerequisites

Local: unit/HTTP tests and embedded PostgreSQL suites cover tenant authorization,
send gates, retries, pause, stale replies, takeover, dispatch replay, restart
quarantine, opt-outs and operator alert deduplication. These are simulated.

Live SQL: test/foundational-access.sql and test/cancellation-production.sql ran
with rollback; the latter touches only its newly created rows, never claims a
global queue, and invokes no transport. These establish database behaviour, not
handset delivery. Migration history matches committed filenames.

Post-release checks and the exact deployed SHA are recorded in the task result.
`scripts/verify-live-auth.cjs` uses only newly generated synthetic accounts and
disabled fixture clients, does not follow Meta redirects or exchange tokens,
and deletes only this run's fixture IDs. It must not be used as a customer test.

Meta rotation remains unconfirmed: owner must reset the Kaspr App Secret in Meta
Developers / Settings / Basic and enter it directly into META_APP_SECRET on the
verified Railway service. Never paste either value into chat, files or logs.
No authorised handset recipient is documented; actual SMS receipt and voicemail
behaviour await explicit test-recipient authorisation. Foundations alone do not
establish pilot readiness or validate the builder workflow/customer value.
