# feat(ai-gateway): LangWatch AI Gateway v1 GA

## Summary

Ships the first version of the **LangWatch AI Gateway** — a Go data plane sitting on `github.com/maximhq/bifrost/core` that adds virtual-key governance, hierarchical budgets, inline guardrails, fallback chains, Anthropic `cache_control` passthrough, and per-tenant OTel routing on top of every request. Exposed at `gateway.langwatch.ai` (cloud) and via a Helm sub-chart (self-hosted).

**The enterprise pitch**: ~700 ns of hot-path overhead, per-tenant trace routing with zero customer config, 90% Anthropic cache discount preserved byte-for-byte, built-in fallback across providers, and a CLI + REST API for every management action. Drop-in OpenAI / Anthropic / Bedrock / Azure / Vertex / Gemini compatibility.

## What's new

### Data plane (Go, `langwatch-saas/services/gateway/`)

- `POST /v1/chat/completions`, `POST /v1/messages`, `POST /v1/embeddings`, `GET /v1/models` — OpenAI + Anthropic shape compatibility.
- Auth via `Authorization: Bearer lw_vk_*`, `x-api-key`, or `api-key`.
- Per-credential sliding-window circuit breaker (30s / 10 failures / 60s open) + VK-configurable fallback chain with transparent pre-connection switching.
- Live `/budget/check` reconciliation for near-limit scopes (≥ 90% of cap) with 200 ms fail-open.
- Anthropic `cache_control` byte-for-byte passthrough.
- Per-project OTLP routing via `ProjectEndpointRegistry` — customer spans land in the customer's LangWatch project without env config.
- Streaming: pre-connection transparent fallback; mid-stream terminate with byte-locked SSE error frame (never silent-switch).
- Streaming usage extraction across all providers; surfaces `X-LangWatch-Usage-Warning` + span `success_no_usage` when upstream doesn't report.
- Trace propagation: honours incoming `traceparent`, emits `X-LangWatch-Trace-Id` / `X-LangWatch-Span-Id` / `X-LangWatch-Request-Id` / re-injected `traceparent`.
- Prometheus `/metrics` with 11 gateway-specific collectors.
- Health probes: `/livez` `/healthz` `/readyz` with K8s probe specs.
- Terraform: `gateway.langwatch.ai` cert-manager cert + NLB + HPA + 620 s terminationGrace.

### Control plane (Hono on `langwatch/`)

- 13 new Prisma models + 8 enums. Internal `/api/internal/gateway/*` (HMAC-signed, ±300 s replay, sig-before-timestamp verify). Public `/api/gateway/v1/*` (standard project API tokens, same service layer as tRPC, full `describeRoute` OpenAPI coverage).
- 6 new RBAC resources + per-resource actions; ConfigMaterialiser → bundle → JWT on `/resolve-key`; `/changes` long-poll.
- `LOCAL_DEV_BYPASS_AUTH` for dev environments (BetterAuth-signed cookie).
- `Project.observabilityEndpoint` + UI to configure per-project OTLP routing.

### UI (Vite SPA, `langwatch/src/pages/[project]/gateway/`)

- 6 pages: Virtual Keys, Budgets, Providers, Usage, Settings + VK detail page.
- Full create + edit drawers for VK / budget / provider binding.
- Themable ConfirmDialog on revoke (danger) / rotate (warning) / archive (warning).
- `/gateway/usage` tiles with 24h/7d/30d/90d windows reading real `GatewayBudgetLedger`.

### CLI (`typescript-sdk/`, shipped via `langwatch` npm package)

- `langwatch virtual-keys` (alias `vk`): `list / get / create / update / rotate / revoke` — prints `View in UI: <url>` for deep-link.
- `langwatch gateway-budgets`: `list / create / update / archive`.
- `langwatch gateway-providers`: `list / create / disable`.
- 13 subcommands total, colorised output, `--format json` mode.

### SDKs

- Python ≥ `v0.22.0`: `langwatch.get_gateway_headers()` for trace propagation.
- TypeScript ≥ `v0.26.0`: `getGatewayHeaders()` equivalent.

### Docs (`docs/ai-gateway/`, 45+ pages)

- Overview / Quickstart / Concepts
- Features: Caching Passthrough / Guardrails / Blocked Patterns / Streaming / Model Aliases / Observability / Security / Troubleshooting
- Providers (8) + Fallback Chains
- API Reference (6): chat-completions / messages / embeddings / models / errors / management
- Coding CLI (7): langwatch CLI / Claude Code / Codex / opencode / Cursor / Aider
- SDK Integration (2): Python / TypeScript
- Self-Hosting (4): Helm / Config / Health Checks / Scaling
- Cookbooks (4): CI smoke test / Migrate from direct / Multi-tenant reseller / Prometheus alerts

### BDD Specs (`specs/ai-gateway/`, 16 files)

Contract `_shared/contract.md` (v0.1, 13 sections). Feature files covering every surface from VK lifecycle to trace propagation to streaming to advanced-routing roadmap (v1.1).

## Evidence

### Hot-path overhead (M1 Max, Go 1.26.1)

```
auth.SignRequest (HMAC + body hash)  ~2,900 ns  (internal calls only)
auth.KeyHash                            380 ns
circuit.Allow (closed)                   64 ns  (0 allocs)
budget.Precheck (3-scope cached)          9 ns  (0 allocs)
fallback.Walk (primary success)         119 ns
fallback.Walk (falls over one slot)     243 ns

happy-path pre-bifrost total      ≈     700 ns
```

CI gate: > 2× regression blocks PR merges.

### Dogfood screenshots

See `.claude/lane-c-iter12-*.png` and `.claude/lane-c-iter10-*.png`:

1. Virtual Keys empty state with CTA
2. Budgets list / empty state
3. Providers list with "Bind your first provider" CTA
4. Usage page with 24h/7d/30d/90d window toggles
5. New Virtual Key drawer with name / description / env / provider chain
6. Gateway Settings (observability_endpoint config)

## Test plan

- [x] Go unit tests — 10 packages, 52+ tests green
- [x] Go hot-path benchmarks — 8 measured, baselines locked
- [x] TypeScript typecheck (langwatch + typescript-sdk) green
- [x] Control-plane unit tests — 49/49 gateway-related tests pass
- [x] Browser dogfood — 6 screenshots across 6 pages, sub-nav works
- [ ] End-to-end CLI scenario test — requires bifrost-wired data plane + CI harness (post-GA)
- [ ] k6 load test at 5K req/s non-streaming + 1.5K concurrent SSE — staging only
- [ ] Helm chart e2e on `lw-dev` EKS cluster — follow-up PR

## Outstanding for v1.1 (post-GA)

- `specs/ai-gateway/advanced-routing.feature` — weighted / canary / sticky-session / composable routing (competitive gap vs Portkey).
- Semantic caching.
- Per-org `/changes` scoping (waiting on JWT-derived org_id).

## Contributors (parallel ralph-loop agents)

- **Lane A (@ai_gateway_sergey)** — Go data plane: scaffold (`f551509`), iter 4 in 7 parts (OTel/traceparent `e9b04e6`, fallback+breaker `fa1fee0`, live /budget/check `5808ef2`, per-project OTLP `5fe8486`, streaming usage `56f9134`, streaming fallback `b8016b0`, terraform `2d13a22`), iter 5 metrics (`53c466f`), iter 6 benchmarks (`f43cc20`).
- **Lane B (@ai_gateway_alexis)** — Control plane + UI: foundation (`7b24eade3`, `e86c09f62`), VK UI (`593571fb4`), public REST (`4e95415da`), edit drawers (`c34577f2f`, `6cda472ec`), dev-bypass + describeRoute (`8f142e274`, `65785403b`), observability UI (`5201e9928`), ConfirmDialog (`6021c1816`).
- **Lane C (@ai_gateway_andr)** — Specs + docs + CLI + QA: 16 commits across 15 iterations (see `.claude/LANE-C-CUMULATIVE.md`). Shipped the contract, 45+ doc pages, 13 CLI subcommands, 6 BDD spec files, 4 cookbooks, 6 dogfood screenshots, and caught the Vite route-registration oversight (`267ceaec5`) that was blocking UI dogfood.

Full cross-lane readiness inventory at `.claude/V1-GA-READINESS.md`.

## Migration / rollback

- Backwards-compatible. No breaking changes to existing LangWatch APIs.
- No feature flag required — new resources live under net-new `/api/gateway/v1/*` and `/ai-gateway` nav.
- Rollback: revert this PR. Gateway pod can be scaled to zero via Helm without affecting the control plane.

## Related

Competitor research: `specs/ai-gateway/_shared/competitors.md` (Bifrost + Portkey + Nexos).
