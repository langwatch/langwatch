# ADR-040: Webhook (generic HTTP request) automation channel

**Date:** 2026-07-10

**Status:** Proposed

## Context

Automations today notify through exactly two channels — **Email**
(`SEND_EMAIL`) and **Slack** (`SEND_SLACK_MESSAGE`). Both are `category:
"notify"` providers under the provider registry
(`src/automations/providers/`, ADR-037), both render a customer-authored
Liquid template (ADR-036), and both ride the transactional outbox
(ADR-030) on the trace path and the graph-alert dispatch helper on the
alert path (PR #5015 / ADR-034 Ph 8.1).

Customers routinely ask to drive their *own* systems off a LangWatch
automation: page PagerDuty, open a Jira ticket, kick a CI job, push into a
customer data warehouse, or fan out through their internal event bus. None
of that fits Email or Slack. The ask is a **generic HTTP sender**: when a
trace matches (or a graph alert fires), POST (or a configurable method) a
customer-defined JSON body to a customer-supplied URL, with authentication,
retries, and a per-fire deliverability report the operator can inspect.

This is the first automation destination where **the customer supplies the
network endpoint**. Every existing outbound is to infrastructure we or the
customer's SaaS vendor control: SES for email, `hooks.slack.com` for Slack
(host-pinned by `slackWebhookGuard.ts`). A user-supplied URL fired from our
worker fleet is a Server-Side Request Forgery (SSRF) primitive and a
third-party-DDoS primitive unless it is fenced. ADR-030 already
foreshadowed this exact work:

> "The moment a customer-defined webhook URL lands as a trigger
> destination, the framework needs SSRF blocking, HMAC request signing,
> payload size caps, per-destination secret encryption at rest. These are
> framework concerns — every future customer-webhook-like dispatch should
> share one outbound utility rather than each `dispatch` reinventing them."
> — ADR-030 Consequences, `030-transactional-outbox-...md`

The good news: the framework this ADR needs mostly already exists. This
document's job is to *compose* it, not invent it. Specifically:

- **Provider registry** (`src/automations/providers/types.ts`) already
  models a new channel as one directory + three registry lines.
- **SSRF-safe outbound fetch** already exists as a reusable utility:
  `src/utils/ssrfProtection.ts` (`validateUrlForSSRF` + `ssrfSafeFetch` +
  `fetchWithResolvedIp`), with cloud-metadata denylist, private-IP
  blocking, DNS-rebinding defeat via IP pinning, and redirect
  re-validation. It is already consumed in production by the HTTP-agent
  proxy (`src/server/api/routers/httpProxy.ts`).
- **HMAC keyed-hash signing** already exists as a pattern
  (`src/server/mailer/unsubscribeToken.ts`,
  `src/server/mailer/triggerNoReply.ts`).
- **Encryption at rest** already exists (`src/utils/encryption.ts`,
  AES-256-GCM) and is used by `ProjectSecret.encryptedValue`
  (`prisma/schema.prisma:1035`) and `LangyGithubToken.encryptedRefreshToken`.
- **Outbox retry / backoff / dead-letter + operator audit** already exists
  (`ReactorOutbox`, `prisma/schema.prisma:2880`; dispatcher at
  `src/server/event-sourcing/outbox/dispatcher.ts`).
- **Fire history** already exists (`TriggerSent` +
  `TriggerFireHistoryService`, surfaced in `ViewAutomationDrawer.tsx`).

## Decision

Add a third notify provider, **`SEND_WEBHOOK`**, that renders a Liquid JSON
body and delivers it over an SSRF-fenced HTTP client, signs each request
with a per-trigger HMAC secret, rides the existing outbox retry machinery,
and records every delivery attempt in a new `WebhookDelivery` table
surfaced in the automations drawer. Ship it dark behind a
`release_webhook_automations` PostHog/registry flag.

---

### 1. Provider shape

`SEND_WEBHOOK` is a **`category: "notify"`** provider (it renders customer
content and coalesces into digests, exactly like Email/Slack — not a
`persist` action). It slots into the registry as one new directory
`src/automations/providers/definitions/webhook/` with the standard three
peers, registered by one line each in
`src/automations/providers/{server,client}.ts` and one new key in
`SliceFor` / `PreviewFor` / `initialSlices()`
(`src/automations/providers/client.ts:19-33,92-100`).

**Enum + classification (one migration + two set edits):**

- Add `SEND_WEBHOOK` to `enum TriggerAction`
  (`prisma/schema.prisma:736`).
- Add it to `NOTIFY_TRIGGER_ACTIONS`
  (`src/server/event-sourcing/pipelines/shared/triggerActionDispatch.ts:35`).
  The exhaustiveness unit test that guards notify ∪ persist = all actions
  forces this at introduction time — good.

**`actionParams` schema (`webhook/shared.ts`, Zod → `SharedDef`):**

```
url          string   https:// only, parsed, non-empty host (Zod-level shape check;
                      the real SSRF gate is at dispatch, not save — see §4)
method       enum     POST (default) | PUT | PATCH  — no GET/DELETE (a notify
                      dispatch always carries a body)
headers      record   Map<string,string> of STATIC custom headers (e.g.
                      "X-Env":"prod"). Reserved/forbidden keys stripped:
                      Host, Content-Length, and the signature/idempotency
                      headers we set ourselves (§3, §5).
bodyTemplate string?  Liquid JSON source. NULL = framework default body (§2).
auth         object   { mode: "none" | "bearer" | "api_key" | "basic", ... }
                      mirroring httpProxy.ts's auth union (§3).
signing      object   { enabled: boolean, secretRef: string }  — HMAC config;
                      the secret itself is NOT stored here (§3).
```

**Where the body template lives — decision:** store `bodyTemplate` *inside
`actionParams`*, NOT as a fifth top-level `Trigger` column. The four
existing template columns (`slackTemplate`, `slackTemplateType`,
`emailSubjectTemplate`, `emailBodyTemplate`, `prisma/schema.prisma:767-770`)
are an email/Slack-specific legacy shape; a webhook's config is
self-contained and belongs in its own JSON. *Rejected alternative:* a
`webhookBodyTemplate` top-level column — it repeats the ADR-036 pattern but
adds a nullable column only one action ever reads, and the templating
render pipeline does not require the template to be a column (it takes a
source string). Trade-off accepted: webhook's template does not appear in
the generic `TemplateDraft` (`types.ts:62`) the notify save path collects;
`templatesFromSlice` returns all-null and the URL/method/headers/body all
flow through `toActionParams`. Note this asymmetry in the provider doc.

**`ConfigForm` fields (`webhook/client.tsx`):** URL input; method segmented
control; a key/value headers editor (reuse the httpProxy header-row UI
pattern); an auth-mode selector reusing the httpProxy auth union; a
"Signing" toggle with a generate-secret button and a copy-once reveal (§3);
and a `LiquidEditor` for the JSON body (reuse
`~/features/automations/editors/templateAuthoring`, `language:
LIQUID_JSON_LANGUAGE_ID` — the same custom Monaco mode Slack Block Kit uses
at `slack/client.tsx:234` so authors get JSON + Liquid tokenization). Slice
shape mirrors `SlackSlice` (`slack/client.tsx:49`): `{ url, method, headers,
auth, signing, template: FieldDraft }`.

**`testFireTarget` + test-fire pipeline reuse:** the `NotifyClientDef.channel`
union (`types.ts:185`) widens from `"email" | "slack"` to include
`"webhook"`, and `testFireTarget` returns `{ webhook: url }` (Slack already
returns exactly this shape, `slack/client.tsx:92`). Test fire reuses the
same notify preview/test-fire path email and Slack use — the live-preview
endpoint gets a `webhook` branch that renders the body template against the
example context and returns the would-be request (method, URL, redacted
headers, rendered JSON body) as the `WebhookPreview` envelope. A test fire
actually sends (through the full SSRF-fenced sender) so the author sees a
real status code; the receiver is the customer's own endpoint, so — unlike
email test-fire lockdown (ADR-031 §1) — there is no third-party victim and
no lockdown needed. A **non-suppressible test-fire header** (`X-LangWatch-
Test-Fire: true`) is injected by the backend (the request analog of the
Slack/email banner, ADR-036 test-fire banner).

---

### 2. Payload

The body is a **Liquid JSON template** rendered through the *same* engine
and *same* two contexts as Slack/email — no new templating machinery. It
renders exactly like Slack Block Kit does today: Liquid → string →
`JSON.parse` → send (`renderSlack.ts:140-145`). A JSON-body renderer
`renderWebhookBody` lives beside `renderSlack.ts` in
`src/shared/templating/` and follows the identical fall-back-to-default
discipline: render throw or `JSON.parse` failure → framework default body,
error captured for the operator surface.

**Two contexts, one template surface** (both already built):

- **Trace path:** `TemplateContext` from `buildTemplateContext`
  (`templateContext.ts:447`). The author references
  `{% for m in matches %}{{ m.trace.input }}{{ m.trace.url }}...`; a digest
  sets `matches.length === N`, immediate sets 1 (ADR-036 collapses both).
- **Graph-alert path:** `GraphAlertTemplateContext` from
  `buildGraphAlertTemplateContext` (`templateContext.ts:285`). The author
  references `{{ metric.label }} {{ currentValue }} {{ condition.threshold }}
  {{ sparkline }} {% for p in history %}...`. No `matches` array — an alert
  is "metric X crossed threshold Y" (`templateContext.ts:119`).

**`| json` filter discipline (load-bearing).** liquidjs ships a built-in
`json` filter; the Slack Block Kit defaults already lean on it to safely
embed user-controlled strings into a JSON document
(`defaults.ts:111` — `{{ trigger.name | ... | json }}`). The webhook
default body and the operator docs must use `{{ value | json }}` for every
interpolated value so trace input containing `"` or `}` cannot break out of
the JSON structure. This is the JSON analog of Slack's `mrkdwn_escape`
filter (`engine.ts:63`).

**Default body** (used when `bodyTemplate` is NULL) — a stable, documented
envelope so a receiver can integrate without the author writing any
template. Trace shape:

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

Graph-alert shape carries `metric`/`condition`/`currentValue`/`sparkline`
instead of `matches`. Both defaults live in `defaults.ts` beside the
existing `ALERT_TRIGGER_DEFAULTS` / `DEFAULT_SLACK_*`.

**Content-Type** is `application/json` and is set by the sender, not the
header map (a webhook always ships a JSON body here). If a future customer
needs form-encoded or NDJSON we add a `contentType` param then; v1 is
JSON-only.

---

### 3. Authentication

**Recommendation: HMAC-SHA256 request signing (Stripe/GitHub-style),
plus optional static auth headers.** Both, not either/or.

**HMAC signature (primary, recommended-on).** For each request we compute
`HMAC-SHA256(secret, "{timestamp}.{rawBody}")` and send:

```
X-LangWatch-Signature: t=1720… ,v1=<hex>
X-LangWatch-Signature-Timestamp: 1720…          (also folded into the signed string)
X-LangWatch-Event-Id: <uuid>                    (== idempotency key, §5)
```

- **Signed material is the raw request body plus a timestamp**, so the
  receiver recomputes the HMAC over exactly the bytes it received and
  compares in constant time. Folding the timestamp into the signed string
  and publishing it lets the receiver reject stale/replayed requests
  (recommend a ±5-minute tolerance), which a body-only signature cannot.
- **Verification recipe** (documented for the customer): recompute
  `HMAC_SHA256(secret, timestamp + "." + rawBody)`, constant-time compare
  to `v1`, and reject if `|now - t| > 300s`. This is the exact
  `timingSafeEqual` shape already in `unsubscribeToken.ts:85-95`.

**Secret generation, storage, rotation:**

- Generated server-side on demand (`crypto.randomBytes(32).toString("hex")`),
  shown to the operator **once** at creation (copy-to-clipboard), never
  displayed again — the receiver stores its own copy.
- **Stored encrypted at rest.** Reuse `src/utils/encryption.ts`
  (AES-256-GCM, `CREDENTIALS_SECRET`), exactly like `ProjectSecret`
  (`prisma/schema.prisma:1035`) and `LangyGithubToken`. **Recommendation:
  store the ciphertext as a `ProjectSecret` row and keep only its
  `secretRef` (the `ProjectSecret.name`) in `actionParams.signing` — the
  secret plaintext is never in the `Trigger.actionParams` JSON.** This
  reuses the existing per-project secret store and its RBAC, and keeps
  webhook secrets discoverable/rotatable in one place rather than buried in
  trigger JSON. *Rejected:* a raw `signing.secret` string on
  `actionParams` — `actionParams` is read back into the UI and logged in
  several places; an encrypted blob inline is workable but a `ProjectSecret`
  ref is cleaner and already governed.
- **Rotation:** support two active secrets per trigger during a rotation
  window (sign with the new, receiver may still be validating the old) —
  same dual-key idea the receiver runs. v1 can ship single-secret with a
  "regenerate" button (breaks the receiver until they update); dual-key is
  a fast follow if customers ask.

**Optional static auth headers (secondary).** Mirror the httpProxy auth
union exactly (`httpProxy.ts:59-119`): `none | bearer | api_key | basic`.
These populate `Authorization: Bearer …` / a custom API-key header /
`Authorization: Basic …`. The token/password is a secret and is stored the
same encrypted way as the HMAC secret (ProjectSecret ref), never in plain
`actionParams`. Many receivers (internal gateways) authenticate on a static
bearer, not an HMAC; offering both means we cover "verify it's really
LangWatch and unmodified" (HMAC) and "let it through our gateway" (bearer).

**Rejected alternatives:**

- **mTLS.** Strongest transport auth, but requires per-trigger client-cert
  provisioning, storage of private keys, and cert-rotation UX — a large
  surface for a v1, and most webhook receivers do not terminate mTLS.
  HMAC gives payload integrity + authenticity without a PKI. Revisit for
  enterprise if asked.
- **OAuth 2.0 client-credentials.** Would require us to run a token-fetch
  leg (token endpoint, client id/secret, token caching, refresh) before
  every dispatch — more moving parts and another outbound call to fence.
  A static bearer covers the common "our gateway wants a token" case; full
  OAuth is deferred.

---

### 4. SSRF & abuse protection (the critical section)

Outbound HTTP to a user-supplied URL from our worker fleet is the
highest-risk part of this ADR. **An SSRF-safe outbound utility already
exists in the repo and MUST be the only path webhook dispatch uses:**
`src/utils/ssrfProtection.ts`. Do not hand-roll a `fetch`. The webhook
sender calls `validateUrlForSSRF(url)` then `fetchWithResolvedIp(validated,
…)` (or the atomic `ssrfSafeFetch`), the same primitive
`httpProxy.ts:187` already ships to production.

**Attack surface and the defense that covers each (✓ = already implemented
in `ssrfProtection.ts`; ✗ = gap this ADR must close):**

| Attack | Defense | Status |
|---|---|---|
| Cloud metadata (`169.254.169.254`, `fd00:ec2::254`, ECS `169.254.170.2`, `metadata`) | Always-on denylist `BLOCKED_METADATA_HOSTS` (`ssrfConstants.ts:63`), independent of any toggle | ✓ |
| Cloud internal domains (`.amazonaws.com`, `.compute.internal`, `.internal`, `.local`) | `BLOCKED_CLOUD_DOMAINS` suffix match (`ssrfConstants.ts:45`) | ✓ |
| localhost / loopback (`127.0.0.0/8`, `::1`) | `isPrivateOrLocalhostIP` (`ssrfProtection.ts:222`) | ✓ (gated, see below) |
| RFC1918 private (`10/8`, `172.16/12`, `192.168/16`) | `isPrivateIPv4` (`ssrfProtection.ts:205`) | ✓ (gated) |
| Link-local (`169.254/16`, `fe80::/10`) + IPv4-mapped IPv6 (`::ffff:…`) | `isPrivateIPv4` + `isPrivateOrLocalhostIP` (`ssrfProtection.ts:217,230`) | ✓ (gated) |
| **DNS rebinding (TOCTOU)** | Resolve once, **pin the connection to the validated IP** via a custom undici `Agent.lookup` (`createIpPinningAgent`, `ssrfProtection.ts:543`) so the socket connects to the IP we validated, not a re-resolved one | ✓ |
| Redirect → internal | `redirect: "manual"`, re-validate every `Location` through `validateUrlForSSRF`, cap chain at `MAX_REDIRECTS = 10` (`ssrfProtection.ts:607-642`) | ✓ |
| Non-HTTP schemes (`file:`, `gopher:`, `ftp:`) | Scheme allowlist `http:`/`https:` (`ssrfProtection.ts:396`); webhook narrows further to **https only** at the Zod layer | ✓ (+ tighten) |
| Huge response body | Cap bytes read (stream + abort past N KB) | ✗ **gap** |
| Slowloris / hung connection | Total-request timeout + connect timeout | ✗ **gap** |
| Non-standard ports (e.g. `:22`, `:6379`) | Port allowlist (443, and 80 only if https is relaxed) | ✗ **gap** |
| Third-party DDoS (we amplify) | Per-project rate limit + global concurrency cap + honor 429/Retry-After (§5) | ✗ **gap** |

**Gaps this ADR closes (the delta over `ssrfProtection.ts` as-is):**

1. **Force private-IP blocking ON for webhooks in SaaS.** In
   `ssrfProtection.ts`, private-IP/localhost blocking is gated on
   `BLOCK_LOCAL_HTTP_CALLS` (`ssrfProtection.ts:515`) — it is *off* by
   default so on-prem/dev can call internal services. Webhook dispatch must
   **not** inherit that default: construct a dedicated validator via the
   already-exported `createSSRFValidator({ blockLocal: true, allowedHosts:
   [] })` (`ssrfProtection.ts:385`) so a customer URL can never reach
   `10.x`/`localhost` regardless of the global toggle. (Self-hosted
   deployments may opt to relax this for their own trusted internal
   endpoints — same knob, operator's choice — but the SaaS default is
   hard-on.) **https-only:** reject `http:` at the Zod layer for webhooks
   even though the shared validator permits both.
2. **Response-size cap.** Stream the response and abort once the body
   exceeds a cap (recommend 64 KB — we only store a snippet, §6). Prevents
   a hostile endpoint returning gigabytes to exhaust a worker.
3. **Timeouts.** A connect timeout (~5 s) and a total-request timeout
   (~10 s) via `AbortSignal.timeout`, so a slowloris endpoint cannot pin a
   worker slot. (`ssrfSafeFetch` today has neither — it must be threaded
   through the undici `Agent`/fetch call.)
4. **Port restriction.** Reject any port other than 443 (and 80 only if a
   self-hosted operator relaxes https-only). Blocks `https://internal:6379`
   style probes even when the host resolves public.

**Anti-DDoS-of-third-parties (we must not become an amplifier):**

- **Per-project rate limit** on webhook dispatches using the existing
  fixed-window `src/server/rateLimit.ts` (the same limiter ADR-031 uses for
  test fire), keyed `webhook-dispatch:{projectId}:{hourBucket}`. Digest
  cadence already bounds volume; this backstops an immediate-cadence
  trigger firing per-match (the same runaway ADR-031 §2 caps for email).
- **Respect receiver backpressure:** on `429`, honor `Retry-After`; parse
  `RateLimit-Remaining` / `RateLimit-Reset` (draft `RateLimit-*` headers)
  when present and back off proactively (§5).
- **Global concurrency cap.** Webhook sends inherit the outbox GroupQueue's
  per-tenant fairness (`TenantRateTracker`) and global worker concurrency —
  but add a webhook-specific in-flight semaphore so one project's slow
  endpoint can't consume the whole worker pool waiting on 10-second
  timeouts.

**Where the sender lives:** a single reusable module
`src/server/triggers/sendWebhook.ts` (sibling to `sendSlackWebhook.ts`),
wrapping `ssrfProtection` + signing + size/timeout caps + `DispatchError`
classification (`toDispatchError`, same as
`sendSlackWebhook.ts:143`). This is the "one outbound utility every future
customer-webhook dispatch shares" that ADR-030 asked for.

---

### 5. Retries & backoff

**Recommendation: ride the existing `ReactorOutbox` / GroupQueue retry
machinery for durability + scheduling; record each HTTP attempt as a
`WebhookDelivery` row (§6); do NOT hand-roll a second attempt loop.**

The outbox already gives exponential backoff, `maxAttempts` (default 8,
`prisma/schema.prisma:2900`), `nextAttemptAt`, dead-letter (`status: dead`),
and an operator surface — reusing it is strictly less code and one
operational story. The webhook sender throws the typed `DispatchError`
(ADR-027) with `retryable` set per the HTTP outcome; the queue handles the
backoff and the `PgOutboxAuditAdapter` mirrors dispatch-level state to
`ReactorOutbox`. The per-attempt HTTP detail (status, body snippet,
latency) that the outbox does *not* model is written by the sender into
`WebhookDelivery` on every attempt.

**Retry vs terminal classification:**

| HTTP outcome | Class |
|---|---|
| Timeout / connection error / DNS failure | retryable |
| `5xx` | retryable |
| `429` | retryable — **honor `Retry-After`** |
| `408 Request Timeout` | retryable |
| `2xx` | success (terminal) |
| `3xx` | followed + re-validated by the SSRF layer; a redirect loop → terminal error |
| other `4xx` (`400`,`401`,`403`,`404`,`422`, …) | **terminal, non-retryable** — the request is malformed/unauthorized/gone; retrying spams a broken config |

**Honoring `Retry-After` inside outbox backoff.** The GroupQueue's backoff
is schedule-driven, not caller-driven, so a raw `DispatchError` cannot say
"come back in 90 s". Recommendation: extend `DispatchError` with an optional
`retryAfterMs` hint and have the cadence dispatcher pass it to the queue's
re-enqueue delay (the same `enqueueCadence({ delayMs })` mechanism already
in `dispatcher.ts:103`). For small `Retry-After` values (≤ a few seconds)
the sender may instead do a single bounded in-attempt wait; for larger
values, reschedule through the outbox. If threading `retryAfterMs` proves
invasive, v1 ships with the outbox's default exponential backoff + jitter
and treats `Retry-After` as advisory-logged-only — call this out as a
known v1 limitation, not silently drop it.

**Backoff shape:** exponential with jitter (the GroupQueue default), capped
`maxAttempts` (reuse the ReactorOutbox default of 8, or a lower
webhook-specific 5 — a broken endpoint shouldn't retry for hours). After
the last attempt the dispatch dead-letters (`status: dead`), visible in the
drawer.

**Idempotency.** Every logical dispatch carries a stable
`X-LangWatch-Event-Id` (a UUID derived from the dispatch dedup identity, the
same `dispatchDigest` shape the email path already computes at
`dispatcher.ts:557`). All retries of one dispatch reuse the same id so a
receiver can dedupe — the request-level analog of the `TriggerSent`
at-most-once claim, which stays our internal at-most-once gate
(`dispatcher.ts:451,772`).

---

### 6. Deliverability report / delivery log

**Recommendation: a new per-attempt table `WebhookDelivery`.** `ReactorOutbox`
is one row per *dispatch* (a whole digest) and its `renderDiagnostics` blob
(`prisma/schema.prisma:2910`) is render-health, not delivery detail — it
cannot express "attempt 3 got a 502 after 1.2 s". `TriggerSent` is the
match-claim ledger, not a delivery log. A webhook's value proposition *is*
the deliverability report (every retry, status, body, latency), so it earns
its own table.

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
  responseStatus  Int?                       // null when the attempt never got a response (timeout/DNS)
  responseBody    String?                    // size-capped snippet (≤ 4 KB), sensitivity note below
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

- **Redaction (mandatory).** `requestHeaders` is stored with the signature,
  `Authorization`, and any configured api-key header value masked to `***` —
  we persist which headers were sent, never the secret material. This is the
  same principle as `createAgentTestTrace`'s header sanitization in
  `httpProxy.ts`.
- **Response-body sensitivity.** The stored snippet is the *customer's own
  endpoint's* response, not LangWatch data — but it still lands in
  control-plane Postgres, so cap it hard (≤ 4 KB), truncate with an
  ellipsis marker, and document that it is retained. It exists so an
  operator can see "the receiver said `{"error":"bad schema"}`" without
  re-firing.
- **Retention / pruning.** Postgres tables are outside the ClickHouse
  retention sweep, so `WebhookDelivery` needs its own prune — a scheduled
  delete of rows older than 30 days (align with the ADR-030 `dispatched`
  retention window). Note it in the same breath as the `LangyConversation`
  PII-purge concern (`schema.prisma` comments) so it isn't forgotten.
- **Rendering.** Extend the drawer's existing "Recent fires" panel
  (`ViewAutomationDrawer.tsx`, backed by
  `TriggerFireHistoryService.getAllRecentFiresForTrigger`) so a webhook
  trigger's fire row is expandable into its attempts: a status-code chip per
  attempt (green 2xx / amber 429 / red 5xx / grey timeout), latency, and a
  reveal for the (redacted) request + response-body snippet. Keep the read
  path as a new method on `TriggerFireHistoryService` (or a sibling
  `WebhookDeliveryService`) → repository, never raw Prisma in the route
  (layering rule). The list still keys "last fired / fires in 30 days" off
  `TriggerSent` as today; `WebhookDelivery` is the drill-down.

---

### 7. Migration & rollout

- **Prisma enum addition:** `SEND_WEBHOOK` on `TriggerAction` — additive,
  no data backfill (existing triggers keep their action). Immutable-migration
  rule: a fresh migration, never editing a deployed one.
- **New table migration:** `WebhookDelivery` + `WebhookDeliveryOutcome`
  enum. All indexes lead with `projectId` (multitenancy).
- **Feature-flag gating:** add `release_webhook_automations` to
  `FEATURE_FLAGS` in `src/server/featureFlag/registry.ts:118`, `scope:
  "PRODUCT"`, `defaultValue: false` — mirroring `release_langy_enabled` /
  `release_ui_ai_governance_enabled`. Gate the provider's appearance in the
  type picker (client) *and* the dispatch/route accepting `SEND_WEBHOOK`
  (server) on it. Staff/dev can force it via
  `FEATURE_FLAG_FORCE_ENABLE=release_webhook_automations` (the same
  unhide mechanism the AI-gateway menu uses).
- **Cron parity vs outbox-only.** The trace path and graph-alert path fire
  from the event-sourced outbox / `dispatchGraphAlertAction` when their
  respective firing flags are on, and from the K8s cron
  (`src/pages/api/cron/triggers/actions/`) when off — email and Slack each
  have both a cron action and an outbox branch. **Recommendation: add a cron
  `actions/sendWebhook.ts` (parity with `sendSlackMessage.ts`) so a project
  still on the cron path can use webhooks**, and add the third branch to the
  outbox dispatcher's notify switch (`dispatcher.ts:532`) and to
  `dispatchGraphAlertAction` (`graphAlertActionDispatch.ts:181` — it
  currently dead-letters any non-email/Slack action at `:241`, so this is a
  required edit, not optional). Both paths call the one shared
  `sendWebhook.ts`. If the webhook feature ships strictly after graph/trace
  firing has fully cut over to the outbox for GA projects, the cron action
  can be a thin follow-up — but the graph-alert dead-letter branch must be
  handled regardless.
- **Backfill:** none.

---

### 8. Effort estimate & phasing

Roughly **M–L**. The heavy lifting (SSRF utility, templating engine,
outbox retry, encryption, fire-history surface) already exists; this is
composition plus one genuinely new subsystem (the delivery log) and four
SSRF hardening deltas.

- **Phase 1 — Provider + config UI (S).** New `definitions/webhook/`
  directory (shared/client/server), enum migration, `NOTIFY_TRIGGER_ACTIONS`
  entry, ConfigForm (URL/method/headers/auth/body editor), Zod schema, live
  preview branch, `channel` union widening. Behind the flag; no real sends
  yet. Reuses Slack's client shape almost wholesale.
- **Phase 2 — SSRF-safe sender + dispatch (M, riskiest).** `sendWebhook.ts`
  wrapping `ssrfProtection` with the four hardening deltas (force
  `blockLocal`, https+port restriction, response-size cap, timeouts) +
  signing + auth headers + `DispatchError` classification. Wire into the
  outbox notify switch, the graph-alert dispatch branch, and (parity) the
  cron action. `renderWebhookBody` + default bodies in `defaults.ts`.
- **Phase 3 — Retries & idempotency (S).** Classification table (§5),
  `Retry-After` handling (extend `DispatchError.retryAfterMs`), the stable
  `X-LangWatch-Event-Id`, per-project rate limit.
- **Phase 4 — Delivery log + report UI (M).** `WebhookDelivery` table +
  service/repository, sender writes a row per attempt with redaction, prune
  job, and the expandable attempts view in `ViewAutomationDrawer`.

**Riskiest part: SSRF (Phase 2).** A single missed vector (a rebinding
bypass, a redirect-to-metadata, an un-capped port) turns our worker fleet
into an attacker's proxy into our own VPC. The mitigation is discipline, not
cleverness: **route 100% of webhook traffic through the existing, audited
`ssrfProtection.ts`**, add the four deltas as thin wrappers, and cover each
row of the §4 attack table with an executed test (not a string assertion) —
including a DNS-rebinding test and a redirect-to-`169.254.169.254` test that
observe the block, per the repo's "regression test must execute the code
path" rule.

## Rationale / Trade-offs

- **Why a notify provider, not a new `action` class.** A webhook renders
  customer content and benefits from digest coalescing (send N matches in
  one payload) exactly like email/Slack, so it inherits the settle→cadence
  outbox timing, the template pipeline, and the test-fire path for free.
  Modeling it as a bespoke class would fork all three.
- **Why reuse `ssrfProtection.ts` rather than write a webhook-specific
  guard.** It already implements the hard parts (IP-pinning against
  rebinding, redirect re-validation, metadata denylist) and is
  battle-tested in `httpProxy.ts`. Forking it would double the surface where
  an SSRF bug can hide. The webhook-specific concerns (force-block-local,
  https-only, size/timeout/port caps) are thin, composable deltas.
- **Why HMAC over the body + timestamp, not body alone.** Body-only
  signatures are replayable; the timestamp gives the receiver a cheap replay
  window without us holding receiver state. It matches what Stripe/GitHub
  webhook consumers already know how to verify.
- **Why a dedicated `WebhookDelivery` table.** `ReactorOutbox` is
  dispatch-grain and framework-owned by the audit adapter; `TriggerSent` is
  the claim ledger. Per-attempt HTTP forensics is a genuinely new grain and
  the feature's headline value — it earns a table rather than being crammed
  into a JSON blob on an existing row.
- **What we compromise.** More Postgres write volume (one `WebhookDelivery`
  row per attempt) and a new prune job; a fifth notify-ish shape the
  authoring drawer must render; and a small asymmetry (webhook's template
  lives in `actionParams`, not a `Trigger` column) that a reader of the
  provider code must be told about. All judged worth it against the
  alternative of a thinner delivery story that customers would immediately
  ask us to deepen.

## Consequences

- **One new provider directory, one enum value, one `NOTIFY_TRIGGER_ACTIONS`
  entry** — the registry pattern absorbs the channel with minimal blast
  radius. The notify/persist exhaustiveness test forces classification at
  introduction.
- **One shared outbound utility (`sendWebhook.ts`)** becomes the home every
  future customer-endpoint dispatch reuses — the ADR-030 ask, discharged.
- **`ssrfProtection.ts` grows a webhook-tuned validator config and
  (ideally) gains response-size + timeout + port options** usable by other
  callers (`httpProxy.ts` would benefit too).
- **New `WebhookDelivery` table + prune job** in control-plane Postgres,
  holding redacted request headers and size-capped response snippets, 30-day
  retention.
- **`dispatchGraphAlertAction` must stop dead-lettering webhook**
  (`graphAlertActionDispatch.ts:241`) — a required edit, since graph alerts
  now have a third valid channel.
- **`DispatchError` may gain a `retryAfterMs` hint** so outbox backoff can
  honor receiver `Retry-After` — a small contract extension (ADR-027).
- **Shipped dark behind `release_webhook_automations`**; GA is a later
  PostHog rollout + default flip, same as every other `release_*` flag.
- **Deferred to fast-follow:** OAuth client-credentials auth, mTLS,
  dual-secret rotation window, non-JSON content types, and a receiver-side
  "verify signature" helper snippet in the docs.

## References

- [ADR-030](./030-transactional-outbox-for-stake-sensitive-dispatch.md) —
  transactional outbox this dispatch rides; its Consequences foreshadow this
  exact webhook work (SSRF, HMAC, size caps, secret encryption).
- [ADR-036](./036-liquid-templates-for-trigger-notifications.md) — Liquid
  template engine + `matches[]` contract the JSON body renders against.
- [ADR-037](./037-automation-operator-surfaces.md) — the authoring drawer /
  fire-history surface the delivery report extends.
- [ADR-031](./031-trigger-email-abuse-protections.md) — the abuse-cap
  pattern (`rateLimit.ts`, per-project caps) the webhook rate limit mirrors;
  its Slack exemption reasoning informs why webhook still needs SSRF.
- [ADR-027](./027-typed-dispatcherror-contract.md) — `DispatchError`
  contract the sender throws (and would extend with `retryAfterMs`).
- [ADR-034](./034-event-sourced-analytics-materialization.md) /
  **PR #5015** (`feat(automations): graph alerts in automations drawer +
  Liquid template wiring`) — the graph-alert dispatch path this webhook
  channel plugs a third branch into.
- `src/utils/ssrfProtection.ts` / `src/utils/ssrfConstants.ts` — the
  outbound-fetch guard webhook dispatch reuses.
- `src/server/api/routers/httpProxy.ts` — existing SSRF-fenced HTTP client
  with the auth union this provider mirrors.
- `src/utils/encryption.ts` + `ProjectSecret` (`prisma/schema.prisma:1035`)
  — encryption-at-rest pattern for the HMAC secret and auth tokens.
- `src/server/mailer/unsubscribeToken.ts` /
  `src/server/mailer/triggerNoReply.ts` — HMAC keyed-hash + `timingSafeEqual`
  pattern the signature follows.
- `src/automations/providers/` — the registry (`types.ts`, `client.ts`,
  `server.ts`) and the Slack definition (`definitions/slack/`) the webhook
  provider is shaped after.
