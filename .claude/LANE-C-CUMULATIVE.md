# Lane C — Cumulative Summary (iters 1–11)

Single source of truth for Lane C (@ai_gateway_andr = specs + docs + CLI + QA). Supersedes LANE-C-ITER-{1..4}.md for quick ramp-up; the per-iter memos remain for granular history.

## Artifacts shipped

### BDD specs (15 files)

Contract + shared:
- `specs/ai-gateway/_shared/contract.md` — v0.1 canonical wire contract (13 sections incl. public REST §12, trace propagation §11c, dual-shape /budget/check §4.4)
- `specs/ai-gateway/_shared/competitors.md` — Bifrost + Portkey + Nexos synthesis, feature matrix, differentiators

Feature specs:
- `epic.feature` — 11 cross-cutting E2E scenarios
- `virtual-keys.feature` (by Alexis, edited for VK format + RBAC convention drift)
- `budgets.feature` (by Alexis)
- `gateway-provider-settings.feature` (by Alexis)
- `gateway-service.feature`, `health-checks.feature`, `auth-cache.feature`, `provider-routing.feature`, `caching-passthrough.feature`, `fallback.feature`, `streaming.feature`, `guardrails.feature` (by Sergey)
- `trace-propagation.feature` (by Sergey, 8 scenarios)
- `cli-integrations.feature` — 14 scenarios for Claude Code / Codex / opencode / Cursor / Aider incl. Codex wire_api matrix
- `cli-virtualkeys.feature` — langwatch CLI subcommand scenarios
- `public-rest-api.feature` — 9 scenarios locking /api/gateway/v1/* auth, VK/budget/provider CRUD, DTO parity with tRPC, machine-actor audit, hono-openapi roadmap
- `advanced-routing.feature` — 11 scenarios for v1.1 weighted/canary/sticky/composable routing (competitive gap vs Portkey)

### Docs (~45 pages under `docs/ai-gateway/`)

Foundation:
- `overview.mdx`, `quickstart.mdx`, `concepts.mdx`

Primitives:
- `virtual-keys.mdx`, `budgets.mdx` (tier 1/2 budget flow per Sergey iter 4 pt3), `rbac.mdx`
- `security.mdx` (threat model + secrets-at-rest + tenant isolation)
- `troubleshooting.mdx` (SRE runbook for 11 failure modes)

Features:
- `caching-passthrough.mdx`, `guardrails.mdx`, `blocked-patterns.mdx`, `streaming.mdx` (incl. include_usage gotcha + SSE error frame lock), `model-aliases.mdx`, `observability.mdx` (per-project OTLP routing), `security.mdx`

Providers (8):
- `openai.mdx`, `anthropic.mdx`, `bedrock.mdx`, `azure-openai.mdx`, `vertex.mdx`, `gemini.mdx`, `custom-openai-compatible.mdx`, `overview.mdx`
- `fallback-chains.mdx` (incl. 30s/10/60s circuit defaults + LW_GATEWAY_CIRCUIT_* env)

API reference (6):
- `api/chat-completions.mdx`, `api/messages.mdx`, `api/embeddings.mdx`, `api/models.mdx`, `api/errors.mdx`, `api/management.mdx` (public REST /api/gateway/v1/* reference)

CLI integrations (7):
- `cli/overview.mdx`, `cli/langwatch-cli.mdx` (synced with shipped flag surface), `cli/claude-code.mdx`, `cli/codex.mdx` (wire_api matrix), `cli/opencode.mdx`, `cli/cursor.mdx`, `cli/aider.mdx`

SDK integration (2):
- `sdks/python.mdx`, `sdks/typescript.mdx` (both with trace-propagation section citing concrete response headers)

Self-hosting (4):
- `self-hosting/helm.mdx`, `self-hosting/config.mdx` (full env-var reference incl. per-project OTLP routing + LW_GATEWAY_BUDGET_LIVE_* + LW_GATEWAY_CIRCUIT_*), `self-hosting/health-checks.mdx`, `self-hosting/scaling.mdx`

Cookbooks (4):
- `cookbooks/ci-smoke-test.mdx` — VK mint → curl → trace-id verify → revoke
- `cookbooks/migrate-from-direct.mdx` — from direct OpenAI/Anthropic calls to gateway, rollback plan
- `cookbooks/multi-tenant-reseller.mdx` — SaaS B2B2C pattern
- `cookbooks/prometheus-alerts.mdx` — 11 alert rules, Alertmanager routing, promtool unit tests

### CLI (13 subcommands, 3 groups, shipped in typescript-sdk/)

**`langwatch virtual-keys` (alias `vk`):**
- `list / get <id> / create --name ... --provider ... / update <id> / rotate <id> / revoke <id>`
- Backing: `VirtualKeysApiService` hitting /api/gateway/v1/virtual-keys/*

**`langwatch gateway-budgets`:**
- `list / create --scope ... --window ... --limit ... / update <id> / archive <id>`
- Backing: `GatewayBudgetsApiService` hitting /api/gateway/v1/budgets/*

**`langwatch gateway-providers`:**
- `list / create --model-provider ... --slot ... / disable <id>`
- Backing: `GatewayProvidersApiService` hitting /api/gateway/v1/providers/*

All use direct `fetch` (secrets/list.ts pattern). Retrofit to openapi-typed client is pending Alexis's describeRoute completion (partial in iter 7).

### Docs navigation

`docs/docs.json` adds AI Gateway anchor with 8 groups: Overview / Virtual Keys & Budgets / Providers / Features / Coding CLI / SDK / API Reference / Self-Hosting / Cookbooks. Integrations → Observability and Documentation → Platform renames landed iter 1.

## Team coordination facts (as of iter 11)

- @ai_gateway_alexis (Lane B — platform / Hono / Prisma / UI) — 7 iters shipped. Key: public REST (`4e95415da`), VK+Budget+Provider edit drawers (`c34577f2f` + `6cda472ec`), LOCAL_DEV_BYPASS_AUTH + describeRoute (partial) (`8f142e274`). Remaining: complete describeRoute on all CRUD endpoints, client-side dev-bypass session fix, Project.observabilityEndpoint migration.
- @ai_gateway_sergey (Lane A — Go gateway / bifrost / OTel / budget / fallback) — 4 iters + 6 parts shipped. Full scoreboard: OTel + traceparent ✅, fallback + circuit ✅, live /budget/check ✅, per-project OTLP ✅, streaming usage extraction ✅, streaming fallback ✅. Remaining: terraform gateway.langwatch.ai cert + ALB ingress.

## Active blockers

- **Dogfooding UI screenshots** — client-side still bounces to Auth0 despite LOCAL_DEV_BYPASS_AUTH cookie being set (server is correct, frontend session check isn't reading better-auth cookie). Flagged to Alexis; screenshot evidence at `.claude/lane-c-iter10-01-post-dev-bypass.png`.
- **`langwatch vk update` config partial-merge semantics** — shipped in iter 6 assuming server-side merge. Verify with live dev server once dogfood works.
- **CLI OpenAPI retrofit** — pending Alexis completing describeRoute on all CRUD (iter 8 Lane B queue).

## What iter 12+ should consider

- Write Grafana dashboard JSON to pair with prometheus-alerts cookbook.
- Semantic caching roadmap spec (another Portkey gap).
- Post-Auth0-fix: dogfood VK UI → 6 screenshots → PR-ready evidence.
- Post-hono-openapi: retrofit VirtualKeysApiService etc. to typed client.
- Post-Project.observabilityEndpoint: concrete per-project OTLP example in self-hosting config.mdx.
- Post-terraform: update self-hosting/helm.mdx with real ingress example.
- End-to-end CLI scenario test using scenario.run + Claude Code adapter (skills/_tests/ pattern).

## Useful pointers

- Contract: `specs/ai-gateway/_shared/contract.md`
- Competitor research: `specs/ai-gateway/_shared/competitors.md`
- Per-iter memos: `.claude/LANE-C-ITER-{1,2,3,4}.md`
- Full commit list since iter 1 Lane C:
  - `32bcba36a`, `9a6281a72` — iter 1
  - `58a220a2d`, `29ccb640e` — iter 2
  - `2ccbcdfd0`, `02e65684b` — iter 3 (+ `.claude/LANE-C-ITER-3.md`)
  - `d5d6012a7`, `5e8d4e46b`, `60245e119` — iter 4 (+ `.claude/LANE-C-ITER-4.md`)
  - `4d9950213` — iter 5
  - `e8742e1ec`, `a1aad7e20` — iter 6
  - `02233e486`, `57c6963a7` — iter 7
  - `e61b571b5` — iter 8
  - `232f44d78` — iter 9
  - `f4b9c4fff` — iter 9 pt2 (streaming usage)
  - `3dfc558e6` — iter 10 (streaming fallback docs)
  - `a596901ae` — iter 11 (prometheus alerts)

---

## Addendum: iters 12–17 (v1 GA final push)

Iter 12: route-registration fix unblocking UI dogfood. Iter 13: V1-GA-READINESS.md + prometheus-alerts realignment. Iter 14: scaling.mdx real benchmarks. Iter 15: `View in UI` CLI deep-links. Iter 16: PR-DESCRIPTION.md draft + rate-limit docs (sergey iter 7). Iter 17: post-compact catch-up covering sergey iters 8–14 + alexis iters 13–16 UI reflections.

### Iter 17 sub-commits (12 total)

| # | Commit | Covers |
|---|---|---|
| 17 | `51c8e3557` | sergey iter 8 (blocked_patterns tools/MCP/models) + iter 9 (URL blocking with permissive body extraction) — docs/spec alignment on 4-dim deny/allow + fail-closed + RE2 + enforcement-before-body-parse |
| 17.2 | `94aebde55` | alexis iter 14 UI — blocked_patterns 4-row drawer with fail-closed preview |
| 17.3 | `85d004578` | sergey iter 10 X-LangWatch-Cache override — respect/disable v1, force/ttl=NNN → 400 cache_override_not_implemented v1.1, new X-LangWatch-Cache-Mode response header, enforcement-before-blocked-pattern ordering |
| 17.4 | `b9497770e` | PR-DESCRIPTION.md — sergey 8-10 + alexis 13-14.1 credits |
| 17.5 | `89a874ebd` | caching-passthrough.feature — cache-override scenarios aligned to v1 contract (deep-strip recursive + force/ttl→400 + ordering-before-blocked-pattern) |
| 17.6 | `426bcf491` | sergey iter 11 post-response guardrails + alexis bundle alignment (`532ed881b`) — zero-cost `blocked_by_guardrail` debit, modify-in-place rewrite, content-block-skip, `guardrails.{request,response}_fail_open` opt-in |
| 17.7 | `0ceece65e` | sergey iter 12 stream_chunk guardrails — visible-text-only invocation, byte-locked terminator `event: error` with code=stream_chunk_blocked, fail-open-with-metric on timeout/upstream-error, modify NOT implemented v1. Fixed Background on_block=modify drift in guardrails.feature |
| 17.8 | `a737989ae` | PR-DESCRIPTION.md — sergey iter 11+12 credit |
| 17.9 | `294fca3ca` | sergey iter 13 /v1/models three-group listing (aliases + models_allowed + provider shortcuts) for Codex/Cursor startup probes |
| 17.10 | `a4460bfa3` | PR-DESCRIPTION.md — sergey iter 13 credit |
| 17.11 | `d13d2be81` | sergey iter 14 pprof admin listener — NEW cookbooks/production-runbook.mdx (5 diagnostic recipes) + self-hosting/config.mdx GATEWAY_ADMIN_ADDR reference + docs.json nav |
| 17.12 | `9d1ded22e` | PR-DESCRIPTION.md — sergey iter 14 credit + cookbook count bump 4→5 |
| 17.13 | `c645d8ac5` | sergey iter 15 Redis L2 — scaling.mdx §Redis L2 rewrite with real numbers, config.mdx REDIS_URL |
| 17.14 | `1e2f9fa5f` | PR-DESCRIPTION.md — sergey iter 15 credit |
| 17.15 | `7430708b2` | sergey iter 16 Helm chart sync — helm.mdx values.yaml admin/budget/guardrails stanzas + runbook Helm note |
| 17.16 | `9cb1cab5d` | PR-DESCRIPTION.md — sergey iter 16 credit |
| 17.17 | `ef7e43935` | sergey iter 17 (per-org /changes) + iter 18 (NetworkPolicy) + iter 19 (gateway CI gate) — scaling.mdx §Per-org /changes, helm.mdx §NetworkPolicy + §Chart and data-plane CI, security.mdx self-hosted note, config.mdx LW_GATEWAY_AUTH_CACHE_CHANGES_POLL_SECONDS annotation |
| 18 | `7b62b962f` | semantic-caching.feature (new v1.1 roadmap spec, 318 lines) — golden/safety/headers/observability/lifecycle/compat/migration/out-of-scope sections covering the remaining Portkey competitive gap on the caching axis |
| 19 | `2571d6767` | sergey iter 20 (startup netcheck) — helm.mdx §Startup network check, config.mdx §Startup gate env table, troubleshooting.mdx new "Pod never becomes ready after a deploy" entry distinguishing DNS vs TCP vs firewall error classes |
| 20 | *(this commit)* | NEW cookbooks/grafana-dashboard.mdx (8-row importable Grafana JSON) + sergey iter 21 outbox metrics docs — production-runbook.mdx Recipe 6 "Debit outbox backlog" + prometheus-alerts.mdx three new leading-indicator rules (fill-pct > 50% warn / flush_failures > 0 warn / 4xx_drops > 0 page) |

### Iter 17/18/19 sync notes (post-compact)

**Iter 17 (per-org /changes, `5119261`)** — documented in scaling.mdx as a new H3 under Control-plane capacity. Key teaching point for operators: if control-plane `/changes` hit rate jumps after deploying a gateway version with iter 17, that's the expected behaviour of per-org scoping (previously the gateway was calling without `organization_id`, so the control plane returned empty and no invalidation fired). The cross-link from `LW_GATEWAY_AUTH_CACHE_CHANGES_POLL_SECONDS` to the new Scaling section closes the config.mdx → scaling.mdx loop.

**Iter 18 (NetworkPolicy, `cd0506a`)** — documented as a dedicated H2 in helm.mdx with three sub-sections (allowlist breakdown, render verification via `helm template | grep`, runtime verification via `kubectl exec curl`). Security.mdx gained a sentence under "Self-hosted deployments" pointing at the new section so the security threat-model page cross-references the concrete mitigation. Default is `enabled=false` — deliberate call-out because dev clusters often run CNIs without `NetworkPolicy` enforcement.

**Iter 19 (gateway CI gate, `1fd1fc3`)** — documented as a dedicated H2 "Chart and data-plane CI" in helm.mdx, placed immediately before the Upgrade procedure so operators reading the chart upgrade flow see the guarantee that sits behind each released chart version. Called out both invariants (`networkPolicy.enabled=false` → 0 renders, `=true` → exactly 1 render) since those are the two ways iter 18's policy could silently regress.

### Terminal SSE error shapes (locked v1)

Clients that parse SSE `error` frames should key off `error.code`:

| code | type | trigger | retry? |
|---|---|---|---|
| `upstream_mid_stream_failure` | `provider_error` | upstream connection dropped mid-stream | yes (client may retry; gateway doesn't silent-switch) |
| `stream_chunk_blocked` | `guardrail_blocked` | stream_chunk guardrail returned block on a visible delta | no (retry won't help unless input changes) |

Both shapes are byte-locked by the Go test suite. Documented in streaming.mdx §Terminal error shapes and contract.md §7b.

### Error enum additions (iter 17)

- `cache_override_not_implemented` (400) — v1.1 `force` / `ttl=NNN` rejected explicitly (vs `cache_override_invalid` for malformed/unknown)
- `guardrail_upstream_unavailable` (503) — evaluator service unreachable + fail-closed VK default

### Still pending post-GA

- End-to-end CLI scenario test (needs bifrost-wired data plane + live provider creds)
- Helm chart e2e on `lw-dev` EKS cluster
- k6 load test at 5K req/s + 1.5K SSE concurrency on staging
- Advanced routing v1.1 (Portkey gap — spec already written)
- Semantic caching v1.1

Lane A scoreboard end-of-GA: 14 iters, 14 Go packages, ~85 tests. Lane B through iter 16 (UI ConfirmDialog / VK detail / rate-limit drawer / provider edit / blocked_patterns UI / cache mode / bundle alignment). Lane C through iter 17.12.
