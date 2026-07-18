# ADR-040: Webhook (generic HTTP request) automation channel

**Date:** 2026-07-10

**Status:** Proposed

## Context

Automations today notify through two channels — **Email** (`SEND_EMAIL`) and
**Slack** (`SEND_SLACK_MESSAGE`). Both are `category: "notify"` providers
(`src/automations/providers/`, ADR-037), render a customer-authored Liquid
template (ADR-036), and ride the transactional outbox (ADR-030) on the trace path
and the graph-alert dispatch helper on the alert path (PR #5015 / ADR-034 Ph 8.1).

Customers want to drive their *own* systems off an automation: page PagerDuty,
open a Jira ticket, kick a CI job, push into a warehouse, fan out through an
internal event bus. The ask is a **generic HTTP sender**: on a trace match (or
graph alert), POST (or a configurable method) a customer-defined JSON body to a
customer-supplied URL, with authentication, retries, and a per-fire
deliverability report.

This is the first automation destination where **the customer supplies the
network endpoint**. Every existing outbound goes to infrastructure we or the
customer's SaaS vendor control: SES for email, `hooks.slack.com` for Slack
(host-pinned by `slackWebhookGuard.ts`). A user-supplied URL fired from our
worker fleet is a Server-Side Request Forgery (SSRF) and third-party-DDoS
primitive unless fenced. ADR-030 foreshadowed exactly this work:

> "The moment a customer-defined webhook URL lands as a trigger
> destination, the framework needs SSRF blocking, HMAC request signing,
> payload size caps, per-destination secret encryption at rest. These are
> framework concerns — every future customer-webhook-like dispatch should
> share one outbound utility rather than each `dispatch` reinventing them."
> — ADR-030 Consequences

The framework mostly exists; the job is to *compose* it, not invent it:

- **Provider registry** (`src/automations/providers/types.ts`) — a new channel is
  one directory + three registry lines.
- **SSRF-safe outbound fetch**: `src/utils/ssrfProtection.ts` (`validateUrlForSSRF`
  + `ssrfSafeFetch` + `fetchWithResolvedIp`), with cloud-metadata denylist,
  private-IP blocking, DNS-rebinding defeat via IP pinning, and redirect
  re-validation. Already in production via the HTTP-agent proxy
  (`src/server/api/routers/httpProxy.ts`).
- **HMAC keyed-hash signing** (`src/server/mailer/unsubscribeToken.ts`,
  `triggerNoReply.ts`).
- **Encryption at rest** (`src/utils/encryption.ts`, AES-256-GCM), used by
  `ProjectSecret.encryptedValue` (`prisma/schema.prisma:1035`) and
  `LangyGithubToken.encryptedRefreshToken`.
- **Outbox retry / backoff / dead-letter + operator audit** (`ReactorOutbox`,
  `prisma/schema.prisma:2880`; `src/server/event-sourcing/outbox/dispatcher.ts`).
- **Fire history** (`TriggerSent` + `TriggerFireHistoryService`, in
  `ViewAutomationDrawer.tsx`).

## Decision

Add a third notify provider, **`SEND_WEBHOOK`**, that renders a Liquid JSON body,
delivers it over an SSRF-fenced HTTP client, signs each request with a
per-trigger HMAC secret, rides the existing outbox retry machinery, and records
every delivery attempt in a new `WebhookDelivery` table surfaced in the
automations drawer. Ship it dark behind a `release_webhook_automations` flag.

---

### 1. Provider shape

`SEND_WEBHOOK` is a **`category: "notify"`** provider — it renders customer
content and coalesces into digests like Email/Slack, not a `persist` action. It
slots in as one new directory `src/automations/providers/definitions/webhook/`
with the three standard peers, one registry line each in
`providers/{server,client}.ts`, and one new key in `SliceFor` / `PreviewFor` /
`initialSlices()` (`providers/client.ts:19-33,92-100`).

**Enum + classification (one migration + two set edits):** add `SEND_WEBHOOK` to
`enum TriggerAction` (`prisma/schema.prisma:736`) and to `NOTIFY_TRIGGER_ACTIONS`
(`triggerActionDispatch.ts:35`). The notify∪persist exhaustiveness unit test
forces the classification at introduction.

**`actionParams` schema (`webhook/shared.ts`, Zod → `SharedDef`):**

```
url          string   https:// only, parsed, non-empty host (Zod shape check;
                      real SSRF gate is at dispatch, not save — §4)
method       enum     POST (default) | PUT | PATCH  — no GET/DELETE (notify carries a body)
headers      record   STATIC custom headers. Reserved keys stripped: Host,
                      Content-Length, and the signature/idempotency headers we set (§3,§5).
bodyTemplate string?  Liquid JSON source. NULL = framework default body (§2).
auth         object   { mode: "none"|"bearer"|"api_key"|"basic", ... } — httpProxy union (§3).
signing      object   { enabled: boolean, secretRef: string } — the secret is NOT stored here (§3).
```

**Where the body template lives — decision:** store `bodyTemplate` *inside
`actionParams`*, NOT as a fifth top-level `Trigger` column. The four existing
template columns (`slackTemplate`, `slackTemplateType`, `emailSubjectTemplate`,
`emailBodyTemplate`, `schema.prisma:767-770`) are an email/Slack-specific legacy
shape; a webhook's config is self-contained. *Rejected:* a `webhookBodyTemplate`
top-level column — it adds a nullable column only one action reads, and the render
pipeline takes a source string, not a column. Trade-off accepted: the webhook
template does not appear in the generic `TemplateDraft` (`types.ts:62`) the notify
save path collects — `templatesFromSlice` returns all-null and URL/method/headers/
body flow through `toActionParams`. Note this asymmetry in the provider doc.

**`ConfigForm` (`webhook/client.tsx`):** URL input; method segmented control; a
key/value headers editor (reuse the httpProxy header-row UI); an auth-mode
selector reusing the httpProxy auth union; a "Signing" toggle with generate-secret
+ copy-once reveal (§3); and a `LiquidEditor` for the JSON body (reuse
`~/features/automations/editors/templateAuthoring`, `language:
LIQUID_JSON_LANGUAGE_ID` — the Monaco mode Slack Block Kit uses at
`slack/client.tsx:234`). Slice shape mirrors `SlackSlice` (`slack/client.tsx:49`):
`{ url, method, headers, auth, signing, template: FieldDraft }`.

**Test-fire reuse:** the `NotifyClientDef.channel` union (`types.ts:185`) widens
from `"email" | "slack"` to include `"webhook"`, and `testFireTarget` returns `{
webhook: url }` (Slack already returns this, `slack/client.tsx:92`). The
live-preview endpoint gets a `webhook` branch that renders the body against the
example context and returns the would-be request (method, URL, redacted headers,
rendered JSON) as the `WebhookPreview` envelope. A test fire actually sends
(through the full SSRF-fenced sender) so the author sees a real status code; the
receiver is the customer's own endpoint, so — unlike email test-fire lockdown
(ADR-031 §1) — there is no third-party victim and no lockdown. A non-suppressible
`X-LangWatch-Test-Fire: true` header is injected by the backend (the request
analog of the Slack/email banner, ADR-036).

---

### 2. Payload

The body is a **Liquid JSON template** rendered through the *same* engine and
*same* two contexts as Slack/email — no new templating machinery. It renders like
Slack Block Kit: Liquid → string → `JSON.parse` → send (`renderSlack.ts:140-145`).
A `renderWebhookBody` renderer lives beside `renderSlack.ts` in
`src/shared/templating/` with identical fall-back discipline: a render throw or
`JSON.parse` failure → framework default body, error captured for the operator.

**Two contexts, one template surface** (both built):

- **Trace path:** `TemplateContext` from `buildTemplateContext`
  (`templateContext.ts:447`). Author references `{% for m in matches %}{{
  m.trace.input }}{{ m.trace.url }}...`; a digest sets `matches.length === N`,
  immediate sets 1.
- **Graph-alert path:** `GraphAlertTemplateContext` from
  `buildGraphAlertTemplateContext` (`templateContext.ts:285`). Author references
  `{{ metric.label }} {{ currentValue }} {{ condition.threshold }} {{ sparkline }}`
  — no `matches`; an alert is "metric X crossed threshold Y".

**`| json` filter discipline (load-bearing).** The webhook default body and
operator docs must use `{{ value | json }}` for every interpolated value so trace
input containing `"` or `}` cannot break out of the JSON structure — the JSON
analog of Slack's `mrkdwn_escape` (`engine.ts:63`), which the Block Kit defaults
already lean on (`defaults.ts:111`).

**Default body** (used when `bodyTemplate` is NULL) — a stable, documented
envelope so a receiver integrates without authoring a template. Trace shape:

```json
{
  "event": "trigger.matched",
  "trigger": { "id": {{ trigger.id | json }}, "name": {{ trigger.name | json }} },
  "project": { "slug": {{ project.slug | json }} },
  "digest": { "count": {{ digest.count }} },
  "matches": [ {% for m in matches %}
    { "traceId": {{ m.trace.id | json }}, "url": {{ m.trace.url | json }},
      "input": {{ m.trace.input | json }}, "output": {{ m.trace.output | json }} }{% unless forloop.last %},{% endunless %}
  {% endfor %} ]
}
```

Graph-alert shape carries `metric`/`condition`/`currentValue`/`sparkline` instead
of `matches`. Both live in `defaults.ts` beside `ALERT_TRIGGER_DEFAULTS` /
`DEFAULT_SLACK_*`.

**Content-Type** is `application/json`, set by the sender. Form-encoded / NDJSON
would add a `contentType` param later; v1 is JSON-only.

---

### 3. Authentication

**HMAC-SHA256 request signing (Stripe/GitHub-style), plus optional static auth
headers — both, not either/or.**

**HMAC signature (primary, recommended-on).** Compute `HMAC-SHA256(secret,
"{timestamp}.{rawBody}")` and send:

```
X-LangWatch-Signature: t=1720… ,v1=<hex>
X-LangWatch-Signature-Timestamp: 1720…          (also folded into the signed string)
X-LangWatch-Event-Id: <uuid>                    (== idempotency key, §5)
```

Signing the raw body plus a timestamp lets the receiver recompute the HMAC over
exactly the bytes received and reject stale/replayed requests (recommend ±5-minute
tolerance) — a body-only signature cannot. **Verification recipe** (documented for
the customer): recompute `HMAC_SHA256(secret, timestamp + "." + rawBody)`,
constant-time compare to `v1`, reject if `|now - t| > 300s` — the
`timingSafeEqual` shape in `unsubscribeToken.ts:85-95`.

**Secret — generation, storage, rotation:**

- Generated server-side (`crypto.randomBytes(32).toString("hex")`), shown to the
  operator **once** at creation, never displayed again.
- **Stored encrypted at rest** via `src/utils/encryption.ts` (AES-256-GCM,
  `CREDENTIALS_SECRET`), like `ProjectSecret` (`schema.prisma:1035`) and
  `LangyGithubToken`. **Recommendation: store the ciphertext as a `ProjectSecret`
  row and keep only its `secretRef` in `actionParams.signing`** — the plaintext is
  never in `Trigger.actionParams` JSON. This reuses the per-project secret store +
  RBAC and keeps secrets discoverable/rotatable in one place. *Rejected:* a raw
  `signing.secret` on `actionParams` — that JSON is read into the UI and logged in
  several places; a `ProjectSecret` ref is cleaner and already governed.
- **Rotation:** support two active secrets during a rotation window (sign with the
  new, receiver may still validate the old). v1 can ship single-secret with a
  "regenerate" button (breaks the receiver until they update); dual-key is a fast
  follow.

**Optional static auth headers (secondary).** Mirror the httpProxy auth union
(`httpProxy.ts:59-119`): `none | bearer | api_key | basic`, populating
`Authorization: Bearer …` / a custom API-key header / `Authorization: Basic …`.
The token/password is stored the same encrypted way (ProjectSecret ref), never in
plain `actionParams`. Many receivers (internal gateways) authenticate on a static
bearer, not HMAC; offering both covers "verify it's really LangWatch and
unmodified" (HMAC) and "let it through our gateway" (bearer).

**Rejected alternatives:**

- **mTLS.** Strongest transport auth, but requires per-trigger client-cert
  provisioning, private-key storage, and cert-rotation UX — a large v1 surface,
  and most receivers do not terminate mTLS. HMAC gives payload integrity +
  authenticity without a PKI. Revisit for enterprise if asked.
- **OAuth 2.0 client-credentials.** Would require a token-fetch leg (token
  endpoint, client id/secret, caching, refresh) before every dispatch — more
  moving parts and another outbound call to fence. A static bearer covers the
  common "our gateway wants a token" case; full OAuth is deferred.

---

### 4. SSRF & abuse protection (the critical section)

Outbound HTTP to a user-supplied URL from our worker fleet is the highest-risk
part of this ADR. **The SSRF-safe utility `src/utils/ssrfProtection.ts` MUST be
the only path webhook dispatch uses** — do not hand-roll a `fetch`. The sender
calls `validateUrlForSSRF(url)` then `fetchWithResolvedIp(validated, …)` (or the
atomic `ssrfSafeFetch`), the primitive `httpProxy.ts:187` already ships to prod.

**Attack surface (✓ = already in `ssrfProtection.ts`; ✗ = gap this ADR closes):**

| Attack | Defense | Status |
|---|---|---|
| Cloud metadata (`169.254.169.254`, `fd00:ec2::254`, ECS `169.254.170.2`, `metadata`) | Always-on denylist `BLOCKED_METADATA_HOSTS` (`ssrfConstants.ts:63`), toggle-independent | ✓ |
| Cloud internal domains (`.amazonaws.com`, `.compute.internal`, `.internal`, `.local`) | `BLOCKED_CLOUD_DOMAINS` suffix match (`ssrfConstants.ts:45`) | ✓ |
| localhost / loopback (`127.0.0.0/8`, `::1`) | `isPrivateOrLocalhostIP` (`ssrfProtection.ts:222`) | ✓ (gated) |
| RFC1918 private (`10/8`, `172.16/12`, `192.168/16`) | `isPrivateIPv4` (`ssrfProtection.ts:205`) | ✓ (gated) |
| Link-local (`169.254/16`, `fe80::/10`) + IPv4-mapped IPv6 (`::ffff:…`) | `isPrivateIPv4` + `isPrivateOrLocalhostIP` (`ssrfProtection.ts:217,230`) | ✓ (gated) |
| **DNS rebinding (TOCTOU)** | Resolve once, **pin the connection to the validated IP** via a custom undici `Agent.lookup` (`createIpPinningAgent`, `ssrfProtection.ts:543`) | ✓ |
| Redirect → internal | `redirect: "manual"`, re-validate every `Location`, cap at `MAX_REDIRECTS = 10` (`ssrfProtection.ts:607-642`) | ✓ |
| Non-HTTP schemes (`file:`, `gopher:`, `ftp:`) | Scheme allowlist `http:`/`https:` (`ssrfProtection.ts:396`); webhook narrows to **https only** at Zod | ✓ (+ tighten) |
| Huge response body | Cap bytes read (stream + abort past N KB) | ✗ **gap** |
| Slowloris / hung connection | Total-request + connect timeout | ✗ **gap** |
| Non-standard ports (`:22`, `:6379`) | Port allowlist (443, 80 only if https relaxed) | ✗ **gap** |
| Third-party DDoS (we amplify) | Per-project rate limit + global concurrency cap + honor 429/Retry-After (§5) | ✗ **gap** |

**Gaps this ADR closes (the delta over `ssrfProtection.ts`):**

1. **Force private-IP blocking ON for webhooks in SaaS.** Private-IP/localhost
   blocking is gated on `BLOCK_LOCAL_HTTP_CALLS` (`ssrfProtection.ts:515`) — *off*
   by default so on-prem/dev can reach internal services. Webhook dispatch must
   not inherit that: build a dedicated validator via `createSSRFValidator({
   blockLocal: true, allowedHosts: [] })` (`ssrfProtection.ts:385`) so a customer
   URL can never reach `10.x`/`localhost` regardless of the global toggle.
   (Self-hosted deployments may relax it for their own trusted endpoints — same
   knob — but the SaaS default is hard-on.) **https-only:** reject `http:` at Zod.
2. **Response-size cap.** Stream and abort once the body exceeds a cap (recommend
   64 KB — we only store a snippet, §6). Prevents a gigabyte response exhausting a
   worker.
3. **Timeouts.** A connect timeout (~5 s) and total-request timeout (~10 s) via
   `AbortSignal.timeout`, so a slowloris endpoint can't pin a worker slot.
   (`ssrfSafeFetch` has neither today — thread it through the undici `Agent`/fetch.)
4. **Port restriction.** Reject any port other than 443 (80 only if a self-hosted
   operator relaxes https-only). Blocks `https://internal:6379` probes even when
   the host resolves public.

**Anti-DDoS-of-third-parties (we must not become an amplifier):**

- **Per-project rate limit** via the existing fixed-window `src/server/rateLimit.ts`
  (the limiter ADR-031 uses for test fire), keyed
  `webhook-dispatch:{projectId}:{hourBucket}`. Backstops an immediate-cadence
  trigger firing per-match.
- **Respect receiver backpressure:** on `429`, honor `Retry-After`; parse draft
  `RateLimit-*` headers when present and back off proactively (§5).
- **Global concurrency cap.** Sends inherit the outbox GroupQueue's per-tenant
  fairness (`TenantRateTracker`) and global worker concurrency, plus a
  webhook-specific in-flight semaphore so one project's slow endpoint can't consume
  the whole worker pool waiting on 10-second timeouts.

**Where the sender lives:** a single reusable module
`src/server/triggers/sendWebhook.ts` (sibling to `sendSlackWebhook.ts`), wrapping
`ssrfProtection` + signing + size/timeout caps + `DispatchError` classification
(`toDispatchError`, `sendSlackWebhook.ts:143`). This is the "one outbound utility
every future customer-webhook dispatch shares" ADR-030 asked for.

---

### 5. Retries & backoff

**Ride the existing `ReactorOutbox` / GroupQueue retry machinery for durability +
scheduling; record each HTTP attempt as a `WebhookDelivery` row (§6); do NOT
hand-roll a second attempt loop.** The outbox already gives exponential backoff,
`maxAttempts` (default 8, `schema.prisma:2900`), `nextAttemptAt`, dead-letter
(`status: dead`), and an operator surface — reusing it is strictly less code and
one operational story. The sender throws the typed `DispatchError` (ADR-027) with
`retryable` set per the HTTP outcome; the queue handles backoff and
`PgOutboxAuditAdapter` mirrors dispatch-level state to `ReactorOutbox`. The
per-attempt HTTP detail (status, snippet, latency) the outbox doesn't model is
written into `WebhookDelivery`.

**Retry vs terminal classification:**

| HTTP outcome | Class |
|---|---|
| Timeout / connection error / DNS failure | retryable |
| `5xx` | retryable |
| `429` | retryable — **honor `Retry-After`** |
| `408 Request Timeout` | retryable |
| `2xx` | success (terminal) |
| `3xx` | followed + re-validated by the SSRF layer; a redirect loop → terminal error |
| other `4xx` (`400`,`401`,`403`,`404`,`422`, …) | **terminal, non-retryable** — malformed/unauthorized/gone; retrying spams a broken config |

**Honoring `Retry-After` inside outbox backoff.** The GroupQueue backoff is
schedule-driven, so a raw `DispatchError` cannot say "come back in 90 s". Extend
`DispatchError` with an optional `retryAfterMs` hint and have the cadence
dispatcher pass it to the queue re-enqueue delay (`enqueueCadence({ delayMs })`,
`dispatcher.ts:103`). For small values (≤ a few seconds) the sender may instead do
a single bounded in-attempt wait; for larger values, reschedule. If threading
`retryAfterMs` proves invasive, v1 ships with the outbox's default exponential
backoff + jitter and treats `Retry-After` as advisory-logged-only — a known v1
limitation, not silently dropped.

**Backoff shape:** exponential with jitter (GroupQueue default), capped
`maxAttempts` (reuse 8, or a lower webhook-specific 5 — a broken endpoint
shouldn't retry for hours). After the last attempt the dispatch dead-letters,
visible in the drawer.

**Idempotency.** Every logical dispatch carries a stable `X-LangWatch-Event-Id` (a
UUID from the dispatch dedup identity, the `dispatchDigest` shape the email path
computes at `dispatcher.ts:557`). All retries reuse the same id so a receiver can
dedupe — the request-level analog of the internal `TriggerSent` at-most-once claim
(`dispatcher.ts:451,772`).

---

### 6. Deliverability report / delivery log

**A new per-attempt table `WebhookDelivery`.** `ReactorOutbox` is one row per
*dispatch* and its `renderDiagnostics` blob (`schema.prisma:2910`) is
render-health, not delivery detail — it cannot express "attempt 3 got a 502 after
1.2 s". `TriggerSent` is the match-claim ledger. A webhook's value proposition *is*
the deliverability report (every retry, status, body, latency), so it earns its
own table.

```prisma
model WebhookDelivery {
  id              String   @id @default(nanoid())
  projectId       String                    // multitenancy: every query filters on this
  project         Project  @relation(fields: [projectId], references: [id])
  triggerId       String
  trigger         Trigger  @relation(fields: [triggerId], references: [id])
  dispatchId      String                    // groups all attempts of one logical fire (== eventId)
  attempt         Int                        // 1-based
  requestMethod   String
  requestUrl      String                     // stored as-is (no secret in a URL by policy)
  requestHeaders  Json                       // REDACTED: signature/auth/api-key values → "***"
  responseStatus  Int?                       // null when no response (timeout/DNS)
  responseBody    String?                    // size-capped snippet (≤ 4 KB)
  latencyMs       Int?
  error           String?                    // transport/SSRF/timeout message when no HTTP response
  outcome         WebhookDeliveryOutcome     // success | retryable | terminal | pending
  firedAt         DateTime @default(now())
  createdAt       DateTime @default(now())

  @@index([projectId, triggerId, dispatchId])
  @@index([projectId, triggerId, firedAt])
}

enum WebhookDeliveryOutcome { success  retryable  terminal  pending }
```

- **Redaction (mandatory).** `requestHeaders` stores signature, `Authorization`,
  and api-key header values masked to `***` — which headers were sent, never the
  secret material (same as `createAgentTestTrace`'s sanitization in `httpProxy.ts`).
- **Response-body sensitivity.** The snippet is the *customer's own endpoint's*
  response, not LangWatch data — but it still lands in control-plane Postgres, so
  cap it hard (≤ 4 KB), truncate with an ellipsis, and document retention. It lets
  an operator see "the receiver said `{"error":"bad schema"}`" without re-firing.
- **Retention / pruning.** Postgres is outside the ClickHouse retention sweep, so
  `WebhookDelivery` needs its own prune — a scheduled delete of rows older than 30
  days (align with the ADR-030 `dispatched` window). Note it alongside the
  `LangyConversation` PII-purge concern so it isn't forgotten.
- **Rendering.** Extend the drawer's "Recent fires" panel (`ViewAutomationDrawer.tsx`,
  backed by `TriggerFireHistoryService.getAllRecentFiresForTrigger`) so a webhook
  fire row expands into its attempts: a status-code chip per attempt (green 2xx /
  amber 429 / red 5xx / grey timeout), latency, and a reveal for the redacted
  request + response snippet. Keep the read path as a new method on
  `TriggerFireHistoryService` (or a sibling `WebhookDeliveryService`) →
  repository, never raw Prisma in the route (layering rule). The list still keys
  "last fired / fires in 30 days" off `TriggerSent`; `WebhookDelivery` is the
  drill-down.

---

### 7. Migration & rollout

- **Prisma enum addition:** `SEND_WEBHOOK` on `TriggerAction` — additive, no
  backfill; a fresh migration (immutable-migration rule).
- **New table migration:** `WebhookDelivery` + `WebhookDeliveryOutcome` enum, all
  indexes leading with `projectId`.
- **Feature-flag gating:** add `release_webhook_automations` to `FEATURE_FLAGS`
  (`src/server/featureFlag/registry.ts:118`), `scope: "PRODUCT"`, `defaultValue:
  false` — mirroring `release_langy_enabled`. Gate the type-picker appearance
  (client) *and* the dispatch/route accepting `SEND_WEBHOOK` (server); staff/dev
  force it via `FEATURE_FLAG_FORCE_ENABLE=release_webhook_automations`.
- **Cron parity vs outbox-only.** The trace and graph-alert paths fire from the
  outbox / `dispatchGraphAlertAction` when their firing flags are on, and from the
  K8s cron (`src/pages/api/cron/triggers/actions/`) when off — email and Slack each
  have both. **Add a cron `actions/sendWebhook.ts` (parity with
  `sendSlackMessage.ts`)**, the third branch to the outbox notify switch
  (`dispatcher.ts:532`), and the branch to `dispatchGraphAlertAction`
  (`graphAlertActionDispatch.ts:181` — it dead-letters any non-email/Slack action
  at `:241`, so this is a required edit). Both paths call the one `sendWebhook.ts`.
  If webhooks ship strictly after graph/trace firing has cut over to the outbox for
  GA projects, the cron action can be a thin follow-up — but the graph-alert
  dead-letter branch must be handled regardless.
- **Backfill:** none.

---

### 8. Effort estimate & phasing

Roughly **M–L**. The heavy lifting (SSRF utility, templating, outbox retry,
encryption, fire-history) exists; this is composition plus one new subsystem (the
delivery log) and four SSRF hardening deltas.

- **Phase 1 — Provider + config UI (S).** New `definitions/webhook/`
  (shared/client/server), enum migration, `NOTIFY_TRIGGER_ACTIONS` entry,
  ConfigForm, Zod schema, live-preview branch, `channel` union widening. Behind
  the flag, no real sends. Reuses Slack's client shape almost wholesale.
- **Phase 2 — SSRF-safe sender + dispatch (M, riskiest).** `sendWebhook.ts`
  wrapping `ssrfProtection` with the four hardening deltas + signing + auth headers
  + `DispatchError` classification. Wire into the outbox notify switch, the
  graph-alert dispatch branch, and (parity) the cron action. `renderWebhookBody` +
  default bodies in `defaults.ts`.
- **Phase 3 — Retries & idempotency (S).** Classification table (§5), `Retry-After`
  handling (extend `DispatchError.retryAfterMs`), the stable `X-LangWatch-Event-Id`,
  per-project rate limit.
- **Phase 4 — Delivery log + report UI (M).** `WebhookDelivery` table +
  service/repository, sender writes a redacted row per attempt, prune job, and the
  expandable attempts view in `ViewAutomationDrawer`.

**Riskiest part: SSRF (Phase 2).** A single missed vector (rebinding bypass,
redirect-to-metadata, un-capped port) turns our worker fleet into an attacker's
proxy into our VPC. The mitigation is discipline: **route 100% of webhook traffic
through the audited `ssrfProtection.ts`**, add the four deltas as thin wrappers,
and cover each row of the §4 attack table with an executed test (not a string
assertion) — including a DNS-rebinding test and a redirect-to-`169.254.169.254`
test that observe the block, per the repo's "regression test must execute the code
path" rule.

## Rationale / Trade-offs

- **Why a notify provider, not a new `action` class.** A webhook renders customer
  content and benefits from digest coalescing exactly like email/Slack, so it
  inherits the settle→cadence outbox timing, the template pipeline, and the
  test-fire path for free. A bespoke class would fork all three.
- **Why reuse `ssrfProtection.ts`.** It already implements the hard parts
  (IP-pinning against rebinding, redirect re-validation, metadata denylist) and is
  battle-tested in `httpProxy.ts`. Forking it would double the surface where an
  SSRF bug can hide; the webhook-specific concerns (force-block-local, https-only,
  size/timeout/port caps) are thin, composable deltas.
- **Why HMAC over body + timestamp, not body alone.** Body-only signatures are
  replayable; the timestamp gives the receiver a cheap replay window without us
  holding receiver state, and matches what Stripe/GitHub consumers already verify.
- **Why a dedicated `WebhookDelivery` table.** `ReactorOutbox` is dispatch-grain
  and audit-owned; `TriggerSent` is the claim ledger. Per-attempt HTTP forensics
  is a genuinely new grain and the feature's headline value — it earns a table, not
  a JSON blob on an existing row.
- **What we compromise.** More Postgres write volume (one row per attempt) and a
  new prune job; a fifth notify-ish shape the drawer must render; and a small
  asymmetry (webhook's template lives in `actionParams`, not a `Trigger` column) a
  reader must be told about. All judged worth it against a thinner delivery story
  customers would immediately ask us to deepen.

## Consequences

- **One new provider directory, one enum value, one `NOTIFY_TRIGGER_ACTIONS`
  entry** — minimal blast radius; the notify/persist exhaustiveness test forces
  classification at introduction.
- **One shared outbound utility (`sendWebhook.ts`)** becomes the home every future
  customer-endpoint dispatch reuses — the ADR-030 ask, discharged.
- **`ssrfProtection.ts` grows a webhook-tuned validator config and (ideally)
  response-size + timeout + port options** usable by other callers (`httpProxy.ts`
  too).
- **New `WebhookDelivery` table + prune job** in control-plane Postgres, holding
  redacted headers and size-capped response snippets, 30-day retention.
- **`dispatchGraphAlertAction` must stop dead-lettering webhook**
  (`graphAlertActionDispatch.ts:241`) — a required edit, since graph alerts now
  have a third valid channel.
- **`DispatchError` may gain a `retryAfterMs` hint** so outbox backoff can honor
  receiver `Retry-After` — a small ADR-027 contract extension.
- **Shipped dark behind `release_webhook_automations`**; GA is a later PostHog
  rollout + default flip.
- **Deferred to fast-follow:** OAuth client-credentials, mTLS, dual-secret rotation,
  non-JSON content types, and a receiver-side "verify signature" doc snippet.

## Amendment: what PR #5807 shipped vs deferred (2026-07)

The first implementation PR (#5807, "Phases 1–3") lands the provider, the
SSRF-fenced sender, dispatch on all three paths, the retry/terminal
classification, and per-fire idempotency on the graph-alert path. Two
deliberate deltas against the text above:

- **Header secrets ship encrypted, but as headers — not the §3 auth union.**
  Instead of the auth-mode selector + `ProjectSecret` ref, v1 keeps the plain
  key/value headers editor and applies the secrecy discipline directly:
  values are AES-256-GCM encrypted into `actionParams.headersEncrypted`
  (`definitions/webhook/secret.ts`, same `encrypt`/`decrypt` as the Slack bot
  token), never returned to the client (reads echo names with a
  `__kept__` sentinel), and decrypted just before dispatch. The
  `ProjectSecret`-ref auth union remains the target shape for when HMAC
  signing lands.
- **Graph alerts no longer dead-letter `SEND_WEBHOOK`** — the third notify
  branch in `dispatchGraphAlertAction`, gated per-fire on the endpoint
  identity. On the cron parity path, a terminal failure CONSUMES the fire
  (no per-tick re-post to a misconfigured endpoint); only retryable failures
  leave it open for the next tick.

**Phase 3 completed in a follow-up (also #5807):** `Retry-After` →
`DispatchError.retryAfterMs` (parsed delta-seconds + HTTP-date, capped at 1h;
honored by the GroupQueue as a backoff FLOOR); the stable `X-LangWatch-Event-Id`
(trace path from the batch's traceIds, graph-alert path from the fire digest —
identical across retries so receivers dedupe); and a per-project hourly
dispatch cap (`webhook-dispatch:{projectId}`).

**Phase 4 shipped as a standalone table (§6).** `WebhookDelivery` + a
`WebhookDeliveryOutcome` enum, one row per attempt written by `deliverWebhook`
(send + classify + log as a unit), redacted headers (`redactHeadersForLog`
masks auth/signature values to `***`), a `getWebhookDeliveries` read procedure,
the drawer's "Recent deliveries" drill-down, and a 30-day prune cron
(`/api/cron/webhook_delivery_cleanup`).

> **Known design debt / future direction.** `WebhookDelivery` is a
> webhook-only, append-per-attempt log that sits *alongside* `ReactorOutbox`
> (the generic delivery engine — one *mutable* row per dispatch, `lastError`
> only) and `TriggerSent` (the idempotency/incident claim). The three answer
> different questions today, but the deliverability report arguably belongs
> *in* the outbox's audit mechanism (which already fires an `onFailed({ attempt,
> willRetry })` hook per attempt) so every channel gets delivery history, not
> just webhooks. Deferred deliberately: revisit unifying the per-attempt log
> into the outbox rather than growing a parallel table.

**Still deferred:** HMAC request signing (§3, including the signing toggle UI)
and the `ProjectSecret`-ref auth union — the only remaining Phase 2 gap.

> **Note (2026-07):** the "cron parity" webhook action this ADR's migration
> plan describes (§7, `pages/api/cron/triggers/actions/sendWebhookRequest.ts`)
> was removed shortly after, when the K8s graph-alert cron itself was retired
> (ADR-034 — the event-sourced path is now the sole graph-alert path). Webhook
> dispatch rides only the outbox + `dispatchGraphAlertAction` now; the
> planning references to a cron action above are historical.

## References

- [ADR-030](./030-transactional-outbox-for-stake-sensitive-dispatch.md) —
  transactional outbox this dispatch rides; its Consequences foreshadow this
  webhook work (SSRF, HMAC, size caps, secret encryption).
- [ADR-036](./036-liquid-templates-for-trigger-notifications.md) — Liquid engine +
  `matches[]` contract the JSON body renders against.
- [ADR-037](./037-automation-operator-surfaces.md) — the authoring drawer /
  fire-history surface the delivery report extends.
- [ADR-031](./031-trigger-email-abuse-protections.md) — the abuse-cap pattern
  (`rateLimit.ts`, per-project caps) the webhook rate limit mirrors; its Slack
  exemption reasoning informs why webhook still needs SSRF.
- [ADR-027](./027-typed-dispatcherror-contract.md) — `DispatchError` contract the
  sender throws (and would extend with `retryAfterMs`).
- [ADR-034](./034-event-sourced-analytics-materialization.md) / **PR #5015**
  (`feat(automations): graph alerts in automations drawer + Liquid template
  wiring`) — the graph-alert dispatch path this channel plugs a third branch into.
- `src/utils/ssrfProtection.ts` / `src/utils/ssrfConstants.ts` — the
  outbound-fetch guard webhook dispatch reuses.
- `src/server/api/routers/httpProxy.ts` — existing SSRF-fenced HTTP client with the
  auth union this provider mirrors.
- `src/utils/encryption.ts` + `ProjectSecret` (`prisma/schema.prisma:1035`) —
  encryption-at-rest pattern for the HMAC secret and auth tokens.
- `src/server/mailer/unsubscribeToken.ts` / `triggerNoReply.ts` — HMAC keyed-hash +
  `timingSafeEqual` pattern the signature follows.
- `src/automations/providers/` — the registry (`types.ts`, `client.ts`,
  `server.ts`) and the Slack definition the webhook provider is shaped after.
