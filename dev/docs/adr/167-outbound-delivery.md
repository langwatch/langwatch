# ADR-167: Outbound delivery: each destination kind owns its sending

**Date:** 2026-09-30

**Status:** Accepted (Alex, 2026-09-30: option B)

**Numbering:** 166 is taken by the grant-scoped data access ADR, drafted the same day.

**Related:** [ADR-040](040-webhook-http-request-automation-channel.md) (the outbox owns retry; one
sender), [ADR-053](053-tenant-aware-egress-and-workload-isolation.md) (egress isolation),
`ARCHITECTURE.md` §3.2 (channels), §9 ("a fact is recorded by its owner; delivery modules are
handed it; there is no relay module"), `.claude/handoffs/eg1.md` §11 (the blocked sender move).

## Context

Alex, 2026-09-30: webhooks should be "a thing in their own", like Slack; SQS "isn't really a
webhook, more of a pusher"; automation "just uses transport integrations". Either one system in
front handles the complex logic of sending, or each kind decides with a helper via process
managers. Destinations have many producers, not only automation.

### 1. Every outbound path today (branch; main's behaviour in §Parity)

| Path | Owner | Retry | Caps | Signing | SSRF | Dead-letter | Ledger / status | Edges that cross |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/egress` webhook sender (`webhook/*`, `webhook-egress.service`, rate limiter) | a framework package holding feature code | none inside: classifies, throws `DispatchError` | 1000/h per scope, key `webhook-dispatch:<scope>` | Stripe `t=,v1=`, newest secret first, vectors task | fenced fetch | caller's | none | ❌ egress → `automation-contract` (`url-policy.ts:3`, `webhook-egress.service.ts:7`) |
| `packages/egress` SSRF + outbound proxy | framework | n/a | n/a | n/a | owns it | n/a | n/a | ✅ 13 modules, MCP, scenario-child consume it |
| webhook endpoints, HTTP (`modules/webhook`) | webhook | Stripe ladder, 11 attempts, `Retry-After` floor | same cap at org scope, per-endpoint in-flight cap, coalescing | egress | egress | terminal dead-letters at once; ops redrive; 72h auto-disable | `WebhookEndpointDelivery` (webhook's) | ❌ producer code inside: spend and governance envelopes, `gateway-contract` |
| webhook endpoints, SQS (`channels/sqs`) | webhook | same ladder | same cap | same signed bytes | n/a (queue URL rules) | same | same, status `null`, body = message id | egress types |
| automation HTTP request action | automation | trigger/report PM outbox | project-scope cap | egress | egress | outbox `dead` | ❌ writes and prunes webhook's `WebhookEndpointDelivery` (a second owner, a second prune PM) | egress |
| automation Slack (incoming webhook, Web API) | automation; connections move to `slack` (on `feat/intake-6900`) | outbox; 403/404/410 terminal, 429/5xx retry | Slack's own | none | `hooks.slack.com` guard + fence | outbox `dead` | fire history only | `SlackApi` (intake branch) |
| automation email | automation decides, notification sends | outbox | per-trigger hourly cap (claimed once per dispatch), suppression list | n/a | n/a | outbox `dead` | recipient-sent claims | `NotificationApi.sendEmail` ✅ |
| notification mail | notification | none (the caller's) | none | n/a | provider SDK | none | none | ✅ API only |
| governance anomaly alerts | governance (enterprise) | ❌ in-process sleep loop, 2 retries, 250ms × 2ⁿ | none | ❌ `sha256=<hex>` in the same header | fenced | none, best-effort, logged | alert row is the truth | ✅ own |
| internal Slack (signups) | auth, identity, organization via `internal-slack` | out of scope: messages to ourselves (§3.2) | | | | | | |
| Go `aigateway` | none | sends nothing to customers: it relays inbound ElevenLabs webhooks to the control plane, and spend reaches TS as facts | | | | | | |
| SCIM | enterprise scim | inbound only (Auth0 log stream, shared-secret check) | | | | | | |

### 2. Producer × destination

Every producer below runs in TypeScript. **W** = worker, **A** = api process.

| Producer ↓ / destination → | HTTP request | Webhook endpoint (HTTP) | Queue push (SQS) | Slack | Email |
| --- | --- | --- | --- | --- | --- |
| automation triggers (trace, evaluation) | ✅ W | | | ✅ W | ✅ W |
| automation graph alerts | ✅ W | | | ✅ W | ✅ W |
| automation reports | | | | ✅ W | ✅ W |
| gateway spend events | | ✅ W | ✅ W | | |
| gateway governance events (budget crossing, key lifecycle) | | ✅ W | ✅ W | | |
| governance anomaly alerts | ✅ W (own sender) | | | | |
| billing usage notices | | | | | ✅ W |
| auth, user, organization, identity mail | | | | | ✅ A |
| Go aigateway, SCIM | none | none | none | none | none |
| langy notifications (a branch, not merged) | | | | ? | ? |

Two facts follow. The receivers are **few kinds, many producers**. The **hard parts are already
shared**: retry with backoff, dead-letter and redrive are the process-manager outbox in
`packages/eventing` (`DispatchError` retryable/terminal/`retryAfterMs`, ops' dead redrive), and
SSRF plus the proxy are `packages/egress`. What is not shared is ownership: two modules write one
ledger table, a package imports a module contract, the webhook module carries gateway code, and
governance runs its own retry loop and signature.

## Options

### (A) One `outbound` module in front

```
 producers ──OutboundApi.requestDelivery({destination:{kind,id}, message})──► outbound
                                                                               │ owns: destination index, ladder PM,
                                                                               │ ledger, caps, dead-letter, redrive
   webhook ◄─┐  peer subscriber on lw.outbound.attempt_due  (kind = "webhook") │
   slack   ◄─┼─ each kind sends ONE attempt, then OutboundApi.recordAttempt ───┘
   email   ◄─┘  (edges run kind → outbound; outbound imports no kind)
```

Kinds plug in by `.withPeerSubscriber` on outbound's events (§9's primitive), installed by the
catalogue. Nothing registers into outbound.

```
automation   outbound             webhook (kind)        slack (kind)        receiver
 │ requestDelivery ×2 ─►│ requested(w), requested(s)
 │                      │── attempt_due(w,#1) ─►│ sign, fence, POST ───────────────►│ 503
 │                      │◄─ recordAttempt(retryable, Retry-After 60s)
 │                      │── attempt_due(s,#1) ────────────────────►│ post ─────────►│ 200
 │                      │◄─ recordAttempt(success) ────────────────│
 │                      │ PM wakes at max(ladder[1], 60s)
 │                      │── attempt_due(w,#2) ─►│ POST ────────────────────────────►│ 410
 │                      │◄─ recordAttempt(terminal)
 │                      │ dead_lettered(w); streak += 1; ledger row; redrive = command
```

### (B) Each destination kind owns its sending (recommended)

```
 automation ──WebhookApi.requestDelivery──► webhook ─┐  each kind: its destinations, its PM on the
 gateway    ──WebhookApi.requestDelivery──►          │  framework outbox (ladder, dead-letter,
 governance ──WebhookApi.requestDelivery──►          │  redrive), its ledger, its caps, its
 automation ──SlackApi.requestDelivery────► slack   ─┤  classification
 billing    ──NotificationApi.sendEmail───► notification ┘
 framework:  packages/eventing (outbox, DispatchError)   packages/egress (SSRF, proxy)
```

```
automation          webhook                         slack                    receiver
 │ requestDelivery ─►│ command → event (answers at once)
 │ requestDelivery ──────────────────────────────►│ command → event
 │                   │ PM intent send(#1): sign, fence, cap, POST ───────────────►│ 503
 │                   │ ledger row; throw DispatchError(retryable, 60s)
 │                   │                            │ intent send(#1) ─────────────►│ 200
 │                   │ outbox waits max(ladder[1], 60s)
 │                   │ intent send(#2) ─────────────────────────────────────────►│ 410
 │                   │ ledger row; DispatchError(terminal) → outbox "dead"
 │                   │ streak += 1 (72h → endpoint disabled); ops redrives the dead intent
```

### Side by side

| | (A) outbound in front | (B) kind owns sending |
| --- | --- | --- |
| New machinery | a module, a destination index, a peer-subscriber send hop, a PM-timed ladder | none: the outbox already retries, dead-letters and redrives |
| Record §9 "no relay module" | ⚠️ outbound sits between the fact's owner and the sender | ✅ "delivery modules are handed it" |
| ADR-040 "no second retry loop" | ✅ | ✅ |
| One producer API | ✅ one token | ⚠️ one **shape**, on each kind's token |
| Cross-kind org cap, one delivery log, one DLQ view | ✅ | ❌ per kind (nobody asks for these today, main has none) |
| Hops per attempt | 3 (event, subscriber, command) | 1 (intent) |
| Payload in the event log | ⚠️ must stay out (§9: no personal data in events), so a read back per attempt | ✅ the outbox row holds it, pruned |
| Main's shape | ❌ new | ✅ main's endpoint PM already lives with its destination |

## Decision

Alex chose **(B)** (2026-09-30). Each destination kind is a module that owns its destinations, its sending, its
attempts and its ledger. Producers name the kind and a destination id; no destination module
holds producer code.

1. **One operation shape, on every kind's API.** `requestDelivery({ organizationId, projectId?,
   destinationId, message: { type, idempotencyKey, body }, source: { module, ref } })` → `{ deliveryId }`.
   It writes a command and answers at once (the spelling of today's `requestGatewayEventDelivery`).
   `source` only groups ledger rows (automation reads its trigger's attempts by it). Mail keeps
   `NotificationApi.sendEmail` until it needs durability.
2. **Retry, dead-letter, redrive are the framework's outbox.** Each kind's PM sets its own ladder
   through `.outbox({ maxAttempts, backoff })` and classifies its own failures. There is no delivery
   template package: the shared part is ~30 lines, and three kinds classify differently.
3. **Placement.**

   | Concern | Lives in | Why |
   | --- | --- | --- |
   | SSRF, redirect fence, outbound proxy | `packages/egress` (framework) | 13+ consumers, no feature knowledge |
   | Signing (`t=,v1=`) and its vectors task | `modules/webhook` | one signer (HTTP and SQS carry the same bytes); protocol, not framework |
   | Hourly cap (1000/h, key unchanged) | webhook, a repository over Redis | one owner of the keyspace |
   | Ledger `WebhookEndpointDelivery` and its prune | webhook only | owning a table means every query on it |
   | Email caps, suppression, persist cap | automation | producer policy, decided before the hand-over |
   | Envelope `{ id, type, created, data }` | webhook; `data` built by the producer | no gateway code in webhook |

4. **SQS is a pusher, not a webhook.** It is a last hop behind the endpoint's subscription, batching,
   signature, ladder and ledger, which is main's own design (`destinations/types.ts`: "only the hop
   differs"). It stays a `channels/sqs` channel in the module that owns endpoints. If it earns a
   module later, that module owns the queue credentials and nothing above the hop.
5. **Slack and email are kinds like any other.** `slack` owns connections, claims and sending
   (automation stops calling the Web API); notification already owns mail.
6. **Go.** aigateway sends nothing to customers and should not start: it reports facts to the
   control plane, which the gateway module records and webhook delivers. A Go sender would need the
   ledger, cap and endpoint state that TypeScript owns in Postgres and Redis.
7. **When to revisit (A):** a real cross-kind requirement (an org-wide outbound cap, one delivery
   log across kinds). Then the kinds' ledgers fold into one owner; nothing producers call changes.

## Migration

| # | Move | Unblocks |
| --- | --- | --- |
| 1 | Sender (`http-destination`, classification, dispatch budget, rate limiter, url policy, signature + vectors) moves from egress into `modules/webhook/process`; `findWebhookUrlProblem` and header sanitising move to `webhook-contract`. Automation calls one synchronous `WebhookApi.sendRequest` per attempt; its outbox keeps retry, exactly as today. Webhook writes the ledger row; automation's delivery repository and prune PM are deleted | EG1: egress drops `automation-contract`; the second owner of the ledger goes; AR1's ❓ closes |
| 2 | Egress keeps SSRF + proxy only; README, exports and deps trimmed | a pure framework package |
| 3 | Gateway builds the spend and governance `data`; webhook's `requestGatewayEventDelivery` becomes `requestDelivery` and loses `gateway-contract` | no producer code in webhook |
| 4 | Governance anomaly destinations become webhook destinations; its sleep loop goes | one retry rule, one signer |
| 5 | Slack lands from `feat/intake-6900`; Slack sending moves from automation into `slack` behind `SlackApi.requestDelivery` | Slack is a kind |
| 6 | Automation's HTTP action becomes a webhook destination id (a data migration of trigger configs); `sendRequest` is retired for `requestDelivery` | automation "just uses transports" |

## Parity (main must hold)

| Behaviour on `origin/main` | Kept by |
| --- | --- |
| Endpoints: ladder 1m, 5m, 30m, 2h, 6h, 12h then 12h; 11 attempts (~68h36m); `Retry-After` as a floor | webhook PM backoff |
| Terminal verdict dead-letters at once; failure streak; 72h auto-disable; a disabled endpoint drains without delivering (replay covers the gap) | webhook |
| Per-endpoint stream at org scope: coalescing (`maxBatchSize`, `maxBatchDelayMs`), in-flight cap, 500ms recheck; stable delivery id across retries | webhook |
| Cap 1000/h per scope under `langwatch:ratelimit:webhook-dispatch:<scope>`, project scope for automation, org for endpoints; over cap = retryable until the window resets; test fires exempt | webhook's cap repository, key byte-identical |
| One delivery log table for both channels; responses, never requests; 30-day prune | webhook only |
| Automation: 429/5xx/transport retry, other 4xx terminal (ADR-040); per-trigger email hourly cap claimed once per dispatch | automation outbox, then kinds |
| Slack: 403/404/410 terminal ("revoked"), 429/5xx retry | slack kind |
| Anomaly alerts: best-effort, 5s timeout, `sha256=` signature | kept until step 4; changing the header format is a receiver-visible change |

## Open questions for Alex

1. ~~(B) over (A)?~~ **Ruled:** (B), one `requestDelivery` shape on each kind's token (Alex, 2026-09-30).
2. **Still open. New API operations:** `WebhookApi.sendRequest` (step 1), then `requestDelivery` on
   webhook and slack, and `getDeliveries` filtered by `source`. Approve?
3. **Still open. SQS:** a transport inside the endpoints module, or its own module now? The
   recommended default is the webhook transport, matching Alex's "sqs ... more of a pusher".
4. **Still open. Anomaly signature:** move governance alerts to the standard `t=,v1=` header in
   step 4 (a receiver-visible change), or keep `sha256=` for those destinations?

## Consequences

- `packages/egress` becomes pure framework; the AR1 baseline loses the egress → automation edge.
- Each kind keeps its own dead-letter view through ops' existing outbox redrive; there is no
  cross-kind delivery log until someone needs one.
- Automation loses its HTTP, Slack Web API and ledger code over steps 1, 5 and 6.
