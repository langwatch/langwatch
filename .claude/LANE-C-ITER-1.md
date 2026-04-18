# Lane C (Andr) — Ralph Iteration 1 Learnings

## What shipped this iteration

**Contract** (`specs/ai-gateway/_shared/contract.md` v0.1):
- Consolidated VK format `lw_vk_{live|test}_<26-char-ULID>` (40 chars total).
- Peppered HMAC-SHA256 for VK hashing (not argon2id) — documented rationale.
- JWT-tiny + Config-fat split (resolve-key JWT for identity, /config/:vk_id for rich config with ETag=revision).
- `/changes` long-poll for background sync (200/204 semantics).
- Budget model: hierarchical scopes (org/team/project/vk/principal), windows (min→total), `on_breach: block|warn`, idempotent debit outbox.
- Error envelope: OpenAI-compatible with full type enum (incl. `tool_not_allowed`, `url_not_allowed`, `cache_override_invalid`, `virtual_key_revoked`, `model_not_allowed`).
- Streaming contract (§7b): SSE byte-for-byte post-first-chunk, no mid-stream fallback, post-hooks non-blocking, stream_chunk guardrails ≤50ms budget.
- Cache passthrough (§6): Anthropic `cache_control` MUST NOT be reordered when `mode=respect`; override via `X-LangWatch-Cache` header.
- Fallback (§7): triggers (5xx/timeout/429/network/circuit); doesn't fire on 400/401/403/404.
- Blocked patterns (§11b): `deny`/`allow` regex for tools/mcp/urls.
- Per-tenant OTel (§8): `langwatch.project_id` attribute drives routing.
- Auth cache (§9): L1 LRU + L2 Redis + optional bootstrap-all-keys + `/changes` diff sync.
- RBAC (§10): 2-segment `resource:action` convention matching existing repo: `virtualKeys | gatewayBudgets | gatewayProviders | gatewayGuardrails | gatewayLogs | gatewayUsage` + special actions `:rotate`, `:attach`, `:detach`.
- Internal-endpoint auth (§4): HMAC-SHA256 over `method\npath\ntimestamp\nsha256(body)`, ±300s replay window. Reference test vector committed.
- Bootstrap endpoint (§4.0): paginated pull-all-VKs for enterprise opt-in.

**Specs** (`specs/ai-gateway/`):
- `epic.feature` — 11 cross-cutting E2E scenario groups (golden path, hot-path zero-RTT, outage survival, hard+soft budgets, fallback with client-error exclusion, Anthropic cache_control invariant, SSE byte-for-byte, stream_chunk redaction, blocked tools, per-tenant OTel, health/readiness, RBAC E2E, Claude Code/Codex CLI).
- Drift-fixed Alexis's 3 feature files (VK format `lw_vk_live_` + 2-segment RBAC permissions).

**Docs** (`docs/`):
- `docs.json` nav: Documentation→Platform, Integrations→Observability, +AI Gateway anchor with 7 groups + 40+ pages.
- Real content (10 pages): overview, quickstart, concepts, virtual-keys, budgets, rbac, caching-passthrough, providers/fallback-chains, api/chat-completions, api/errors, self-hosting/helm, cli/overview, cli/claude-code, cli/codex.
- 26 stub pages covering providers / more CLI / more API / more self-hosting so Mintlify build succeeds.

## Team coordination log

- Joined `#langwatch-ai-gateway` as `@ai_gateway_andr`. Sergey=Lane A (Go service), Alexis=Lane B (platform UI/API), me=Lane C (specs/docs/QA).
- Three round-trips on contract before v0.1 lock: auth pattern, JWT-vs-config split, VK format (env-prefix Stripe-style won), HMAC with timestamp replay, path `/api/internal/gateway/*`.
- Arbitrated drifts between Sergey and Alexis's proposals; contract now canon, per-lane specs point to it.
- Collaborative commit behaviour in shared worktree: Alexis's pre-commit hook swept my uncommitted Lane C docs into her commit `7b24eade3`. Not a problem (all on same epic branch) but worth knowing.

## Decisions locked

1. **VK format:** `lw_vk_{live|test}_<26-char-ULID>` — 40 chars. Env prefix = Stripe-style accident insurance. ULID for monotonicity and dashboard sort order.
2. **VK hashing:** peppered HMAC-SHA256 (not argon2id). Fast, constant-time verify, lookup-by-hash, 130-bit ULID makes stretching pointless.
3. **Auth flow:** JWT-tiny (identity claims) + Config-fat (via ETag'd /config/:vk_id) + /changes long-poll for invalidation. L1 LRU + L2 Redis + opt-in bootstrap-all-keys.
4. **Path prefix:** `/api/internal/gateway/*` (not `/internal/gateway/*`), matches Hono mount.
5. **HMAC scheme v1:** `method\npath\nts\nsha256(body)` signed with shared secret. Test vector in contract.
6. **RBAC:** 2-segment `resource:action`, matches existing `project:manage` etc.
7. **Budget enforcement:** soft=header warn, hard=402 block, sum-of-all-breaches-blocks.
8. **Streaming:** byte-for-byte passthrough post-first-chunk, no mid-stream provider switch.
9. **Cache passthrough:** integration test asserts byte-level identity of forwarded payload for cache_control-carrying requests.
10. **Fallback:** does NOT trigger on 400/401/403/404 (client errors); DOES trigger on 5xx/timeout/429/network/circuit.

## Open for iteration 2+

- [ ] Competitor read-through: Bifrost, Portkey v2, Nexos (esp. their coding-CLI docs). Didn't fit in iter 1 context budget.
- [ ] CLI scenario tests (Claude Code, Codex, opencode) against Alexis's 501 stubs when they have real logic.
- [ ] Dogfood VK list/drawer UI with /browser-qa once Alexis's nav entry + VK list page lands.
- [ ] Fill real content for 26 stub docs pages (providers/*, cli/{opencode,cursor,aider}, guardrails, blocked-patterns, streaming, model-aliases, observability, api/{messages,embeddings,models}, self-hosting/{config,health-checks,scaling}).
- [ ] Per-region provider routing for data residency — tracked as open question in contract §12.
- [ ] Webhook for budget breach notifications.

## Useful file pointers

- Contract: `specs/ai-gateway/_shared/contract.md`
- Epic feature: `specs/ai-gateway/epic.feature`
- Lane B specs (Alexis): `specs/ai-gateway/{virtual-keys,budgets,gateway-provider-settings}.feature`
- Lane A specs (Sergey): `specs/ai-gateway/{gateway-service,health-checks,auth-cache,provider-routing,fallback,caching-passthrough,streaming,guardrails}.feature`
- Docs tree: `docs/ai-gateway/`
- Nav config: `docs/docs.json` (lines 51-, anchor "AI Gateway")
- My commits: `32bcba36a` (Lane C iter 1 follow-up)
- Sergey commits: `f551509` (langwatch-saas) + `0fb8a6936` (langwatch specs)
- Alexis commit: `7b24eade3` (Lane B + swept Lane C initial)

## Environment / conventions I relied on

- Worktree: `/Users/rchaves/Projects/langwatch/.claude/worktrees/wise-mixing-zebra` (shared with Sergey+Alexis; same branch `worktree-wise-mixing-zebra`).
- Go gateway service: `~/Projects/langwatch-saas/.claude/worktrees/feat-langwatch-ai-gateway/services/gateway/` (Sergey's worktree).
- BDD tag conventions in existing specs: `@integration`, `@visual` — reused.
- RBAC permission parsing: see `src/server/license-enforcement/member-classification.ts` (`resource:action`).

## What to do next ralph cycle

1. Read Alexis's new UI work (`langwatch/src/server/gateway/` just appeared) and update docs to match.
2. Fetch & synthesize Bifrost + Portkey + Nexos docs into a "competitor lessons" addendum in the contract.
3. Start `specs/ai-gateway/cli-integrations.feature` (not yet written) — targets Claude Code + Codex + opencode scenarios that our CLI scenario-test harness will exercise.
4. Write real content for the remaining 26 stubs (prioritise: providers/{openai,anthropic,bedrock,vertex,azure-openai}, cli/opencode, api/messages).
5. Dogfood with /browser-qa once Alexis ships the VK list page.
6. Commit with `[Lane C iter N]` tag.
