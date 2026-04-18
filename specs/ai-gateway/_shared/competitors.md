# AI Gateway — Competitor lessons

**Purpose:** Capture what Bifrost, Portkey, and Nexos each do well (and badly) so LangWatch AI Gateway can deliberately pick, reject, or re-prioritise features. Updated as we re-read competitor docs each ralph iteration.

**Last reviewed:** 2026-04-18 (iter 2, @ai_gateway_andr)

---

## 1. Bifrost (docs.getbifrost.ai)

### What we adopt

- **20+ providers, drop-in OpenAI/Anthropic/Bedrock/Vertex/Azure compatibility.** This is exactly the leverage we buy by embedding `bifrost/core`.
- **4-level hierarchy in governance:** virtual-key → team → customer → organisation. Ours is slightly different (org → team → project → virtual-key → principal) because LangWatch's existing hierarchy has `project` as the primary scope boundary for multitenancy; we map `customer` → `project`. No new primitives.
- **Plugin architecture.** `LLMPlugin` interface with `PreLLMHook` / `PostLLMHook` / streaming chunk hook is the foundation our guardrail system runs on. We call `guardrail-check` over HTTP rather than using their dynamic `.so` plugin loader (we're already in Go, no need for the .so machinery).
- **MCP gateway (tool discovery, approval controls, OAuth).** Confirms "gateway that speaks MCP" is a valid product direction. Our MCP handling is narrower for v1: regex-based `blocked_patterns.mcp` allow/deny at the gateway. Full MCP orchestration (approval workflow, OAuth, custom hosting) is post-v1.
- **Observability via Prometheus + OpenTelemetry.** We copy this shape 1:1. `/metrics` for Prometheus, OTLP exporter with `langwatch.project_id` routing.
- **Enterprise features: adaptive load balancing, HA clustering, IdP integration, RBAC, audit logs, VPC deployments.** LangWatch already has SSO/SCIM/RBAC/audit. VPC deployment = our helm chart. Adaptive load balancing = our fallback chain + circuit breaker. HA clustering = horizontal scale + shared Redis L2 auth cache.

### What we reject or defer

- **Bifrost's own configstore (SQLite/Postgres).** We don't use it — LangWatch's Prisma DB is the source of truth for VKs, budgets, guardrails. Bifrost's governance plugin is also skipped (600+ LOC `GovernanceStore` interface) because our hierarchy and RBAC model differ.
- **Bifrost HTTP transport + web UI.** We write our own HTTP transport (Go/chi in `services/gateway/`) to control auth middleware order; we build our own UI inside the LangWatch app.
- **Semantic cache plugin** (Bifrost ships one). We leave this as an opt-in toggle for v2. Provider-native cache passthrough (Anthropic cache_control) is the v1 priority because it's load-bearing economically and unambiguous; semantic cache changes latency characteristics customers must opt into explicitly.

### API shape insights worth mirroring

- Bifrost's `ObservabilityPlugin.Inject(ctx, trace)` pattern with a mutable `Attributes` map is exactly what we use for per-tenant OTel routing. ~200 LOC of our own code rather than importing their plugin.
- Bifrost's key rotation primitive (multiple keys per provider with weighted distribution) is a nice-to-have we can add post-v1 — today we have primary + fallback chain, not weighted round-robin.

---

## 2. Portkey (portkey.ai/docs/product/ai-gateway)

### What we adopt

- **Header conventions.** Portkey uses `X-Portkey-*` namespace for their overrides. We mirror with `X-LangWatch-*` (`X-LangWatch-Cache`, `X-LangWatch-Request-Id`, `X-LangWatch-Provider`, `X-LangWatch-Budget-Warning`, `X-LangWatch-Fallback-Count`). Consistent namespace = discoverable for customers reading response headers.
- **Simple + semantic cache dual mode.** We skip semantic for v1 but retain the mental model — `X-LangWatch-Cache: respect|force|disable|ttl=<s>` is the shape.
- **Conditional routing / fallbacks / canary testing.** Portkey's canary-testing primitive is a neat add-on: route N% of traffic to a new model for comparison. Post-v1 candidate; not in scope for round 1.
- **Budget granularity: hourly / daily / per-minute / token-based.** We accept all of these except token-based (we use USD-based everywhere for clarity; tokens × price gives equivalent control). Windows agreed in contract §4.2: `minute|hour|day|week|month|total`.
- **Load balancing across API keys** (to counter provider rate limits). We already have this implicitly via fallback chain; weighted round-robin across credentials of the same provider is a post-v1 improvement.

### What we reject or defer

- **gRPC transport (Portkey has beta).** Not needed for v1. HTTP/2 + streaming SSE + well-tuned JSON is sub-millisecond enough.
- **Portkey Enterprise hosted tier with closed-source governance.** This is the pattern we explicitly want to avoid — v2 branch of Portkey OSS did open-source the governance piece but the hosted product still has features behind a paywall. We commit to governance entirely open in the LangWatch app; the differentiator is observability + evals + analytics, not gating basic VK CRUD.
- **`npx @portkey-ai/gateway` single-binary OSS distribution.** Our self-host story is the LangWatch helm chart with gateway as a sub-chart. Simpler for ops (one artefact bundle) and lets the gateway reuse LangWatch's credentials.

### API shape gaps we close

- Portkey's public docs don't expose every header — their documentation page we fetched is shallow on `X-Portkey-*` specifics. Our `specs/ai-gateway/_shared/contract.md` §5 (full error + header table) is more complete; keep it that way as a differentiator.

---

## 3. Nexos (docs.nexos.ai/gateway-api/integrations/codex-cli)

### What we adopt

- **`wire_api: "responses" | "chat"` distinction for Codex CLI.** This is the single biggest insight from Nexos's docs: Codex can either speak the OpenAI Responses API (`/v1/responses`) or Chat Completions API (`/v1/chat/completions`), and which one works depends on the model + provider. **Claude via OpenAI Responses API is not supported**; Codex must switch `wire_api: "chat"` for non-OpenAI-native models routed through the gateway.
- **Bearer token auth via env var** (`NEXOS_AI_API_KEY` in their case; `OPENAI_API_KEY=lw_vk_live_…` for us — simpler because we use the standard OpenAI env name so no CLI code change).
- **Per-project config in `~/.codex/config.toml`** with `model`, `wire_api`, `env_key`, `model_verbosity`. Our Codex docs should walk through exactly this file.
- **Trust levels for Codex command execution per project directory.** That's Codex-side (not gateway-side), but worth noting in our docs so engineers understand the security model of Codex + our tool-blocking as a belt-and-braces defence.

### What this implies for our Codex docs

Our current `docs/ai-gateway/cli/codex.mdx` covers the env-var setup but **does not yet explain `wire_api: "responses"|"chat"` switching** or the "which endpoint does this model support" caveat. Iter 2 TODO: add a "Which Codex `wire_api` mode to use" section with a table:

| Model family | Routed to | Recommended `wire_api` |
|---|---|---|
| `gpt-5*`, `gpt-4.1*`, `o3*` via OpenAI / Azure | OpenAI / Azure OpenAI | `responses` |
| `gpt-*` via a generic OpenAI-compatible provider that doesn't expose `/v1/responses` | generic | `chat` |
| `claude-*` via Anthropic / Bedrock / Vertex | Anthropic family | `chat` |
| `gemini-*` via Google | Gemini | `chat` |

Then document that our gateway automatically exposes `/v1/responses` when the VK's resolved model supports it, and returns `400 bad_request` with a clear message when the CLI sends to `/v1/responses` for a model that requires `chat`. The error message should include a hint: `Model '<name>' resolves to Anthropic. Set wire_api = "chat" in your Codex config.`

### Gap in our offering vs Nexos

Nexos publishes a clean per-CLI integration guide page (we only saw Codex). We should do the same — a dedicated `docs/ai-gateway/cli/{claude-code,codex,opencode,cursor,aider}.mdx` with exact env-var + config-file snippets. We already have claude-code.mdx and codex.mdx with real content; the rest need to be fleshed out next iter.

---

## 4. Feature matrix — where LangWatch AI Gateway wins or is at parity

| Capability | LangWatch | Bifrost OSS | Portkey OSS | Nexos (hosted) |
|---|---|---|---|---|
| OpenAI-compat `/v1/chat/completions` | ✅ | ✅ | ✅ | ✅ |
| Anthropic-compat `/v1/messages` | ✅ | ✅ | ✅ | ✅ |
| Virtual keys with budgets | ✅ built-in | ✅ plugin | ✅ | ✅ |
| Hierarchical scopes (org/team/project/VK/principal) | ✅ 5-level | ✅ 4-level | partial | partial |
| Inline guardrails (pre/post/stream_chunk) | ✅ | ❌ OSS / ✅ Enterprise | partial | unknown |
| Blocked patterns (tools/MCP/URL regex) | ✅ | partial | ❌ | ❌ |
| Per-tenant OTel routing | ✅ | ✅ plugin | ❌ | ❌ |
| Anthropic `cache_control` byte-identical passthrough | ✅ with integration test | partial | partial | unknown |
| Fallback chain with 400-error exclusion | ✅ documented | partial | ✅ | partial |
| Coding-CLI integration docs (Claude Code / Codex / opencode) | ✅ in progress | minimal | minimal | ✅ Codex only |
| Helm chart for self-host | ✅ (sub-chart of LangWatch) | ✅ | manual | ❌ |
| RBAC integrated with SSO/SCIM | ✅ via existing LangWatch RBAC | ✅ Enterprise only | Enterprise only | hosted only |
| Audit log of gateway actions | ✅ (`GatewayAuditLog` table) | ✅ Enterprise only | Enterprise only | hosted only |
| Built on bifrost/core for provider breadth | ✅ | native | ❌ (their own) | unknown |

**Our differentiators, ranked:**

1. **Everything observability-grade is free and OSS.** Tracing, analytics, evals, per-tenant OTel routing — no "enterprise tier" paywall for the governance primitives. Matches LangWatch's existing positioning.
2. **Built on bifrost/core.** Ride the best-of-breed provider-dispatch library without forking. Bifrost bus-factors (bus-1) but we can fork if upstream stalls.
3. **Inline integration with LangWatch evals.** Guardrails aren't a separate authoring surface — they reuse evaluators customers already have for online-evals.
4. **CLI-first.** We document every coding CLI (Claude Code, Codex, opencode, Cursor, Aider) with known-good configs; competitors typically cover one.
5. **Byte-identical caching passthrough as an asserted invariant.** Not just a claim — an integration test. Protects the 90% Anthropic discount that gateways often silently break.

---

## 5. Open research questions for future iterations

- [ ] How does Portkey's **conditional routing** (policy-based) look at the config level? Worth a future feature if we see demand.
- [ ] Does Bifrost's **MCP autonomous agent mode** have anything reusable for our `blocked_patterns.mcp` enforcement, or is it unrelated? Read their MCP docs deeply.
- [ ] Does anyone in the category solve **per-region provider routing for data residency** cleanly? Open question in our contract §12.
- [ ] **Canary / A-B routing** (Portkey) — is a percentage-routed VK config worth the complexity in v1.x? Tracking as a post-v1 candidate.
- [ ] **Semantic cache** — when does it pay off vs Anthropic's own 5-min ephemeral cache? Benchmark this before shipping.
