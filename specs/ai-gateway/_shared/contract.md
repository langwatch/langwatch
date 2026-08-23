# LangWatch AI Gateway — Shared Contract

**Status:** Draft v0.1.4 (latest audit 2026-04-19 covers Lane A iters 1–44 + Lane B iters 1–40 — cache-rules full stack landed, semconv-only cache-token attrs, helm chart lw-dev smoke)
**Owners:** @ai_gateway_andr (document), @ai_gateway_sergey (Go gateway), @ai_gateway_alexis (Platform/DB)
**Purpose:** Single source of truth for every wire-level decision shared between the Go gateway service (`langwatch-saas/services/gateway`) and the LangWatch platform control-plane (`langwatch/langwatch`). Every BDD spec in `specs/ai-gateway/` must agree with this file. Disagreements get resolved here first, code changes second.

---

## 1. Repo & service layout

| Component | Repo | Path |
|---|---|---|
| Go gateway service (data plane) | `langwatch-saas` | `services/gateway/` (new standalone `go.mod`) |
| Platform control-plane (VK CRUD, budgets, RBAC, provider-settings cohesion, drawers) | `langwatch` (open-source) | `langwatch/platform/app/src/...` |
| BDD specs | `langwatch` | `specs/ai-gateway/` |
| Docs | `langwatch` | `docs/docs/ai-gateway/` |
| Helm chart (self-host) | `langwatch-saas` | `infrastructure/charts/` (existing chart, new `gateway` sub-chart) |

Deployment: separate pod, separate container. Load balancer routes `/v1/**` path → gateway service; everything else → main app. URL is `gateway.langwatch.ai` (dedicated) with legacy path-routing on `app.langwatch.ai/v1/**` kept for CLI integrations that pin base URLs without subdomain flexibility.

---

## 2. Virtual-key format

`vk-lw-{env}_{ulid}` where `env ∈ {live, test}`, `ulid` is a 26-char Crockford base32 ULID.

Total length: **40 chars** (`vk-lw-01HZX9K3M...`).

**Rules:**

- Prefix `vk-lw-` is fixed and searchable (grep/DLP friendly).
- Env prefix prevents accidental dev-key-in-prod / vice versa (Stripe pattern).
- Body is ULID: monotonic, k-sortable, time-prefixed. No b62 random — ULID sorts sensibly in the dashboard.
- Stored server-side as `hex(hmac_sha256(LW_VIRTUAL_KEY_PEPPER, key))` alongside a short display prefix (`vk-lw-01HZX9` visible, rest hashed). Peppered HMAC-SHA256 (not argon2id) is chosen because (a) the VK body is a 130-bit ULID — already brute-force-infeasible, (b) argon2id would add 50–100 ms to every cold resolve-key call which defeats the gateway's latency budget, (c) Stripe/GitHub use the same pattern for API keys, (d) deterministic hash enables O(1) lookup by hash (argon2id's random salt would force a table scan). Constant-time compare on verify.
- Key is shown **once** at creation; not retrievable afterward.
- Rotation: user can rotate a VK in place (same `vk_id`, new secret, old secret valid for 24h grace).
- **Pepper rotation:** `LW_VIRTUAL_KEY_PEPPER` rotates via a dual-pepper lookup window — during rotation, the control-plane verifies with both the new and old pepper (returning OK on either match) and re-hashes to the new pepper on next use. Complete rotation = re-hash all live VKs in a background job, then drop the old pepper. Documented SOP in self-hosting ops guide.
- Revocation: soft-delete sets `revoked_at`; gateway must reject within 60s (via `/changes` diff).

**Header accepted by the gateway:**

1. `Authorization: Bearer vk-lw-...` (OpenAI-compatible, default).
2. `x-api-key: vk-lw-...` (Anthropic-compatible fallback for Claude-shaped clients).
3. `api-key: vk-lw-...` (Azure-compatible fallback).

The gateway accepts all three and normalises internally.

---

## 3. Public HTTP surface (customer-facing)

All routes on `gateway.langwatch.ai` (or `app.langwatch.ai/v1/**`).

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/chat/completions` | OpenAI-compatible chat completions (streaming + non-streaming). Used by Codex, opencode, most SDKs. |
| POST | `/v1/messages` | Anthropic-compatible messages endpoint. Used by Claude Code, native Anthropic SDKs. Tool-call streaming deltas preserved byte-for-byte (Nexos docs: coding CLIs are picky here). |
| POST | `/v1/embeddings` | OpenAI-compatible embeddings |
| POST | `/v1/images/generations` | OpenAI-compatible image generation |
| POST | `/v1/audio/transcriptions` | OpenAI-compatible transcription |
| POST | `/v1/audio/speech` | OpenAI-compatible TTS |
| POST | `/v1/moderations` | OpenAI-compatible moderation |
| GET | `/v1/models` | Lists models allowed for the current VK |
| GET | `/v1/models/:model` | Model metadata |
| POST | `/v1/responses` | OpenAI Responses API (for Codex CLI compat) |
| GET | `/healthz` | Liveness (always 200 if process alive) |
| GET | `/readyz` | Readiness (bifrost OK + control-plane reachable + key-cache warm) |
| GET | `/metrics` | Prometheus metrics |

Routing pattern:
- Incoming `model` field can be:
  - `<alias>` (e.g. `gpt-4o`, `claude`) — resolved via VK config `model_aliases`. **Aliases always win** if defined; they are the VK owner's explicit redirect.
  - `<provider>/<model>` explicit form (e.g. `openai/gpt-5-mini`, `bedrock/anthropic.claude-haiku-4-5-20251001`, `azure/my-deployment`) — bypasses aliases and addresses the provider directly. Still subject to `models_allowed` allowlist.
- If the alias/explicit form doesn't resolve to a provider in the VK's `providers` list, returns `model_not_allowed` error.
- `GET /v1/models` returns the **effective** model list: the union of aliases + explicitly-allowed models for this VK, filtered by `models_allowed` if set. Without an allowlist, the list is discovered from the chain's catalogs: base-URL endpoints and hosted providers are asked for their models, deployment-mapped providers (Azure / Bedrock / Vertex) list their mapped ids. Providers that dispatch can route to but that contributed nothing are named in the `X-Langwatch-Models-Discovery-Incomplete` response header as `provider:reason` tokens (`not-enumerable`, `probe-failed`), so an empty or partial list is diagnosable rather than silent.

---

## 4. Internal control-plane endpoints (gateway → LangWatch app)

All mounted at `app.langwatch.ai/api/internal/gateway/*` (matches existing Next.js/Hono API-route convention). Protected by HMAC signature (`LW_GATEWAY_INTERNAL_SECRET`) and preferably mTLS at the network layer. Not exposed publicly.

**Canonical HMAC signature (v1, with timestamp replay protection):**

```
canonical = method + "\n" + path_with_query + "\n" + timestamp + "\n" + hex(sha256(body))
sig       = hex(hmac_sha256(LW_GATEWAY_INTERNAL_SECRET, canonical))
```

Gateway sends:

```
X-LangWatch-Gateway-Signature: <sig>
X-LangWatch-Gateway-Timestamp: <unix_seconds>
```

Control-plane verifies (a) timestamp is within ±5 min (300s) of server time (replay protection), (b) recomputed sig matches via constant-time compare, (c) body sha256 matches the one in the canonical string (defence in depth). Rotate `LW_GATEWAY_INTERNAL_SECRET` by supporting two valid values for a grace window.

**Reference test vector** — Go signer ↔ Hono verifier MUST match byte-for-byte. Source of truth for both sides' unit tests.

```
LW_GATEWAY_INTERNAL_SECRET = "shared-test-secret-32byteslong!!"
method      = "POST"
path        = "/api/internal/gateway/resolve-key"
timestamp   = "1734567890"
body        = {"key_presented":"vk-lw-01HZX","gateway_node_id":"gw-a"}
body_sha256 = 59f25745b66fbb0c7b3714572d20ffef741817b84b86093e4ac6af243af66816
canonical   = "POST\n/api/internal/gateway/resolve-key\n1734567890\n59f25745b66fbb0c7b3714572d20ffef741817b84b86093e4ac6af243af66816"
signature   = 4e4c8634b10a7ef719cf6d56b89b7f44a5ac7544c03d98ef132b79d36a1a6a1f
```

Headers the Go client MUST emit:

```
X-LangWatch-Gateway-Signature: <signature>
X-LangWatch-Gateway-Timestamp: <unix_seconds>
X-LangWatch-Gateway-Node: <hostname>          # advisory, not signed
```

Server-side verify order: (1) constant-time compare on signature first (prevents secret-length timing oracle), (2) then `|now - ts| ≤ 300s`, (3) then re-verify body sha256 in the canonical string matches the received body as a defence-in-depth check.

Other shared env vars referenced across the contract:

- `LW_GATEWAY_INTERNAL_SECRET` — HMAC key for internal endpoints (above).
- `LW_GATEWAY_JWT_SECRET` — HS256 signing key for the resolve-key JWT (§4.1). Shared between control-plane signer and gateway verifier.
- `LW_VIRTUAL_KEY_PEPPER` — HMAC-SHA256 key used as `hex(hmac_sha256(pepper, vk_secret))` for at-rest hashing (§2 justifies HMAC-SHA256 over argon2id on latency/determinism grounds). Control-plane only; never on the gateway.

### 4.0 `POST /api/internal/gateway/bootstrap`

Pull-all-active-VKs bulk endpoint. Used by the gateway on startup when `LW_GATEWAY_BOOTSTRAP_PULL=true` (enterprise opt-in; see §9). Returns a paginated stream of resolve-key + config payloads.

Request:
```
GET /api/internal/gateway/bootstrap?page_token=<opaque>
```

Response:
```json
{
  "keys": [
    { "jwt": "...", "revision": 142, "key_id": "vk_...", "display_prefix": "vk-lw-01HZX9", "config": { ... §4.2 shape ... } },
    ...
  ],
  "next_page_token": "<opaque>|null",
  "current_revision": 145
}
```

After bootstrap, the gateway calls `/changes?since=<current_revision>` to stream subsequent mutations.

### 4.1 `POST /api/internal/gateway/resolve-key`

Request:
```json
{ "key_presented": "vk-lw-01HZX...", "gateway_node_id": "gw-eks-abc" }
```

Response (200):
```json
{
  "jwt": "<HS256 signed, TTL 15m or the key's expiry, whichever is sooner>",
  "revision": 142,
  "key_id": "vk_01HZX...",
  "display_prefix": "vk-lw-01HZX9"
}
```

JWT claims (short, hot-path-verified):
```
{
  "vk_id":         "vk_01HZX...",
  "project_id":    "proj_01HZ...",
  "team_id":       "team_01HZ...",
  "org_id":        "org_01HZ...",
  "principal_id":  "user_01HZ... | svc_01HZ...",  // for trace attribution
  "revision":      142,                            // bumped on any mutation
  "vk_expires_at": 1734568790,                     // key's own expiry, null when it has none
  "iat":           1734567890,
  "exp":           1734568790,                     // TTL 900s, or vk_expires_at when sooner
  "iss":           "langwatch-control-plane",
  "aud":           "langwatch-gateway"
}
```

Gateway refreshes asynchronously at `exp - 5min` (so T+10min from issue).

`vk_expires_at` is the terminal validity instant of the key itself, not a
refresh boundary: the gateway caps both auth-cache deadlines at it and refuses
a request past it with `403 virtual_key_expired`, without a round trip. That is
what stops a key from serving through the stale-while-error window (§9) after
its date has passed while the control plane is unreachable.

Errors: `401 invalid_api_key`, `403 virtual_key_revoked`, `403 virtual_key_disabled`, `403 virtual_key_expired`.

### 4.2 `GET /api/internal/gateway/config/:vk_id`

Returns the warm-cache config (fat, not on hot path). Supports conditional `If-None-Match: <revision>` → `304 Not Modified`.

```json
{
  "revision": 142,
  "vk_id": "vk_01HZX...",
  "organization_id": "org_acme",
  "scopes": [{ "scope_type": "ORGANIZATION", "scope_id": "org_acme" }],
  "model_providers": [
    {
      "id": "mp_01HZ...",
      "type": "openai|anthropic|azure_openai|bedrock|vertex|gemini|custom_openai",
      "scope": { "scope_type": "ORGANIZATION", "scope_id": "org_acme" },
      "credentials": {
        /* Opaque JSON embedded on the wire. Shape varies by provider type —
           the control plane decrypts ModelProvider.customKeys (per-org KMS)
           at bundle-materialisation time and emits the cleartext in this
           field. Gateway never sees encrypted bytes on the wire. Per-type
           shapes:
             openai:         { "api_key": "sk-..." }
             anthropic:      { "api_key": "sk-ant-..." }
             azure_openai:   { "endpoint": "https://...", "api_key": "..." }
             bedrock:        { "region": "us-east-1", "access_key": "...", "secret_key": "..." }
             vertex:         { "region": "...", "project_id": "...", "service_account_json": "..." }
             gemini:         { "api_key": "..." }
             custom_openai:  { "base_url": "https://...", "api_key": "..." }  */
        "api_key": "sk-proj-..."
      },
      "base_url": "https://api.openai.com/v1",  // optional, type-specific
      "region": null,                            // optional, type-specific
      "config": { /* per-provider tuning: deployment_name, rate_limit, health, etc */ }
    }
  ],
  /* `chain` is the ordered provider slots; `max_attempts` bounds the walk.
     Which failures walk it is not on the wire: the gateway decides that
     from the real upstream outcome (§7), the same way for every key. */
  "fallback": {
    "chain": ["pc_primary", "pc_secondary", "pc_tertiary"],
    "max_attempts": 3
  },
  "model_aliases": { "gpt-4o": "azure/my-deployment", "claude": "anthropic/claude-haiku-4-5-20251001" },
  "models_allowed": ["gpt-5-mini", "claude-haiku-*", "gemini-2.5-flash"],
  /* Provider allowlist. `null` means every provider the key reaches through
     its scope graph, INCLUDING providers added after the key was created;
     that is what the drawer's "All providers" persists, and `providers[]`
     above is already filtered to match. A list narrows to those
     ModelProvider ids; it is never empty. */
  "providers_allowed": null,
  /* How the key behaves when its provider fails.
       none          - no failover. `fallback.max_attempts` is pinned to 1,
                       so a gateway that does not yet read this field still
                       behaves correctly. Default for keys created after the
                       routing-mode split.
       fallback_all  - walk every eligible provider in `fallback.chain`.
                       Keys created before the split are migrated to this,
                       so their behaviour is unchanged.
       policy        - ordering and rules come from the linked RoutingPolicy. */
  "routing_mode": "none",
  /* Why a provider a request could resolve to is NOT in `providers[]`, so a
     request-time block can name the reason instead of failing opaque. Each
     entry is a ModelProvider id + its type, the same shape `providers[]`
     carries, because the gateway matches a resolved request by provider type
     and these rows are absent from `providers[]`.
       routing_excluded_providers - reachable from the key's scope AND inside
         provider access, but dropped by the routing policy (named by
         routing_policy_name).
       access_excluded_providers  - reachable from scope but outside
         providers_allowed; empty when the key allows all providers.
     A provider in neither list with no credential is not reachable from the
     key's scope. */
  "routing_excluded_providers": [{ "id": "pc_anthropic", "type": "anthropic" }],
  "access_excluded_providers": [{ "id": "pc_gemini", "type": "gemini" }],
  /* Display name of the key's routing policy, used to name the routing block.
     null when the key is not on a routing policy. */
  "routing_policy_name": null,
  "cache": { "mode": "respect|force|disable", "ttl_s": 3600 },
  "guardrails": {
    /* Both fail-open flags default false (fail-closed). Flip to true per
       direction to pass through on guardrail outages with a warn log
       + OTel attribute `langwatch.guardrail.fail_open=true`. */
    "request_fail_open": false,
    "response_fail_open": false,
    "pre":  [{"id": "guard_01HZ...", "evaluator": "evaluators/pii-check-abc12"}],
    "post": [{"id": "guard_01HZ...", "evaluator": "evaluators/hallucination-check-def34"}],
    "stream_chunk": []
  },
  "policy_rules": {
    /* RE2 regex deny/allow enforced right after auth + rate-limit, before
       body-parse / guardrails / budget / bifrost. Broken regex → request
       rejected with 503 service_unavailable (fail-closed, never silent-bypass).
       URLs dimension extracts every http(s):// URL anywhere in the body
       (user messages, tool args, system prompts), strips trailing punctuation,
       dedupes. Models dimension is regex policy — distinct from the static
       glob `models_allowed` allowlist; both compose (request passes only
       if both allow), and both judge the RESOLVED model, in either
       spelling, so an alias cannot route around either (§11b). */
    "tools":  { "deny": ["^shell\\.", "^filesystem\\.write$"], "allow": null },
    "mcp":    { "deny": ["^.*@mcp/unverified.*$"], "allow": null },
    "urls":   { "deny": [], "allow": ["^https?://allowed\\.example\\.com/.*"] },
    "models": { "deny": ["^gpt-4(-turbo)?$"], "allow": null }
  },
  "rate_limits": { "rpm": null, "tpm": null, "rpd": null },
  /* v1 ships RPM + RPD enforcement (golang.org/x/time/rate token buckets,
     per-VK, LRU-evicted). Cross-dimension accounting: an RPM denial does
     NOT burn an RPD token. On breach: HTTP 429 + Retry-After + header
     X-LangWatch-RateLimit-Dimension: rpm|rpd naming which ceiling fired,
     error code = vk_rate_limit_exceeded. TPM deferred to v1.1 (requires
     Redis-coordinated cluster-wide counters; pre-request token count is
     an estimate too imprecise for a hard cap). */
  /* `scope_id` is the bucket spend accumulates under, which is the budget's
     target for every scope except "group". `provider_key` is orthogonal to
     the scope: null counts every dispatch, set counts and constrains only
     dispatches to that ModelProvider id. See §4.6 for how a filtered budget
     is enforced. */
  "budgets": [
    {
      "scope": "virtual_key", "scope_id": "vk_01HZ...", "provider_key": null,
      "window": "day", "limit_usd": 25.00,
      "spent_usd": 4.12, "remaining_usd": 20.88, "resets_at": "2026-04-19T00:00:00Z",
      "on_breach": "block"
    },
    { "scope": "project", "scope_id": "proj_01HZ...", "provider_key": "mp_01HZ...",
      "window": "month", "limit_usd": 1000.00,
      "spent_usd": 437.55, "remaining_usd": 562.45, "resets_at": "2026-05-01T00:00:00Z",
      "on_breach": "block" },
    { "scope": "team", "scope_id": "team_01HZ...", "provider_key": null,
      "window": "month", "limit_usd": 5000.00,
      "spent_usd": 3210.00, "remaining_usd": 1790.00, "resets_at": "2026-05-01T00:00:00Z",
      "on_breach": "warn" },
    /* A group budget is per member: one budget row materialises one
       bucket per member, so `scope_id` is `<groupId>:<userId>` and
       `principal_id` names the member. Two members never share a pot. */
    { "scope": "group", "scope_id": "grp_01HZ...:user_01HZ...", "principal_id": "user_01HZ...",
      "provider_key": null, "window": "month", "limit_usd": 50.00,
      "spent_usd": 12.40, "remaining_usd": 37.60, "resets_at": "2026-05-01T00:00:00Z",
      "on_breach": "block" }
  ],
  "metadata": { "label": "dev/codex", "tags": ["coding-cli"], "created_by": "user_01HZ..." },
  /* The key's own expiration date in unix seconds, null for a key that never
     expires. ALWAYS present: the gateway reads an explicit null as "this key
     has no date" and an absent field as "an older control plane said nothing,
     keep the date you hold", so the two must stay distinguishable.

     The same date rides the auth token as `vk_expires_at` (§4.1), which is the
     mint-time floor. Carrying it here as well is what bounds how stale the
     gateway's copy can get: the ETag moves on every mutation, so a shortened or
     extended date arrives on the next config revalidation (§9, ConfigTTL, 60s
     by default) even while the change feed is unavailable. Shortening therefore
     propagates faster than revocation does under the same failure. */
  "expires_at": 1734568790
}
```

### 4.3 `GET /api/internal/gateway/changes?since=<revision>&organization_id=<org_id>&timeout_s=25`

Long-poll endpoint. Blocks up to `timeout_s` waiting for any VK mutation in the given `organization_id` with `revision > since`. `organization_id` is **explicit** on the query string (not implicit from the HMAC signer's JWT) so the gateway doesn't have to decode a JWT on every long-poll and the control-plane can directly filter ChangeEvent rows by `organizationId` index.

- **200 OK** with body if any mutation occurred before timeout.
- **204 No Content** if timeout elapsed with no mutations (gateway re-polls immediately).

Returns array of diffs:

```json
{
  "current_revision": 145,
  "changes": [
    { "kind": "vk_config_updated", "vk_id": "vk_01HZ...", "revision": 143 },
    { "kind": "vk_revoked",        "vk_id": "vk_01HZ...", "revision": 144 },
    { "kind": "vk_created",        "vk_id": "vk_01HZ...", "revision": 145 }
  ]
}
```

Gateway re-fetches affected `config/:vk_id`. This replaces the 60s full-refresh with tailed diffs. Full-refresh is the fallback on startup / after disconnect.

### 4.4 Enforcement freshness (no pre-request control-plane call)

The gateway decides every request against data it already holds. There is no
control-plane round trip on the hot path, and exactly one narrow read for the
one figure a bundle structurally cannot carry.

**Totals baked into the bundle.** Each applicable scope arrives in the config
bundle (§4.2) with its `limit_usd` and its `spent_usd`, and the checker
compares them in process. A cached bundle is therefore as fresh as the last
time it was refreshed.

**Change events do the refreshing.** Writing debits emits a `BUDGET_UPDATED`
change event on the `/changes` long-poll (§4.3), and the gateway drops the
bundles it affects: the bundles of one project when the event carries a
`project_id`, otherwise every bundle of the polled organization, since only
project-scoped budget events can name a project. The next request through an
evicted key refetches and enforces against the new totals. The 60s
`CONFIG_TTL` on a cached bundle is the backstop rather than the mechanism: it
bounds staleness when a change event is missed or arrives while the gateway is
disconnected.

**Routing policies and cache rules take the same route.** A policy edit or
delete (`ROUTING_POLICY_UPDATED` / `ROUTING_POLICY_DELETED`) and any cache-rule
mutation (`CACHE_RULE_CREATED` / `CACHE_RULE_UPDATED` / `CACHE_RULE_DELETED`)
also evict every bundle of the polled organization. Both are folded into the
bundle by the materialiser and neither leaves an id on it to join back on, so
the organization is the finest key available, the same position a budget event
without a `project_id` is in. Deleting a policy also releases the keys that
pointed at it, in the same transaction: the pointer is cleared and the key's
routing mode moves off `POLICY`, which cannot exist without one.

**The one read a bundle cannot carry.** A per-end-user budget is a template:
one budget row governs a separate allowance for every end user it has seen, a
fan-out the bundle cannot bake without the control plane enumerating every
customer of every key. The bundle carries the template's limit, and the
gateway reads the single bucket the request needs from
`GET /api/internal/gateway/budget-bucket-spend`, cached 15s per
`(budget, end user)`. An unreadable bucket (no reader wired, fetch failed,
cache cold and the fetch slow) skips that scope: permissive on error, never
permissive on a missing end-user id, which is refused before enforcement runs.

Both surfaces read the same aggregate from the same materialised view (§4.5),
so they cannot disagree about what was spent, only about how recently they
looked. The bounded overshoot that follows from enforcing on a cached figure
is deliberate and is described in `budgets.mdx` under "The stale-snapshot
trade-off".

**The retired projective check.** This section used to specify
`POST /api/internal/gateway/budget/check`, a "tier 2 live reconciliation" the
gateway was to call whenever a cached scope came within 90% of its hard limit.
The control plane implemented it; no gateway release ever posted it, and no
other client did either. It is deleted. The service method behind it,
`GatewayBudgetService.check()`, is alive and called in process by the surfaces
that do need a projective answer: the CLI budget pre-check
(`GET /api/auth/cli/budget/status`) and the personal-budget screens.

### 4.5 Budget debit: derived from spend commands (no dedicated endpoint)

There is no `POST /api/internal/gateway/budget/debit`. Spend is derived from
the spend commands the gateway emits for every request (§4.9), and the
debits process manager on the `gateway_spend_processing` pipeline is the
only writer of the ledger. The flow:

1. The gateway admits every request before any gating runs, then confirms or
   fails it, emitting those commands through its local spool. Admission
   carries attribution and the end user; the outcome carries token
   quantities by class, the resolved model and provider, and, on a failure,
   the gateway's own taxonomy token.
2. The ingest route prices the outcome once, in integer nano-USD, and joins
   the admission to the attribution the gateway cannot see: the key's
   principal and the tenant project's team. The appended event carries both
   the price and the attribution from then on, so no consumer re-rates or
   re-resolves identity.
3. The debits process manager joins one request's admission to its outcome,
   resolves the applicable budgets (org, team, project, VK, principal, group
   and attributed-user scopes) and writes one row per applicable budget to
   the ClickHouse table `gateway_budget_ledger_events`, keyed by
   `(TenantId, BudgetId, GatewayRequestId)`. Each row stamps `ProviderKey`,
   the provider the request was dispatched to, read from the command's
   `model_provider_id`. A budget with a provider filter is only debited when
   that provider matches; a dispatch with no reported provider debits
   unfiltered budgets only, because attributing it to a named provider would
   be a guess.
4. A `gateway_budget_scope_totals_mv` AggregatingMergeTree materialised view
   aggregates `sumState(AmountUSD)` per `(scope, scope_id, window, period_start)`.
5. Enforcement reads `finalizeAggregation(sumMerge(SpendUSD))` against that
   materialised view, window-bounded by the current `PeriodStart`, through the
   two surfaces in §4.4: the totals baked into the config bundle and the
   per-end-user bucket read.

**Only successful rows accrue enforcement spend.** A failed request still
writes its rows, under `PROVIDER_ERROR` or, for the gateway's own guardrail
refusal, `BLOCKED_BY_GUARDRAIL`. Both the rollup view and the floored read
filter on `Status='success'`, so those rows are visibility only: they show
in a budget's activity list and never move a cap. This is deliberate. A
provider that errored after billing some tokens is a cost the operator
should see, but capping a customer on an attempt the platform failed to
serve would be the platform charging for its own outage.

A request that moved no money AND burned no tokens writes nothing at all.
Budget and guardrail refusals are the bulk of those, and a rejection storm
must not amplify into ledger writes that would sum to zero. Zero cost alone
is not the test: an unpriced model confirms at $0 with real tokens, and
those rows are written so the activity list still shows the request.

Idempotency is structural: ReplacingMergeTree's ORDER BY
`(TenantId, BudgetId, GatewayRequestId)` collapses any redelivery of the
same command (spool retry, drainer replay, manual backfill). No separate
dedup table or 24h window is required. The key holds no bucket, so it is
only sound while exactly one writer owns a budget's row for a given
request, which is why there is exactly one.

The Postgres `GatewayBudgetLedger` table is deprecated — the schema remains
for rollback safety but no code writes to it. `GatewayBudget` (the budget
*definition*) stays authoritative for limits/windows/on_breach.

**Buckets.** The ledger accumulates by `(Scope, ScopeId)`, so anything that
must accrue separately is separate in `ScopeId`:

| Budget | `ScopeId` written |
|---|---|
| Plain | the target id |
| Provider-filtered | `<targetId>\|provider:<modelProviderId>` |
| Group (per member) | `<groupId>:<userId>` |
| Group, provider-filtered | `<groupId>:<userId>\|provider:<modelProviderId>` |

Two budgets on the same target, one counting everything and one counting one
provider, would otherwise share a bucket and each report the other's spend.
The control plane computes these keys in `budgetResolution.service.ts`; the
gateway does not need to construct them, it receives them as `scope_id`.

**Group (GROUP-scoped) budgets require the ClickHouse spend path.** On deploys
without ClickHouse, `budget.check` falls back to the single Postgres
`GatewayBudget.spentUsd` column, one running figure per budget row. Per-member
buckets cannot be represented there: the fallback would enforce each member
against the whole group's combined spend. `GatewayBudgetService.create`
therefore refuses GROUP budgets with `group_budget_requires_clickhouse` when
no ClickHouse spend repository is wired (the same detection `check()` uses to
pick ClickHouse over the Postgres fallback). The other scope types keep
working on the fallback because their bucket is the budget row itself.

**Every key must resolve a trace project.** This is an observability rule,
not a spend one: debits ride the commands above and no longer depend on a
trace landing anywhere. VK create/update still refuse org/team-owned keys
with no resolvable trace project (`trace_project_required`); project-owned and
personal keys resolve one structurally, and org/team keys resolve the org's
governance project when it exists. A null `project_id` can still appear in
bundles for keys that predate the rule; the gateway skips span export for
those, which is exactly the hole the refusal stops new keys from entering.

**The ledger's `TenantId` is the key's own project**, the one carried on the
auth JWT, not the project its traces are exported to. The two differ for
org- and team-owned keys, whose traces fall back to the organization's
governance project. Enforcement is unaffected: every spend read spans all of
the organization's projects, so a bucket totals the same wherever its rows
landed.

**What key spend is read from.** Per-key spend shown to users (the keys
table's "Spent this month" column and the Usage tab) is NOT read from this
ledger. The ledger is per budget: it holds nothing for a key nobody capped,
and one row per budget for a key covered several times. Those surfaces read
`trace_summaries`, the enriched per-trace cost, keyed on
`langwatch.virtual_key_id`, deduped per trace. The ledger remains the source
for budget enforcement and for a budget's own debit list.

### 4.6 Provider-filtered budget enforcement

A budget with `provider_key` set constrains one vendor, not the request. At
check time (the Budget interceptor runs after Resolve, so the candidate
providers are known):

- A breached provider-filtered budget removes that provider from the
  candidate chain, exactly like provider unavailability.
- If candidates remain, the request is served by one of them and no
  budget error is returned. The exhausted filtered budget still rides
  `X-LangWatch-Budget-Warning` (provider-qualified, §5) so the caller
  hears why the routing changed.
- If the chain empties, the request is blocked with `budget_exceeded`,
  naming the budget that emptied it.
- With `routing_mode: "none"` the chain is length one, so this degenerates
  to a plain block.

Unfiltered budgets are unchanged: a breach blocks the request outright.

Every `budget_exceeded` envelope names its budget in `error.meta`:
`budget_id`, `budget_scope`, `budget_window`, plus `budget_provider` (the
ModelProvider id) when the block came from a provider-filtered budget
emptying the chain. The message states the scope and window in words, so an
agent client rendering only `message` still tells the user which allowance
to raise.

Two enforcement guarantees are the gateway's own, independent of what the
control plane materialises (defense in depth against a stale or hand-crafted
bundle): a request can never dispatch to a provider outside
`providers_allowed`, even when the credential chain still carries one, and
`routing_mode: "none"` pins the attempt budget to 1 at bundle decode even if
`fallback.max_attempts` disagrees.

### 4.6 `POST /api/internal/gateway/guardrail/check`

Inline guardrail call. Gateway pipelines multiple guardrails in parallel and aggregates.

Request:
```json
{
  "vk_id": "vk_01HZ...",
  "project_id": "proj_01HZ...",
  "gateway_request_id": "req_4f3c...",
  "direction": "request | response | stream_chunk",
  "guardrail_ids": ["guard_01HZ...", "guard_01HZ..."],
  "content": {
    "messages": [...],           // present when direction=request
    "output":   "...",           // present when direction=response
    "chunk":    "...",           // present when direction=stream_chunk
    "tools":    [...],
    "mcps":     [...]
  },
  "metadata": { "model": "gpt-5-mini", "principal_id": "user_01HZ..." }
}
```

Response:
```json
{
  "decision": "allow | block | modify",
  "reason": "PII detected: email",
  "modified_content": { "messages": [...] | "output": "..." | "chunk": "..." },
  "policies_triggered": ["pii-email", "prompt-injection"]
}
```

Gateway applies modifications **before** dispatch (request direction) or **before** returning to client (response/stream_chunk).

### 4.7 `GET /api/internal/gateway/health`

Connectivity probe backing the gateway's public `GET /health` status-page endpoint (`specs/ai-gateway/gateway-health.feature`). The gateway's statusprobe monitor calls this on its own clock (default every 15s per gateway node) and serves the cached verdict to public polls, so status-page traffic never reaches the control plane.

Riding the signed channel is the point: a 200 proves DNS/TCP/TLS, the app being up, and the shared HMAC secret matching. The gateway only reads the status code.

Response (200):
```json
{ "status": "ok" }
```

Any non-200 (including 401 on a secret mismatch) marks the probe failed.

---

## 5. Error envelope

All errors OpenAI-compatible:

```json
{
  "error": {
    "type":    "<type>",
    "code":    "<code>",
    "message": "<human-readable>",
    "param":   "<optional field name>"
  }
}
```

**Type enum (authoritative):**

| `type` | HTTP | When |
|---|---|---|
| `invalid_api_key` | 401 | Unknown, malformed, or non-existent VK |
| `virtual_key_revoked` | 403 | VK exists but is revoked. Terminal: revocation is one-way |
| `virtual_key_disabled` | 403 | VK exists but is disabled, the reversible stop. An administrator re-enables it and the same secret works again |
| `virtual_key_expired` | 403 | VK exists, is ACTIVE, and its `expires_at` has passed. The key material is intact: extending the date puts it straight back in service |
| `model_not_allowed` | 403 | VK has `models_allowed` glob allowlist and requested model is not in it, **or** matched `policy_rules.models` deny regex (or fell outside its allow regex); also when no alias/explicit form resolves to a configured provider |
| `permission_denied` | 403 | Principal lacks RBAC permission for endpoint |
| `budget_exceeded` | 402 | Any hard-cap budget scope is over limit |
| `rate_limit_exceeded` | 429 | VK / project / org rate limit hit |
| `guardrail_blocked` | 403 | Pre- or post-call guardrail returned `block` (post-block also records a zero-cost `blocked_by_guardrail` debit) |
| `guardrail_upstream_unavailable` | 503 | Guardrail evaluator service unreachable/errored; VK is fail-closed by default. Opt into fail-open per direction via `guardrails.{request,response}_fail_open: true` |
| `tool_not_allowed` | 403 | Requested tool/MCP matches VK `policy_rules.tools` or `policy_rules.mcp` (deny-wins, RE2) |
| `url_not_allowed` | 403 | Any `http(s)://` URL extracted from the request body matches VK `policy_rules.urls` deny (or falls outside a non-null `allow`) — extraction is permissive: user messages / tool args / system prompts / anywhere |
| `cache_override_invalid` | 400 | `X-LangWatch-Cache` header malformed or unknown mode |
| `cache_override_not_implemented` | 400 | `X-LangWatch-Cache` named a valid-but-v1.1 mode (`force` / `ttl=NNN`). v1 ships `respect` + `disable` only. |
| `provider_error` | 502 | Upstream provider returned error after fallback exhaustion |
| `upstream_timeout` | 504 | Upstream timed out after fallback exhaustion |
| `bad_request` | 400 | Validation error on incoming payload |
| `internal_error` | 500 | Unclassified gateway error |

**Response headers (all requests):**

- `X-LangWatch-Gateway-Request-Id: req_4f3c...`: opaque gateway request id, also emitted on errors and in OTel trace. Generated by the request-id middleware as `req_` plus 30 hex characters (`pkg/httpmiddleware/requestid.go`); a `gtwyreq_` ksuid appears only on the fallback path where no middleware id is in context. This is the id `gateway_request_id` carries on every spend event and webhook envelope, so it is the join key between a live response and its billing records.
- `X-LangWatch-Provider: openai|anthropic|...` — which provider was actually used (may differ from requested model due to fallback or alias).
- `X-LangWatch-Model: gpt-5-mini` — resolved provider model.
- `X-LangWatch-Cache: hit|miss|bypass|force` — cache outcome as observed by the gateway. (`force` is v1.1 — deferred with 400 cache_override_not_implemented in v1; header value matches the internal `Kind` enum in `services/gateway/internal/cacheoverride`.)
- `X-LangWatch-Cache-Mode: respect|disable` — echoes the cache-override mode that was applied to the request (independent of upstream outcome). Emitted on every `/v1/messages` response.
- `X-LangWatch-Budget-Warning: <scope>:<pct>`: optional, emitted on soft-cap breaches (can repeat). A provider-filtered budget qualifies the scope segment as `<scope>/<model_provider_id>` (e.g. `project/mp_01HZ:95`) so the warning names WHICH budget is running out; the percentage always sits after the only colon, so `split(":")` keeps parsing.
- `X-LangWatch-Fallback-Count: <n>` — number of fallbacks attempted before success (0 when primary succeeded).

---

## 6. Caching passthrough

**Default:** `respect` — gateway forwards Anthropic `cache_control` ephemeral/persistent blocks untouched, respects OpenAI prompt caching semantics, passes through Gemini's implicit cache markers. Usage costs correctly account for `cache_read` vs `cache_write` tokens (see §4.5 debit shape).

**Hard invariant — Anthropic cache_control passthrough:** the gateway MUST NOT strip, reorder, or rewrite any `cache_control` field in messages/content blocks when `mode=respect`. This is load-bearing for prompt-caching economics on Anthropic (saves 90% of input cost on cache hits). Integration tests must assert byte-equivalence of the forwarded payload for cache_control-carrying requests. When `mode=force`, we MAY add cache_control to large stable prefixes (system message, tool defs) but MUST NOT remove client-supplied markers.

**Override hierarchy (last-write-wins):**

1. Per-request header `X-LangWatch-Cache: respect | force | disable | ttl=3600` (highest precedence).
2. VK config `cache.mode` + `cache.ttl_s`.
3. Default `respect`.

- `respect` (v1) — pass through upstream cache controls as-is (byte-for-byte passthrough).
- `disable` (v1) — recursively JSON-walk the body and drop every `cache_control` object at any nesting depth (`messages[].content[]`, `system[]`, `tools[]` on Anthropic); disable gateway semantic cache; force cold call. Applied **before** policy-rule enforcement so policy evaluation runs on the post-strip body and is deterministic regardless of caller's caching choice.
- `force` / `ttl=NNN` — **deferred to v1.1**. Valid syntax is accepted by the parser but currently rejected with `400 cache_override_not_implemented`. Provider-specific body mutation (where to inject cache_control, how to respect TTL) ships alongside gateway-side semantic caching.

**Observability:** `X-LangWatch-Cache` response header reports outcome. Token counts in OTel trace use OpenTelemetry GenAI semconv: `gen_ai.usage.cache_read.input_tokens` and `gen_ai.usage.cache_creation.input_tokens` are set separately so trace UI can show cache economics. Proprietary `langwatch.usage.cache_*_tokens` attrs were dropped in Lane A iter 42 per "OTEL semconv all the way".

---

## 7. Fallback chain

Triggers are **fixed, not per key**. The classification lives in one function, `classifyProviderError` in `services/aigateway/app/dispatch.go`, and is derived from the real upstream outcome; the retry engine's trigger set is `defaultTriggers` in `pkg/retry/retry.go`. A per-key trigger list could only ever narrow the set, and every narrowing turns a failure the gateway would have recovered from into a customer-visible one, so the wire carries no such field (§4.2).

- `5xx`: any upstream 5xx, and any provider error the adapter could not classify more precisely.
- `timeout`: the provider adapter reports the upstream never answered. A provider-reported `504` arrives as a status and classifies as `5xx`, which is retryable either way; the two differ only in the reason recorded on the attempt.
- `rate_limit_exceeded`: upstream 429.
- `network_error`: connection reset / DNS / TLS.
- `404 Not Found`: in a multi-provider chain this usually means "this provider does not serve that model" (common with custom and OpenAI-compatible providers), and the next slot may.
- `circuit_breaker`: gateway-internal circuit breaker trips after N consecutive failures against a provider in the last M seconds. Not a response trigger, it preempts attempts.

**Does NOT trigger fallback** (terminal, and returned as-is). Terminal is not the same as the caller's fault: a `401` or `403` is usually the operator's provider credential, and the point of not masking it is that switching credentials would hide the thing they have to fix.

- `400 Bad Request` from upstream (malformed payload).
- `401 Unauthorized` from upstream (provider credential bad: surface to customer so they fix their provider creds; don't mask by silently switching).
- `403 Forbidden` from upstream.
- Every other terminal 4xx.
- A bare context cancellation or deadline: the CALLER abandoned the request, which is not a provider verdict, so it neither falls back nor feeds the circuit breaker.
- `invalid_api_key` / `permission_denied` from our own auth layer (never reaches fallback).

Behaviour:

- Gateway iterates `fallback.chain` in order, calls next provider with same payload translated via bifrost/core.
- After `max_attempts` exhausted, returns the last provider's mapped error envelope.
- Streaming: if primary fails **before** first chunk emits, fall back transparently. If primary fails **mid-stream**, return `provider_error` with partial response (never silently switch mid-stream; that would confuse the client).
- OTel trace records the full attempt chain as nested spans, each tagged `langwatch.fallback.attempt=N` and `langwatch.fallback.reason`.

Idempotency: gateway does **not** retry POST unless upstream responded before headers sent (avoids double-spend of expensive calls).

---

## 7b. Streaming contract (SSE)

- **Pre-first-chunk mutations allowed:** gateway may inject response headers (e.g. `X-LangWatch-Gateway-Request-Id`, `X-LangWatch-Provider`), run pre-call guardrails that modify the request payload, and transparently switch providers via fallback.
- **Post-first-chunk immutability:** once the first byte has been emitted to the client, the gateway MUST pass through subsequent SSE chunks byte-for-byte from the upstream provider. No reordering, no delta merging, no re-chunking. Coding CLIs (Claude Code, Codex) depend on exact tool-call delta shapes.
- **Mid-stream failure:** if the upstream connection drops mid-stream, the gateway closes the client connection (rather than silently switching to a fallback, which would produce a Frankenstein stream). A terminal SSE `error` event is emitted with `type: provider_error`.
- **Post-response guardrails (stream case):** run on the **reassembled full stream** after the client connection closes. Non-blocking to the response. If a guardrail flags the completed response, emit an OTel trace attribute (`langwatch.guardrail.post_flag`) but do not retroactively alter the response; for real-time redaction, use `direction: stream_chunk` guardrails which gate each chunk before it's emitted.
- **Stream-chunk guardrails:** invoked only on chunks with visible delta text (role-only frames, tool-call deltas, terminal usage frames skip the call — ~95% of frames). Decision `block` terminates the stream with a byte-locked terminal `event: error` frame: `{"error":{"type":"guardrail_blocked","code":"stream_chunk_blocked","message":"<reason>","param":null}}` — wire shape matches provider-failure terminator, distinguishable by `code`. Decision `modify` is **not implemented in v1** (chunk-level rewriting is provider-shape-specific; deferred pending real customer ask). Latency budget per chunk ≤50ms; slow or errored guardrails **fail open** — chunk passes through and `gateway_guardrail_verdicts_total{direction=stream_chunk,verdict=fail_open}` + OTel `langwatch.guardrail.stream_chunk_fail_open=<reason>` surface the degradation. Never block the user's stream on a slow policy service.

---

## 8. Per-tenant OTel routing

Every request emits a LangWatch trace to the **tenant's own project** even though the gateway is multi-tenant.

Pattern (from Bifrost `ObservabilityPlugin.Inject(trace)`):

1. Gateway attaches `langwatch.project_id`, `langwatch.team_id`, `langwatch.org_id`, `langwatch.principal_id`, `langwatch.vk_id` as attributes to every trace.
2. Our OTel exporter reads `langwatch.project_id` and routes the OTLP export to `otel.langwatch.ai/v1/traces` with the project's collector token injected via control-plane lookup (cached).
3. For self-hosted: single OTel endpoint (`$LANGWATCH_OTEL_ENDPOINT`) with project attribution in span attributes (existing LangWatch ingest already handles this).

---

## 9. Auth cache strategy (gateway side)

Documented here so Go code + infra agree:

1. **L1 in-memory LRU:** 10k entries by default (`Options.LRUSize`; the chart's `cache.lruSize` is not wired yet). Resolved JWT cached by SHA-256(vk_plain). Zero-RTT hot path. One per pod, shared with nothing: a cross-node tier buys a warm start that a rolling deploy pays for anyway, and costs an invalidation path that has to reach it.

   JWT `exp` bounds normal freshness, it is not the eviction point. Past `exp` an entry is refreshed before it serves, and if that refresh fails for transport reasons the entry keeps serving while its soft expiry is bumped, up to a hard cap of `exp + LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS` (default 6h, negative disables the grace entirely). An auth-class rejection evicts immediately at any point.
2. **Bootstrap-pull (enterprise opt-in):** on startup, gateway calls `GET /api/internal/gateway/bootstrap` → paginated stream of all non-revoked VKs' JWTs. Enables gateway to serve traffic when control-plane is offline. Flag: `LW_GATEWAY_BOOTSTRAP_PULL=true`, the same name §6 uses. Nothing reads it yet, so it is a name this document reserves rather than one the binary honors.

Background refresh: single goroutine long-polls `/api/internal/gateway/changes?since=<rev>` with 25s timeout. On diff → re-fetch affected VK configs and invalidate the matching L1 entries.

Config staleness is bounded by a TTL refresh underneath the change feed, and that refresh is conditional: it sends `If-None-Match: <etag>` to §4.2 and takes the 304 as "keep the bundle, restart the staleness clock". A key nobody changed costs the control plane a revision lookup rather than a full config materialization.

The same refresh bounds the staleness of the key's own expiration date, which §4.2 carries as `expires_at`. The token claim `vk_expires_at` is the mint-time floor and the config channel is the update path, so a date an admin shortens or extends reaches the gateway within one ConfigTTL even while the change feed is unavailable. A response with no `expires_at` field comes from a control plane older than it, and the gateway then keeps the date its bundle already holds; reading absent as "no expiry" would lift the cap off a key whose own token says it expires.

No filesystem-persisted secrets. JWTs and configs are in-memory only; on restart we re-fetch.

---

## 10. Permissions (RBAC)

Alexis owns the final shape in Prisma schema; this is the agreed surface.

**Convention:** LangWatch permissions follow 2-segment `resource:action` (see `src/server/license-enforcement/member-classification.ts`). We keep that — no 3-segment namespacing.

**New resources (+ actions):**

- `virtualKeys: view | create | update | delete | manage | rotate`
- `gatewayBudgets: view | create | update | delete | manage`
- `gatewayProviders: view | manage` (gateway-only settings layered on existing ModelProvider)
- `gatewayCacheRules: view | create | update | delete | manage` (Lane B iter 38 — org-scoped cache-control rule CRUD)
- `gatewayGuardrails: attach | detach`
- `gatewayLogs: view` (per-project access to gateway request logs)
- `gatewayUsage: view` (cost/usage reports)

`manage` is the superset action within a resource (matches existing `project:manage` convention).

**Default role mappings (subject to review):**

- Organization admin → all `*:manage` for gateway resources.
- Project admin → `virtualKeys:manage`, `gatewayBudgets:manage`, `gatewayProviders:manage`, `gatewayGuardrails:attach|detach`, `gatewayLogs:view`, `gatewayUsage:view` scoped to their project.
- Developer → `virtualKeys:view|create|update|rotate` for their own VKs, `gatewayBudgets:view`, `gatewayLogs:view`.
- Viewer → `virtualKeys:view`, `gatewayBudgets:view`, `gatewayLogs:view`, `gatewayUsage:view`.

Scoping rules follow the existing project/team/org hierarchy already in LangWatch RBAC — no new scope primitives.

---

## 10b. Cross-references — per-lane specs

Each lane's feature file elaborates the contract with testable scenarios. Keep these in sync:

- `specs/ai-gateway/virtual-keys.feature` — VK CRUD, show-once-secret, peppered HMAC-SHA256 hashing (§2), provider-creds linking, fallback chain, rotation/revoke, RBAC, attribution, internal endpoints (resolve-key JWT + config/:vk_id ETag + /changes long-poll).
- `specs/ai-gateway/budgets.feature`: hierarchical scopes (org/team/project/vk/principal), windows (min→total), `on_breach: block|warn`, spend-command ClickHouse debits (idempotent by `gateway_request_id`), timezone-aware resets.
- `specs/ai-gateway/gateway-provider-settings.feature` — ModelProvider IS the single source of truth (no separate `GatewayProviderCredential` binding); gateway-only settings (rate limits, rotation policy, gateway-only extraHeaders) live on the ModelProvider Advanced (Gateway) tab and must not leak into the legacy litellm path.
- `specs/ai-gateway/epic.feature`: cross-cutting E2E scenarios (end-to-end request through gateway → fallback → spend-command debits → per-tenant OTel emit).
- `specs/ai-gateway/` (pending, Lane A): `gateway-service.feature`, `health-checks.feature`, `auth-cache.feature`, `provider-routing.feature`, `caching-passthrough.feature`, `fallback.feature`, `streaming.feature`, `guardrails.feature`.

When a spec and this contract disagree, **the contract wins** and the spec is amended (after consensus in #langwatch-ai-gateway).

---

## 11. Cohesion with existing provider settings

LangWatch already stores `ModelProvider` rows (OPENAI_API_KEY etc) for evaluators/playground via litellm. We do **not** duplicate these.

- VK config's `model_providers[].id = mp_...` references the `ModelProvider` row directly (no binding table). The materialiser decrypts `ModelProvider.customKeys` (per-org KMS) at bundle-emit time and embeds the cleartext as `model_providers[].credentials` JSON — gateway never sees encrypted bytes on the wire.
- Multi-deployment scenarios (Azure regions, OpenAI base-url variants) are modelled as sibling `ModelProvider` rows — there is no `slot` enum.
- Playground / evaluators continue to use litellm path (untouched). Gateway uses bifrost/core. Keys are shared, paths are separate. No litellm migration in this epic.
- A VK can optionally expose itself as a provider inside the playground (`"Use this virtual key in playground"` toggle) — post-MVP nice-to-have, not blocking.

---

## 11b. Policy-rules enforcement

Evaluated at the gateway **before** dispatch to the upstream provider. Each pattern set has `deny` (regex allowlist of what to reject) and `allow` (regex, if non-null behaves as an allowlist — only listed patterns pass).

- **`tools`** — checked against every `tools[].function.name` in the request (OpenAI format) and every `tools[].name` (Anthropic format). First match in `deny` → 403 `tool_not_allowed` with `policies_triggered: ["policy_violation_tools"]`. If `allow` is non-null, any tool name not matching an `allow` entry is blocked.
- **`mcp`** — checked against the `mcp_servers[].name` and `mcp_servers[].url` if the request declares MCP servers. Same allow/deny semantics.
- **`urls`** — checked against any URL found inside tool-call arguments that look like outbound HTTP (heuristic: field name matches `/url|endpoint|uri/i`). Primarily advisory; hard enforcement requires egress proxy and is post-MVP.
- **`models`**: evaluated **post-resolution**, against the model the resolver settled on, not the string the caller sent. It runs a step later than the other three, inside the model-resolve stage, because only there is the real model known. Both spellings of the resolved model are judged (bare id and `provider/model`), so a rule written either way reaches the same model. Two consequences follow and are the point: an alias pointing at a denied model **is** blocked, and a deny on a raw name that resolves elsewhere does **not** block, because nothing denied ever runs.

The other three dimensions stay on the request body as sent: tools, MCP servers, and URLs are properties of what the client wrote, and resolution does not change them.

OTel trace records each block with span attribute `langwatch.policy.violation=<kind>:<pattern>`.

---

## 11c. Trace propagation headers

The gateway sits in the critical path of every LLM call. Without trace propagation, every gateway span would spawn its **own** LangWatch trace — which double-counts cost (once on the caller's trace, once on the gateway's trace) and breaks the causality link from an application span to its LLM call.

To avoid this, the gateway **honours incoming trace context** on every request:

| Header | Meaning |
|---|---|
| `traceparent` (W3C Trace Context) | Standard `00-<trace_id>-<parent_span_id>-<flags>`. If valid, gateway emits its span as a child of `parent_span_id` on `trace_id`. |
| `tracestate` (W3C) | Carried through verbatim to upstream OTel export. |
| `X-LangWatch-Trace-Id` | LangWatch-native trace id override. Wins over `traceparent` if both set. |
| `X-LangWatch-Parent-Span-Id` | LangWatch-native parent span id. |
| `X-LangWatch-Thread-Id` | Optional conversation thread id; carried on the span as `langwatch.thread_id`. |
| `X-LangWatch-Trace-Metadata` | JSON object merged into the span's custom metadata. |

If **no** trace headers are present, the gateway creates a new trace and emits **`X-LangWatch-Trace-Id: <trace_id>`** and **`X-LangWatch-Gateway-Request-Id: req_…`** on the response so the caller can stitch later if desired.

If the caller wants to keep traces independent (rare — e.g. a shared internal gateway that shouldn't expose its trace graph to callers), simply don't set the headers. No double-cost attribution in this case because the caller's side has no LLM span — only the gateway does.

**SDK pass-through** (client-side): the OpenAI Python SDK, OpenAI TypeScript SDK, and Anthropic SDK all accept `extra_headers={}` on every method. The LangWatch Python/TS SDKs expose helpers to set these automatically when an active trace is in scope.

Example (Python, OpenAI SDK):

```python
import langwatch
from openai import OpenAI

client = OpenAI(base_url="https://gateway.langwatch.ai/v1", api_key=LW_VK)

with langwatch.trace(name="my-agent-turn") as trace:
    resp = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[...],
        extra_headers=langwatch.get_gateway_headers(),   # injects traceparent + X-LangWatch-* automatically
    )
```

`langwatch.get_gateway_headers()` is a new helper in the LangWatch SDK (ships in post-v1 SDK release alongside the gateway GA); it reads the active trace and formats the W3C + LangWatch-native headers.

---

## 12. Public REST API (for CLIs and external integrations)

In addition to the internal `/api/internal/gateway/*` endpoints (gateway ↔ control-plane, §4), LangWatch exposes a **public REST API** for gateway resource CRUD at `/api/gateway/v1/*`. This is what the `langwatch` CLI and any external automation uses.

Auth: existing LangWatch API tokens (personal access or service-account) presented as `Authorization: Bearer pat_...`. Permissions gated by the `virtualKeys:*`, `gatewayBudgets:*`, `gatewayProviders:*` scopes on the token.

**Endpoints (canonical shapes):**

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/gateway/v1/virtual-keys` | List VKs in a project | `virtualKeys:view` |
| `POST` | `/api/gateway/v1/virtual-keys` | Create VK (returns full secret once) | `virtualKeys:create` |
| `GET` | `/api/gateway/v1/virtual-keys/:id` | Get VK (secret not returned) | `virtualKeys:view` |
| `PATCH` | `/api/gateway/v1/virtual-keys/:id` | Update config (aliases, budgets, guardrails, providers) | `virtualKeys:update` |
| `POST` | `/api/gateway/v1/virtual-keys/:id/rotate` | Rotate secret (returns new secret once) | `virtualKeys:rotate` |
| `POST` | `/api/gateway/v1/virtual-keys/:id/revoke` | Revoke | `virtualKeys:delete` |
| `GET` | `/api/gateway/v1/budgets` | List budgets | `gatewayBudgets:view` |
| `POST` | `/api/gateway/v1/budgets` | Create budget | `gatewayBudgets:create` |
| `PATCH` | `/api/gateway/v1/budgets/:id` | Update | `gatewayBudgets:update` |
| `DELETE` | `/api/gateway/v1/budgets/:id` | Delete | `gatewayBudgets:delete` |
| `GET` `POST` | `/api/gateway/v1/providers` | Tombstone. Gateway provider bindings folded into ModelProvider in iter 110, so all four answer `410 Gone` with `gateway_provider_bindings_gone` and point at `/api/model-providers` | n/a |
| `PATCH` `DELETE` | `/api/gateway/v1/providers/:id` | Tombstone, same as above | n/a |
| `POST` | `/api/gateway/v1/virtual-keys/:id/disable` | Reversible stop (distinct `virtual_key_disabled` on use; grace preserved) | `virtualKeys:update` |
| `POST` | `/api/gateway/v1/virtual-keys/:id/enable` | Reverse of disable; restores the key exactly as it was | `virtualKeys:update` |
| `GET` | `/api/gateway/v1/virtual-keys/:id/spend` | Per-key spend + request count over a window | `gatewayUsage:view` |
| `POST` | `/api/gateway/v1/budgets/:id/reset` | Move the period boundary; never mutates recorded spend; `?end_user_id=` for one template bucket | `gatewayBudgets:update` |
| `GET` | `/api/gateway/v1/end-users/:id/spend` | Rolling-window usage rollup + the applicable template caps at their current-period spend; org key, billing surface | `gatewaySpend:view` |
| `GET` | `/api/gateway/v1/cache-rules` | List cache rules, cursor-paged | `gatewayCacheRules:view` |
| `POST` | `/api/gateway/v1/cache-rules` | Create a cache rule | `gatewayCacheRules:create` |
| `GET` | `/api/gateway/v1/cache-rules/:id` | Get one cache rule | `gatewayCacheRules:view` |
| `PATCH` | `/api/gateway/v1/cache-rules/:id` | Update a cache rule | `gatewayCacheRules:update` |
| `DELETE` | `/api/gateway/v1/cache-rules/:id` | Delete a cache rule | `gatewayCacheRules:delete` |
| `GET` | `/api/gateway/v1/spend-events` | Read the spend event log, cursor-paged and filterable by key, end user, model, and status | `gatewaySpend:view` |
| `POST` | `/api/gateway/v1/spend-events/replay` | Re-deliver a window of spend events to the subscribed webhook endpoints | `gatewaySpend:manage` |
| `GET` | `/api/gateway/v1/spend-summaries` | Aggregated spend over a window, grouped by the requested dimension | `gatewaySpend:view` |
| `GET` | `/api/gateway/v1/openapi.json` | This API's OpenAPI description | none, deliberately public |

**Response shape convention:** snake_case (`virtual_key_id`, `created_at`) to match the OpenAI / Anthropic API aesthetic that external integrations already expect.

**Error envelope:** identical to the gateway data-plane error envelope (OpenAI-compatible). Type enum extended with `resource_not_found` (`404`) and `validation_error` (`422`).

**Shared service layer:** the Hono REST routes and the internal tRPC routes **both** call the same `VirtualKeyService`, `GatewayBudgetService`, `ModelProviderService`. No business logic is duplicated. Only the DTO-shape helpers differ (snake_case for REST, camelCase for tRPC) and they live in a shared mapper module (`src/server/gateway/mappers/`).

**OpenAPI spec:** generated into `platform/app/src/app/api/openapiLangWatch.json` by `pnpm run task generateOpenAPISpec`, served unauthenticated at `/api/gateway/v1/openapi.json` (also at `/.well-known/openapi` and `/api/openapi.json` — see `packages/api/specs/api-discovery.feature`), and published on the docs site. `pnpm check:openapi-completeness` gates the generated document over both `/api/gateway/v1` and `/api/webhooks/v1`: every body-accepting write declares a `requestBody`, every operation whose handler reads the query string declares its query parameters, and every operation declares a 2xx response carrying a schema. Exemptions live in `platform/app/scripts/check-openapi-completeness.ts` as data with a reason per entry, and an entry that stops excusing anything fails the check. A second gate complements it: `pnpm check:openapi-route-coverage` audits the other direction — every registered route reaches the document or carries a written exclusion (see `packages/api/specs/openapi-route-coverage.feature`).

## 12b. Billing events, webhooks, and end-user attribution (2026-07)

The billing platform's wire-locked contracts. Feature files: `billing-spend-events.feature`, `gateway-spend-rest.feature`, `end-user-attribution.feature`, `specs/webhooks/webhook-endpoints.feature`, `specs/webhooks/webhook-settings-ui.feature`.

**End-user capture.** Resolution precedence on the request: `x-langwatch-end-user-id` header, then `x-litellm-end-user-id` (migration alias), then the OpenAI `user` body field; headers beat body. One resolver feeds spend admission and budget enforcement. Caller metadata echo: `x-langwatch-metadata` header (JSON object, 4 KB cap) returns verbatim as `metadata` on the request's spend event. Fail-closed rule: an active `ATTRIBUTED_USER` template + no resolvable end-user id rejects with `error.code = "end_user_required"` naming both wire fields.

**Spend record.** One per gateway request, keyed by the `gateway_request_id` ULID (also the `X-LangWatch-Gateway-Request-Id` response header). Envelope `{id, type, created, schema_version: "1", data}`; ids are type-suffixed (`<gateway_request_id>:completed` / `:settled`) so the settled/completed pair never collides in consumer dedup while `data.gateway_request_id` joins it. `data`: org/project/vk/principal/end-user attribution, trace id, model + `model_provider_id`, `request_type`, `usage` (5 integer token classes), `cost` (`total_usd` string, `nano_usd` int64, `rate_version`), `status` (`success|error|admitted|settled`), `error {class, http_status}`, `duration_ms`, `labels`, `metadata`. Settled events (grace default 30 min, `LW_SPEND_SETTLEMENT_GRACE_MS`) carry null `usage`/`cost`/`duration_ms`, `needs_reconciliation: true`, `settle_reason`; a later completed event for the same request id supersedes: consumers REPLACE, never sum. `occurred_at` is request time. Money: integers, summed as integers, rounded once at invoice.

**Delivery.** Body `{"batch": [envelope, ...]}` (up to `max_batch_size`). Headers: `X-LangWatch-Delivery-Id` (delivery id, NOT an event id: one delivery carries many envelopes, so consumer dedup is on the envelope `id` in the body), `X-LangWatch-Signature: t=<unix>,v1=<hex hmac-sha256(secret, "<t>.<raw body>")>` (5-min tolerance, raw-bytes verification, constant-time compare; `v1` REPEATS during a secret rotation, one per valid secret newest first, and a receiver must accept a match against any of them), `X-LangWatch-Delivery-Attempt`, `X-LangWatch-Test-Fire` on tests. `roll-secret` keeps the previous secret valid for 24h and signs with both, mirroring the gateway JWT's {current, previous} verification key set. 2xx acks; 5xx/429/408 retry honoring `Retry-After`; other statuses terminal; redirects refused. Ladder 1m/5m/30m/2h/6h/12h then 12h cadence, 11 attempts, last inside 72h. 72h of unbroken failures auto-disables (`disabled_reason: "auto_failures_72h"`); re-enable does not re-send the gap, replay covers it. Per-endpoint controls with server bounds: `max_batch_size` 1-100, `max_batch_delay_ms` 0-60000, `max_in_flight` 1-8. Health headline: `oldest_undelivered_age_ms`. Delivery log retained 30 days. SSRF: private/loopback always blocked; `WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS=1` relaxes only that fence.

**Event catalog (family `gateway`).** `gateway.request.completed|settled`; `gateway.budget.threshold_crossed|breached` (80 percent threshold; breached fires on `warn` budgets too; once per crossing per period, the envelope id embeds `<budget>:<bucket>:<kind>:<period_started_at_ms>`); `gateway.virtual_key.created|rotated|disabled|enabled|revoked`. Selectors: exact type, `gateway.*`, `*`; an exact selector must name a registered type, so every emitted type carries a registry entry.

**Org-key REST (enterprise flag `webhookEndpointsEnabled`; org-exclusive permissions).** `/api/webhooks/v1/endpoints*` CRUD + `roll-secret` + `test` + `deliveries` + `health` (`webhookEndpoints:manage|view`), `/api/webhooks/v1/event-types` + `/events` (view). `/api/gateway/v1/spend-events` (RANGED pull: `from`/`to` unix ms required, safe ints, `from <= to`; cursor stable under live writes; garbled cursor 400; status filter incl `admitted`) + `/spend-summaries` (`group_by=virtual_key|end_user`, `event_count` + `settled_count` separate, settled never in cost sums) under `gatewaySpend:view`; `/spend-events/replay` (`{from, to, endpoint_id}`, 7-day window cap, 10k envelope cap, original envelope ids, honors subscriptions) under `gatewaySpend:manage`. Spend retention: fixed 13 months, exempt from tenant retention and the TTL reconciler (pinned by unit test).

## 13. Open questions (to resolve in next iterations)

- [x] **Self-host JWT secret rotation:** how do helm chart + control-plane agree on `LW_GATEWAY_JWT_SECRET` rotation without downtime? — **Resolved in iter 25 (`921365f`).** Gateway's JWT resolver accepts `jwt.VerificationKeySet{current, previous}` when `LW_GATEWAY_JWT_SECRET_PREVIOUS` is set. Helm chart conditionally renders the second `secretKeyRef`. Operator flow is 4 steps: flip control plane → add previous to gateway → rolling restart → remove previous after ~15 min. Startup `jwt_secret_rotation_active` WARN log keeps rotation windows from running indefinitely. See [Self-Hosting → Secret rotation](/ai-gateway/self-hosting/config#secret-rotation-iter-25-921365f).
- [ ] **Streaming fallback semantics:** the mid-stream policy above is conservative; verify Portkey / Helicone behaviour. — @andr competitor research.
- [ ] **Budget windows & timezone:** `day` window in whose tz — org's or UTC? — default UTC, org-level override. — @alexis Prisma field.
- [ ] **Multi-region gateway routing:** do we need region-pinning for data residency? — @sergey + infra.
- [x] **Webhook for budget breach:** shipped as the webhook endpoints platform (§12b): `gateway.budget.threshold_crossed` / `gateway.budget.breached` families, once per crossing per period.

---

## 13. Changelog

- **v0.1 (2026-04-18)** — Initial draft consolidated from @sergey + @alexis proposals. @andr ships as base for iteration.
- **v0.1.1 (2026-04-19)** — Audit for iters 17–22 drift. Wire contract unchanged: §4.3 `/changes` already documents `organization_id` as required (iter 17 landed against this). Iters 18 (NetworkPolicy), 19 (gateway-CI), 20 (startup netcheck), 21 (outbox metrics), 22 (admin bearer-token) are all deployment/operational — they don't alter any wire surface documented in §§3–12. No contract changes required.
- **v0.1.2 (2026-04-19)** — Close §13 open question on JWT rotation. Iter 25 (`921365f`) ships dual-key `jwt.VerificationKeySet` acceptance via `LW_GATEWAY_JWT_SECRET_PREVIOUS`; operational procedure documented in self-hosting/config.mdx + helm.mdx. Iters 23 (body cap), 24 (graceful drain), 25 (JWT rotation) are deployment/operational — no wire surface drift.
- **v0.1.3 (2026-04-19)** — Audit for Lane A iters 26–38 + Lane B iters 23–33. **No wire contract changes.** What landed:
  - Lane A: slowloris HTTP server timeouts (iter 26), SRE observability `gateway_effective_config` + `X-LangWatch-Gateway-Version` header (iter 27), docker CI publishing to `ghcr.io/langwatch/ai-gateway` (iter 35), chart ghcr.io default + helm.mdx port fixes (iter 36), lw-dev helm install runbook (iter 37), live gateway smoke vs running control plane (iter 38). All operational or CI-scoped.
  - Lane B: VK/budget/provider edit drawers polish, VK drawer capability preview (iter 23), DashboardLayout wrapping (iter 24), `observability_endpoint` override removal (iter 25), BigInt audit serialization fix (iter 27), shared `auditSerializer.ts` (iter 28), `LOCAL_DEV_BYPASS_AUTH` endpoint removal (iter 28), MainMenu expandable gateway group (iter 29), unique per-child icons (iter 29.1), PageLayout.Container refactor (iter 30), `defaultExpanded` on CollapsibleMenuGroup + `/gateway/audit` sub-nav drop (iter 31), multitenancy middleware exempt list for org-scoped gateway models (iter 32), regression tests (iter 33). All UI/control-plane-internal.
  - Public wire (§§3–12) unchanged. Gateway response headers unchanged. `/api/internal/gateway/*` signing + replay window unchanged. VK format unchanged. Permission names unchanged.
  - §§7.2+7.3 confirm the `observability_endpoint` removal: per-tenant trace attribution still real (via `langwatch.project_id` span attribute → LangWatch ingest files under owning project), only the customer-override surface removed. No bundle field drift — `observability_endpoint` never shipped on the bundle.
- **v0.1.4 (2026-04-19)** — Audit for Lane A iters 39–44 + Lane B iters 34–40. Three wire-surface changes land cleanly:
  1. **Cache-token semconv rewrite (§6 + §12 observability)** — Lane A iter 42 (18f7d8b07) drops proprietary `langwatch.usage.cache_read_tokens` / `langwatch.usage.cache_write_tokens` span attrs in favour of OTel GenAI semconv: `gen_ai.usage.cache_read.input_tokens` + `gen_ai.usage.cache_creation.input_tokens`. Explicit ABSENT assertion in `caching-passthrough.feature` (iter 42 guarantees proprietary names are gone, not just dual-emitted). Ingest path (`otel.traces.ts:951-967`) reads semconv-only. Dropped 4 stale "forced" → "force" X-LangWatch-Cache-Mode references in docs/specs (the Go `cacheoverride.Kind` enum never had a past-tense value — single source of truth is `services/gateway/internal/cacheoverride/override.go:42-44`).
  2. **Cache-rules full stack (§6 extended)** — Lane B iter 38 (2ef1dbd42): `GatewayCacheRule` PG model + service + tRPC + RBAC + audit + multitenancy exemption. Lane B iter 39 (bb9c8ebe8): `config.materialiser.bundleFor(orgId)` emits cache-rules into the VK bundle pre-sorted priority DESC, enabled=true, archived=null. Lane B iter 40 (73552f964): `/gateway/cache-rules` list + create/edit drawers + matcher summary + colour-coded action badges + precedence copy + inline enable toggle + archive from row menu. Matcher shape `{vk_id?, vk_tags?, vk_prefix?, principal_id?, model?, request_metadata?}` + action shape `{mode: respect|force|disable, ttl?, salt?}` wire-locked. `GatewayChangeEvent` emits on every write so /changes long-poll triggers bundle refresh ≤30s. BDD spec `cache-control-rules.feature` §§1–7 cover precedence / matchers / actions / hot-path / observability / RBAC / UI — 29 scenarios total. Go evaluator (`internal/cacherules/eval.go`) still in Lane A's queue; when it lands it reads `bundle.cache_rules` linearly → first-match-wins → emits `langwatch.cache.rule_id` + `gateway_cache_rule_hits_total` per spec §5.
  3. **Helm chart lw-dev smoke (§11 self-hosting)** — Lane A iter 44: ECR push + `helm upgrade --install gateway-smoke ./charts/gateway` on lw-dev EKS; pod Running, /healthz 200 with `X-LangWatch-Gateway-Version` + `X-LangWatch-Request-Id` headers present. /readyz 503 is expected until the langwatch-app Deployment gets `LW_GATEWAY_INTERNAL_SECRET` via local `terraform apply` on lw-dev (mirroring the `infra-env-development.yaml` CI pipeline). rchaves clarification logged: validate-on-lw-dev-before-merge, prod apply stays CI-only via saas PR merge.
  - No wire contract changes on §§3–5 (VK format, auth, endpoints, /api/internal/gateway/*). Permission names updated: §9 RBAC adds `gatewayCacheRules` resource with `:view / :create / :update / :delete / :manage` (default MEMBER = view-only; ADMIN = full CRUD + :manage).
- **v0.1.6 (2026-07-31)** §12b added: the billing events platform contracts (end-user capture precedence, metadata echo, the spend record and settled supersession, the signed delivery contract with ladder and bounds, the event catalog, the org-key REST families, the 13-month retention exemption). §12 table: the phantom `GET /usage` row replaced with the real per-key spend read, and the disable/enable/reset/end-user-spend routes added. §13 webhook-for-budget-breach open question closed as shipped.
- **v0.1.5 (2026-07-27)** Gateway enforcement for budgets on every dimension (Wave 2 of the n x n budgets work; bundle fields landed in Wave 1). §4.6 is now live in the Go gateway: a breached provider-filtered blocking budget removes its provider from the candidate chain at dispatch, an emptied chain blocks with `budget_exceeded` naming the budget (`error.meta.budget_id` / `budget_scope` / `budget_window` / `budget_provider`), and the exhausted vendor rides the §5 warning header with a provider-qualified scope segment (`<scope>/<model_provider_id>:<pct>`). The gateway stamps `langwatch.model_provider_id` (ModelProvider row id of the dispatched credential) on every customer span, which is what lets §4.5 step 3 attribute debits to provider-filtered buckets. Defense in depth added gateway-side: dispatch refuses providers outside `providers_allowed` even when a stale bundle chain still carries them, and `routing_mode: "none"` re-pins `max_attempts` to 1 at bundle decode. GROUP buckets enforce as materialised (one per member, principal resolved by the control plane); no gateway-side bucket construction. Contract tests in `services/aigateway/adapters/controlplane/budgets_contract_test.go` pin both sides of the bundle fields, the bucket separators, and the span attribute read path.
