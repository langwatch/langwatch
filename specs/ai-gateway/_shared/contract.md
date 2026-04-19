# LangWatch AI Gateway — Shared Contract

**Status:** Draft v0.1 (iteration 1, Ralph loop)
**Owners:** @ai_gateway_andr (document), @ai_gateway_sergey (Go gateway), @ai_gateway_alexis (Platform/DB)
**Purpose:** Single source of truth for every wire-level decision shared between the Go gateway service (`langwatch-saas/services/gateway`) and the LangWatch platform control-plane (`langwatch/langwatch`). Every BDD spec in `specs/ai-gateway/` must agree with this file. Disagreements get resolved here first, code changes second.

---

## 1. Repo & service layout

| Component | Repo | Path |
|---|---|---|
| Go gateway service (data plane) | `langwatch-saas` | `services/gateway/` (new standalone `go.mod`) |
| Platform control-plane (VK CRUD, budgets, RBAC, provider-settings cohesion, drawers) | `langwatch` (open-source) | `langwatch/langwatch/src/...` |
| BDD specs | `langwatch` | `specs/ai-gateway/` |
| Docs | `langwatch` | `docs/docs/ai-gateway/` |
| Helm chart (self-host) | `langwatch-saas` | `infrastructure/charts/` (existing chart, new `gateway` sub-chart) |

Deployment: separate pod, separate container. Load balancer routes `/v1/**` path → gateway service; everything else → main app. URL is `gateway.langwatch.ai` (dedicated) with legacy path-routing on `app.langwatch.ai/v1/**` kept for CLI integrations that pin base URLs without subdomain flexibility.

---

## 2. Virtual-key format

`lw_vk_{env}_{ulid}` where `env ∈ {live, test}`, `ulid` is a 26-char Crockford base32 ULID.

Total length: **40 chars** (`lw_vk_live_01HZX9K3M...`).

**Rules:**

- Prefix `lw_vk_` is fixed and searchable (grep/DLP friendly).
- Env prefix prevents accidental dev-key-in-prod / vice versa (Stripe pattern).
- Body is ULID: monotonic, k-sortable, time-prefixed. No b62 random — ULID sorts sensibly in the dashboard.
- Stored server-side as `hex(hmac_sha256(LW_VIRTUAL_KEY_PEPPER, key))` alongside a short display prefix (`lw_vk_live_01HZX9` visible, rest hashed). Peppered HMAC-SHA256 (not argon2id) is chosen because (a) the VK body is a 130-bit ULID — already brute-force-infeasible, (b) argon2id would add 50–100 ms to every cold resolve-key call which defeats the gateway's latency budget, (c) Stripe/GitHub use the same pattern for API keys, (d) deterministic hash enables O(1) lookup by hash (argon2id's random salt would force a table scan). Constant-time compare on verify.
- Key is shown **once** at creation; not retrievable afterward.
- Rotation: user can rotate a VK in place (same `vk_id`, new secret, old secret valid for 24h grace).
- **Pepper rotation:** `LW_VIRTUAL_KEY_PEPPER` rotates via a dual-pepper lookup window — during rotation, the control-plane verifies with both the new and old pepper (returning OK on either match) and re-hashes to the new pepper on next use. Complete rotation = re-hash all live VKs in a background job, then drop the old pepper. Documented SOP in self-hosting ops guide.
- Revocation: soft-delete sets `revoked_at`; gateway must reject within 60s (via `/changes` diff).

**Header accepted by the gateway:**

1. `Authorization: Bearer lw_vk_...` (OpenAI-compatible, default).
2. `x-api-key: lw_vk_...` (Anthropic-compatible fallback for Claude-shaped clients).
3. `api-key: lw_vk_...` (Azure-compatible fallback).

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
- `GET /v1/models` returns the **effective** model list: the union of aliases + explicitly-allowed models for this VK, filtered by `models_allowed` if set.

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
body        = {"key_presented":"lw_vk_live_01HZX","gateway_node_id":"gw-a"}
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
- `LW_VIRTUAL_KEY_PEPPER` — pepper added to argon2id(vk_secret) before hashing. Control-plane only; never on the gateway.

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
    { "jwt": "...", "revision": 142, "key_id": "vk_...", "display_prefix": "lw_vk_live_01HZX9", "config": { ... §4.2 shape ... } },
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
{ "key_presented": "lw_vk_live_01HZX...", "gateway_node_id": "gw-eks-abc" }
```

Response (200):
```json
{
  "jwt": "<HS256 signed, TTL 15m>",
  "revision": 142,
  "key_id": "vk_01HZX...",
  "display_prefix": "lw_vk_live_01HZX9"
}
```

JWT claims (short, hot-path-verified):
```
{
  "vk_id":        "vk_01HZX...",
  "project_id":   "proj_01HZ...",
  "team_id":      "team_01HZ...",
  "org_id":       "org_01HZ...",
  "principal_id": "user_01HZ... | svc_01HZ...",  // for trace attribution
  "revision":     142,                            // bumped on any mutation
  "iat":          1734567890,
  "exp":          1734568790,                     // TTL 900s
  "iss":          "langwatch-control-plane",
  "aud":          "langwatch-gateway"
}
```

Gateway refreshes asynchronously at `exp - 5min` (so T+10min from issue).

Errors: `401 invalid_api_key`, `403 virtual_key_revoked`.

### 4.2 `GET /api/internal/gateway/config/:vk_id`

Returns the warm-cache config (fat, not on hot path). Supports conditional `If-None-Match: <revision>` → `304 Not Modified`.

```json
{
  "revision": 142,
  "vk_id": "vk_01HZX...",
  "providers": [
    {
      "slot": "primary",
      "type": "openai|anthropic|azure_openai|bedrock|vertex|gemini|custom_openai",
      "credentials_ref": "pc_01HZ...",  // opaque, resolved to secret inside gateway
      "config": { /* provider-specific: region, deployment_name, project_id, etc */ }
    }
  ],
  "fallback": {
    "on": ["5xx", "timeout", "rate_limit_exceeded"],
    "chain": ["pc_primary", "pc_secondary", "pc_tertiary"],
    "timeout_ms": 30000,
    "max_attempts": 3
  },
  "model_aliases": { "gpt-4o": "azure/my-deployment", "claude": "anthropic/claude-haiku-4-5-20251001" },
  "models_allowed": ["gpt-5-mini", "claude-haiku-*", "gemini-2.5-flash"],
  "cache": { "mode": "respect|force|disable", "ttl_s": 3600 },
  "guardrails": {
    "pre":  [{"id": "guard_01HZ...", "evaluator": "evaluators/pii-check-abc12"}],
    "post": [{"id": "guard_01HZ...", "evaluator": "evaluators/hallucination-check-def34"}],
    "stream_chunk": []
  },
  "blocked_patterns": {
    "tools":  { "deny": ["^shell\\.", "^filesystem\\.write$"], "allow": null },
    "mcp":    { "deny": ["^.*@mcp/unverified.*$"], "allow": null },
    "urls":   { "deny": [], "allow": ["^https?://allowed\\.example\\.com/.*"] }
  },
  "rate_limits": { "rpm": null, "tpm": null, "rpd": null },
  /* v1 ships RPM + RPD enforcement (golang.org/x/time/rate token buckets,
     per-VK, LRU-evicted). Cross-dimension accounting: an RPM denial does
     NOT burn an RPD token. On breach: HTTP 429 + Retry-After + header
     X-LangWatch-RateLimit-Dimension: rpm|rpd naming which ceiling fired,
     error code = vk_rate_limit_exceeded. TPM deferred to v1.1 (requires
     Redis-coordinated cluster-wide counters; pre-request token count is
     an estimate too imprecise for a hard cap). */
  "budgets": [
    {
      "scope": "virtual_key", "scope_id": "vk_01HZ...",
      "window": "day", "limit_usd": 25.00,
      "spent_usd": 4.12, "remaining_usd": 20.88, "resets_at": "2026-04-19T00:00:00Z",
      "on_breach": "block"
    },
    { "scope": "project", "scope_id": "proj_01HZ...", "window": "month", "limit_usd": 1000.00,
      "spent_usd": 437.55, "remaining_usd": 562.45, "resets_at": "2026-05-01T00:00:00Z",
      "on_breach": "block" },
    { "scope": "team", "scope_id": "team_01HZ...", "window": "month", "limit_usd": 5000.00,
      "spent_usd": 3210.00, "remaining_usd": 1790.00, "resets_at": "2026-05-01T00:00:00Z",
      "on_breach": "warn" }
  ],
  "metadata": { "label": "dev/codex", "tags": ["coding-cli"], "created_by": "user_01HZ..." }
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

### 4.4 `POST /api/internal/gateway/budget/check`

Live reconciliation for near-limit scopes. Called by the gateway only when the cached snapshot shows any scope ≥ 90% of its hard limit (see `budgets.mdx` "Tier 2 — live reconciliation"). For cold scopes the cached snapshot is authoritative and this endpoint is never hit.

Request:
```json
{
  "vk_id": "vk_01HZ...",
  "gateway_request_id": "grq_01HZ...",
  "projected_cost_usd": 0.012,
  "model": "gpt-5-mini",
  "hot_scopes": [                            // optional: which scopes to check live
    { "scope": "project", "scope_id": "proj_..." },
    { "scope": "principal", "scope_id": "user_..." }
  ]
}
```

Response (dual-shape; both tiers populate both for now):
```json
{
  "decision":     "allow | soft_warn | hard_block",
  "warnings":    [ { "scope": "team", "pct_used": 89.2 } ],
  "block_reason": null,
  "blocked_by":   null,                      // or { "scope": "project", "window": "month" }

  "scopes": [                                // raw per-scope ledger snapshot
    { "scope": "project",   "scope_id": "proj_...",  "window": "month",  "spent_usd": "4824.12", "limit_usd": "5000.00" },
    { "scope": "principal", "scope_id": "user_...",  "window": "day",    "spent_usd": "19.40",   "limit_usd": "25.00"   }
  ]
}
```

Consumers can read EITHER the `decision`/`warnings`/`block_reason`/`blocked_by` top-level fields (dispatcher-style; used by older call sites) OR the `scopes` array (raw per-scope data; used by the gateway `Checker.ApplyLive` path landed in Lane A iter 4 pt3). Both are derived from the same authoritative ledger query, so they agree by construction.

Timeout and fail-open: gateway uses a 200 ms deadline on this call. On timeout or 5xx, the gateway falls back to its tier-1 cached decision (allow-through if cache said allow). Configurable via `LW_GATEWAY_BUDGET_LIVE_TIMEOUT_MS`.

### 4.5 `POST /api/internal/gateway/budget/debit`

Post-response async debit. Idempotent by `gateway_request_id` (24h dedup window). Implemented as an **outbox pattern on the LangWatch control-plane side**: the endpoint writes the debit request into a `BudgetLedger` row inside a transaction that also updates `spent_usd` counters per scope. Gateway POSTs fire-and-forget with at-least-once retry; LangWatch dedupes by `gateway_request_id`.

Request:
```json
{
  "gateway_request_id": "grq_01HZ...",
  "vk_id": "vk_01HZ...",
  "actual_cost_usd": 0.00087,
  "tokens": { "input": 412, "output": 128, "cache_read": 300, "cache_write": 112 },
  "model": "gpt-5-mini",
  "provider_slot": "primary",
  "duration_ms": 1243,
  "status": "success | provider_error | blocked_by_guardrail | cancelled"
}
```

Response:
```json
{
  "deduped": false,
  "budgets": [
    { "scope": "virtual_key", "remaining_usd": 20.87, "spent_usd": 4.13 },
    { "scope": "project",     "remaining_usd": 562.44, "spent_usd": 437.56 }
  ]
}
```

### 4.6 `POST /api/internal/gateway/guardrail/check`

Inline guardrail call. Gateway pipelines multiple guardrails in parallel and aggregates.

Request:
```json
{
  "vk_id": "vk_01HZ...",
  "project_id": "proj_01HZ...",
  "gateway_request_id": "grq_01HZ...",
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
| `virtual_key_revoked` | 403 | VK exists but is revoked |
| `model_not_allowed` | 403 | VK has model allowlist and requested model is not in it |
| `permission_denied` | 403 | Principal lacks RBAC permission for endpoint |
| `budget_exceeded` | 402 | Any hard-cap budget scope is over limit |
| `rate_limit_exceeded` | 429 | VK / project / org rate limit hit |
| `guardrail_blocked` | 403 | Pre- or post-call guardrail returned `block` |
| `tool_not_allowed` | 403 | Requested tool/MCP matches VK `blocked_patterns.tools` or `blocked_patterns.mcp` |
| `url_not_allowed` | 403 | Outbound URL the model wants to call matches VK `blocked_patterns.urls` deny list |
| `cache_override_invalid` | 400 | `X-LangWatch-Cache` header malformed |
| `provider_error` | 502 | Upstream provider returned error after fallback exhaustion |
| `upstream_timeout` | 504 | Upstream timed out after fallback exhaustion |
| `bad_request` | 400 | Validation error on incoming payload |
| `internal_error` | 500 | Unclassified gateway error |

**Response headers (all requests):**

- `X-LangWatch-Request-Id: grq_01HZ...` — opaque gateway request id, also emitted on errors and in OTel trace.
- `X-LangWatch-Provider: openai|anthropic|...` — which provider was actually used (may differ from requested model due to fallback or alias).
- `X-LangWatch-Model: gpt-5-mini` — resolved provider model.
- `X-LangWatch-Cache: hit|miss|bypass|forced` — cache outcome.
- `X-LangWatch-Budget-Warning: <scope>:<pct>` — optional, emitted on soft-cap breaches (can repeat).
- `X-LangWatch-Fallback-Count: <n>` — number of fallbacks attempted before success (0 when primary succeeded).

---

## 6. Caching passthrough

**Default:** `respect` — gateway forwards Anthropic `cache_control` ephemeral/persistent blocks untouched, respects OpenAI prompt caching semantics, passes through Gemini's implicit cache markers. Usage costs correctly account for `cache_read` vs `cache_write` tokens (see §4.5 debit shape).

**Hard invariant — Anthropic cache_control passthrough:** the gateway MUST NOT strip, reorder, or rewrite any `cache_control` field in messages/content blocks when `mode=respect`. This is load-bearing for prompt-caching economics on Anthropic (saves 90% of input cost on cache hits). Integration tests must assert byte-equivalence of the forwarded payload for cache_control-carrying requests. When `mode=force`, we MAY add cache_control to large stable prefixes (system message, tool defs) but MUST NOT remove client-supplied markers.

**Override hierarchy (last-write-wins):**

1. Per-request header `X-LangWatch-Cache: respect | force | disable | ttl=3600` (highest precedence).
2. VK config `cache.mode` + `cache.ttl_s`.
3. Default `respect`.

- `respect` — pass through upstream cache controls as-is.
- `force` — add ephemeral cache control to any cacheable segment (large prompt prefix, system message, tool definitions) even if client didn't specify. Gateway's own semantic cache kicks in with `ttl_s`.
- `disable` — strip all cache_control blocks from upstream request, disable gateway semantic cache, force cold call.

**Observability:** `X-LangWatch-Cache` response header reports outcome. Token counts in OTel trace include `cache_read_tokens` and `cache_write_tokens` separately so trace UI can show cache economics.

---

## 7. Fallback chain

Triggers (configurable per VK in `config.fallback.on`):

- `5xx` — any upstream 5xx.
- `timeout` — upstream exceeds `config.fallback.timeout_ms`.
- `rate_limit_exceeded` — upstream 429.
- `network_error` — connection reset / DNS / TLS.
- `circuit_breaker` — gateway-internal circuit breaker trips after N consecutive failures against a provider in the last M seconds (not a response trigger — preempts attempts).

**Does NOT trigger fallback** (these are client-fault and returned as-is):

- `400 Bad Request` from upstream (malformed payload).
- `401 Unauthorized` from upstream (provider credential bad — surface to customer so they fix their provider creds; don't mask by silently switching).
- `403 Forbidden` from upstream.
- `404 Not Found` (requested model doesn't exist at that provider).
- `invalid_api_key` / `permission_denied` from our own auth layer (never reaches fallback).

Behaviour:

- Gateway iterates `fallback.chain` in order, calls next provider with same payload translated via bifrost/core.
- After `max_attempts` exhausted, returns the last provider's mapped error envelope.
- Streaming: if primary fails **before** first chunk emits, fall back transparently. If primary fails **mid-stream**, return `provider_error` with partial response (never silently switch mid-stream; that would confuse the client).
- OTel trace records the full attempt chain as nested spans, each tagged `langwatch.fallback.attempt=N` and `langwatch.fallback.reason`.

Idempotency: gateway does **not** retry POST unless upstream responded before headers sent (avoids double-spend of expensive calls).

---

## 7b. Streaming contract (SSE)

- **Pre-first-chunk mutations allowed:** gateway may inject response headers (e.g. `X-LangWatch-Request-Id`, `X-LangWatch-Provider`), run pre-call guardrails that modify the request payload, and transparently switch providers via fallback.
- **Post-first-chunk immutability:** once the first byte has been emitted to the client, the gateway MUST pass through subsequent SSE chunks byte-for-byte from the upstream provider. No reordering, no delta merging, no re-chunking. Coding CLIs (Claude Code, Codex) depend on exact tool-call delta shapes.
- **Mid-stream failure:** if the upstream connection drops mid-stream, the gateway closes the client connection (rather than silently switching to a fallback, which would produce a Frankenstein stream). A terminal SSE `error` event is emitted with `type: provider_error`.
- **Post-response guardrails (stream case):** run on the **reassembled full stream** after the client connection closes. Non-blocking to the response. If a guardrail flags the completed response, emit an OTel trace attribute (`langwatch.guardrail.post_flag`) but do not retroactively alter the response; for real-time redaction, use `direction: stream_chunk` guardrails which gate each chunk before it's emitted.
- **Stream-chunk guardrails:** invoked on each chunk pre-emit. Decision `block` terminates the stream with SSE `error`. Decision `modify` replaces the chunk text. Latency budget per chunk ≤50ms (else gateway falls through with an OTel warning — never block the user on a slow guardrail).

---

## 8. Per-tenant OTel routing

Every request emits a LangWatch trace to the **tenant's own project** even though the gateway is multi-tenant.

Pattern (from Bifrost `ObservabilityPlugin.Inject(trace)`):

1. Gateway attaches `langwatch.project_id`, `langwatch.team_id`, `langwatch.org_id`, `langwatch.principal_id`, `langwatch.vk_id` as attributes to every trace.
2. Our OTel exporter reads `langwatch.project_id` and routes the OTLP export to `otel.langwatch.ai/v1/traces` with the project's collector token injected via control-plane lookup (cached).
3. For self-hosted: single OTel endpoint (`$LANGWATCH_OTEL_ENDPOINT`) with project attribution in span attributes (existing LangWatch ingest already handles this).

---

## 9. Auth cache strategy (gateway side)

Three layers, documented here so Go code + infra agree:

1. **L1 in-memory LRU:** 64k entries, TTL = JWT `exp`. Resolved JWT cached by SHA-256(vk_plain). Zero-RTT hot path.
2. **L2 Redis (optional):** same key, shared across gateway nodes. TTL = JWT `exp`. `$LW_GATEWAY_REDIS_URL` env toggles. When L2 miss, one node wins the resolve; others read cached.
3. **L3 bootstrap-pull (enterprise opt-in):** on startup, gateway calls `GET /api/internal/gateway/bootstrap` → paginated stream of all non-revoked VKs' JWTs. Enables gateway to serve traffic when control-plane is offline. Flag: `$LW_GATEWAY_BOOTSTRAP_PULL=true`.

Background refresh: single goroutine long-polls `/api/internal/gateway/changes?since=<rev>` with 25s timeout. On diff → re-fetch affected VK configs and invalidate L1/L2 entries.

No filesystem-persisted secrets. JWTs and configs are in-memory only; on restart we re-fetch.

---

## 10. Permissions (RBAC)

Alexis owns the final shape in Prisma schema; this is the agreed surface.

**Convention:** LangWatch permissions follow 2-segment `resource:action` (see `src/server/license-enforcement/member-classification.ts`). We keep that — no 3-segment namespacing.

**New resources (+ actions):**

- `virtualKeys: view | create | update | delete | manage | rotate`
- `gatewayBudgets: view | create | update | delete | manage`
- `gatewayProviders: view | manage` (gateway-only settings layered on existing ModelProvider)
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

- `specs/ai-gateway/virtual-keys.feature` — VK CRUD, show-once-secret, argon2id hashing, provider-creds linking, fallback chain, rotation/revoke, RBAC, attribution, internal endpoints (resolve-key JWT + config/:vk_id ETag + /changes long-poll).
- `specs/ai-gateway/budgets.feature` — hierarchical scopes (org/team/project/vk/principal), windows (min→total), `on_breach: block|warn`, idempotent debit outbox, timezone-aware resets.
- `specs/ai-gateway/gateway-provider-settings.feature` — `GatewayProviderCredential` binding over existing `ModelProvider` rows; gateway-only settings (rate limits, rotation policy, gateway-only extraHeaders) that must not leak into the legacy litellm path.
- `specs/ai-gateway/epic.feature` — cross-cutting E2E scenarios (end-to-end request through gateway → fallback → budget debit → per-tenant OTel emit).
- `specs/ai-gateway/` (pending, Lane A): `gateway-service.feature`, `health-checks.feature`, `auth-cache.feature`, `provider-routing.feature`, `caching-passthrough.feature`, `fallback.feature`, `streaming.feature`, `guardrails.feature`.

When a spec and this contract disagree, **the contract wins** and the spec is amended (after consensus in #langwatch-ai-gateway).

---

## 11. Cohesion with existing provider settings

LangWatch already stores `ModelProvider` rows (OPENAI_API_KEY etc) for evaluators/playground via litellm. We do **not** duplicate these.

- VK config references `credentials_ref: pc_...` which resolves to the same `ModelProvider` row.
- Provider credential pool gets a new entity `ProviderCredential` (one-per-provider-per-project can already exist; we extend to allow multiple slots).
- Playground / evaluators continue to use litellm path (untouched). Gateway uses bifrost/core. Keys are shared, paths are separate. No litellm migration in this epic.
- A VK can optionally expose itself as a provider inside the playground (`"Use this virtual key in playground"` toggle) — post-MVP nice-to-have, not blocking.

---

## 11b. Blocked-patterns enforcement

Evaluated at the gateway **before** dispatch to the upstream provider. Each pattern set has `deny` (regex allowlist of what to reject) and `allow` (regex, if non-null behaves as an allowlist — only listed patterns pass).

- **`tools`** — checked against every `tools[].function.name` in the request (OpenAI format) and every `tools[].name` (Anthropic format). First match in `deny` → 403 `tool_not_allowed` with `policies_triggered: ["blocked_tools"]`. If `allow` is non-null, any tool name not matching an `allow` entry is blocked.
- **`mcp`** — checked against the `mcp_servers[].name` and `mcp_servers[].url` if the request declares MCP servers. Same allow/deny semantics.
- **`urls`** — checked against any URL found inside tool-call arguments that look like outbound HTTP (heuristic: field name matches `/url|endpoint|uri/i`). Primarily advisory; hard enforcement requires egress proxy and is post-MVP.

OTel trace records each block with span attribute `langwatch.policy.blocked=<kind>:<pattern>`.

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

If **no** trace headers are present, the gateway creates a new trace and emits **`X-LangWatch-Trace-Id: <trace_id>`** and **`X-LangWatch-Request-Id: grq_…`** on the response so the caller can stitch later if desired.

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
| `GET` | `/api/gateway/v1/provider-credentials` | List gateway-scoped provider bindings | `gatewayProviders:view` |
| `POST` | `/api/gateway/v1/provider-credentials` | Create binding over existing ModelProvider | `gatewayProviders:manage` |
| `PATCH` | `/api/gateway/v1/provider-credentials/:id` | Update binding | `gatewayProviders:manage` |
| `DELETE` | `/api/gateway/v1/provider-credentials/:id` | Delete binding | `gatewayProviders:manage` |
| `GET` | `/api/gateway/v1/usage` | Spend / volume aggregations | `gatewayUsage:view` |

**Response shape convention:** snake_case (`virtual_key_id`, `created_at`) to match the OpenAI / Anthropic API aesthetic that external integrations already expect.

**Error envelope:** identical to the gateway data-plane error envelope (OpenAI-compatible). Type enum extended with `resource_not_found` (`404`) and `validation_error` (`422`).

**Shared service layer:** the Hono REST routes and the internal tRPC routes **both** call the same `VirtualKeyService`, `GatewayBudgetService`, `GatewayProviderCredentialService`. No business logic is duplicated. Only the DTO-shape helpers differ (snake_case for REST, camelCase for tRPC) and they live in a shared mapper module (`src/server/gateway/mappers/`).

**OpenAPI spec:** generated via `pnpm run openapi:gen` (TBD if not present) and published at `/api/gateway/v1/openapi.json` plus the docs site.

## 13. Open questions (to resolve in next iterations)

- [ ] **Self-host JWT secret rotation:** how do helm chart + control-plane agree on `LW_GATEWAY_JWT_SECRET` rotation without downtime? — @sergey to propose.
- [ ] **Streaming fallback semantics:** the mid-stream policy above is conservative; verify Portkey / Helicone behaviour. — @andr competitor research.
- [ ] **Budget windows & timezone:** `day` window in whose tz — org's or UTC? — default UTC, org-level override. — @alexis Prisma field.
- [ ] **Multi-region gateway routing:** do we need region-pinning for data residency? — @sergey + infra.
- [ ] **Webhook for budget breach:** notify Slack/email on hard block? — post-MVP.

---

## 13. Changelog

- **v0.1 (2026-04-18)** — Initial draft consolidated from @sergey + @alexis proposals. @andr ships as base for iteration.
