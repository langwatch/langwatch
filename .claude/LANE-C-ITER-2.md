# Lane C (Andr) — Ralph Iteration 2 Learnings

## What shipped (commit `58a220a2d`)

**Contract updates** (`specs/ai-gateway/_shared/contract.md`):
- §4.3 `/changes` now requires explicit `organization_id` query param.
- §11c Trace propagation headers (`traceparent`, `X-LangWatch-Trace-Id`, `X-LangWatch-Parent-Span-Id`, `X-LangWatch-Thread-Id`, `X-LangWatch-Trace-Metadata`). Avoids double-cost-attribution when caller already has a trace.
- §12 **Public REST API** — `/api/gateway/v1/*` with full endpoint table (virtual-keys / budgets / provider-credentials / usage). Uses existing LangWatch API tokens for auth. Shared service layer with tRPC routes — zero logic duplication, only mapper shape differs (snake_case vs camelCase).

**New specs**:
- `specs/ai-gateway/_shared/competitors.md` — Bifrost + Portkey + Nexos synthesis with feature matrix, LangWatch differentiators, design insights adopted, open research questions.
- `specs/ai-gateway/cli-integrations.feature` — 14 scenarios (Claude Code, Codex, opencode, Cursor, Aider, cross-CLI budget/revocation), including Codex `wire_api=responses|chat` mismatch handling.
- `specs/ai-gateway/cli-virtualkeys.feature` — langwatch CLI subcommand scenarios.

**Docs content (15+ real pages)**:
- Providers: `openai.mdx`, `anthropic.mdx`, `bedrock.mdx`, `azure-openai.mdx`, `vertex.mdx`, `gemini.mdx`, `custom-openai-compatible.mdx`, `overview.mdx`.
- Features: `guardrails.mdx`, `streaming.mdx`, `blocked-patterns.mdx`, `model-aliases.mdx`, `observability.mdx`.
- API reference: `api/chat-completions.mdx`, `api/messages.mdx`, `api/embeddings.mdx`, `api/models.mdx`, `api/errors.mdx`.
- CLI: `cli/langwatch-cli.mdx` (new, documents VK subcommands).
- SDK: `sdks/python.mdx`, `sdks/typescript.mdx` (integration patterns + trace propagation).
- Updated `cli/codex.mdx` with `wire_api` decision matrix (from Nexos docs).

**Nav** (`docs/docs.json`): +langwatch-cli page, +SDK Integration group.

## Team coordination log (iter 2)

- Contract drift: VK format + RBAC format — resolved with spec edits (iter 1 follow-up).
- @alexis iter 3: UI live (`/[project]/gateway/virtual-keys`), HMAC bodyHash fixed, `/changes?organization_id` wired.
- @sergey iter 2: bifrost dispatcher wired, streaming SSE passthrough, HMAC integration tests against httptest control plane, Helm chart shipped.
- New priority from @rchaves: CLI for VK management + trace-id propagation.
- Ownership split: Lane C owns `langwatch virtual-keys {...}` CLI + SDK trace-propagation docs; Lane A owns data-plane header acceptance; Lane B owns Hono public REST API.
- Dev server boot issue: `ts-to-zod` missing, node_modules not installed. Needs `cd langwatch && pnpm install && pnpm start:prepare:files` before `pnpm dev`. Dogfooding deferred to iter 3.

## Locked decisions (iter 2 additions)

1. **Public REST API path**: `/api/gateway/v1/*` (customer-facing), `/api/internal/gateway/*` (gateway ↔ control-plane).
2. **Shared service layer**: Hono REST routes and tRPC routes both call `VirtualKeyService`, `GatewayBudgetService`, `GatewayProviderCredentialService`. No code duplication.
3. **REST snake_case vs tRPC camelCase** — separate mappers in `src/server/gateway/mappers/`, shared core service types.
4. **Trace propagation headers**: both W3C `traceparent` (preferred, SDK-native) and `X-LangWatch-Trace-Id` override. Gateway parents its span under incoming trace context; emits `X-LangWatch-Trace-Id` on response when it creates a new trace.
5. **SDK headers helper**: `langwatch.get_gateway_headers()` (Python), `getGatewayHeaders()` (TS). Ship with SDK releases ≥ v0.22 (Python) / v0.26 (TS) coordinated with gateway GA.
6. **Codex `wire_api`**: mismatch between model family and endpoint → `400 bad_request` with a helpful hint (`set wire_api = "chat" in your Codex config`).

## Open items for iter 3

- [ ] Actually implement `langwatch virtual-keys {list,create,rotate,revoke,get}` CLI (TS code in `typescript-sdk/src/cli/commands/virtual-keys/*.ts` + client-sdk service). Depends on Alexis's public REST API being live (landed in iter 4 per her channel msg).
- [ ] Dogfood UI: run `cd langwatch && pnpm install && pnpm start:prepare:files && pnpm dev`, then `/browser-qa` the 6 flows Alexis listed:
  1. Empty-state + CTA
  2. New VK drawer
  3. Show-once-secret dialog
  4. Populated list
  5. Rotate action
  6. Revoke action
- [ ] Write real content for still-stub CLI pages: `cli/opencode.mdx`, `cli/cursor.mdx`, `cli/aider.mdx`, `cli/overview.mdx` (overview is real but could expand).
- [ ] Write real content for still-stub self-hosting pages: `self-hosting/config.mdx`, `self-hosting/health-checks.mdx`, `self-hosting/scaling.mdx`.
- [ ] Draft OpenAPI spec if `hono-openapi` plays nicely (Alexis noted `describeRoute` is verbose; can defer).
- [ ] CLI scenario test using real Claude Code + Codex + opencode against a running gateway. Depends on Sergey's bifrost dispatcher + Alexis's real resolve-key flow being live together (iter 4 / iter 5).

## Iteration 2 end state

- 4 commits on Lane C: `32bcba36a` (iter 1), `9a6281a72` (iter 1 memo), `58a220a2d` (iter 2), this file (iter 2 memo).
- `specs/ai-gateway/` has: `_shared/{contract.md, competitors.md}` + 13 feature files + epic.feature.
- `docs/ai-gateway/` has: 5 groups (overview/quickstart/concepts, virtual-keys/budgets/rbac, providers/* (8), features (5), cli/* (7), api/* (5), self-hosting/* (1+3 stubs), sdks/* (2)). ~30 real content pages.

## Useful file pointers (unchanged from iter 1, re-confirmed)

- Contract: `specs/ai-gateway/_shared/contract.md`
- Competitor synthesis: `specs/ai-gateway/_shared/competitors.md`
- Epic feature: `specs/ai-gateway/epic.feature`
- CLI specs: `specs/ai-gateway/cli-integrations.feature`, `specs/ai-gateway/cli-virtualkeys.feature`
- Docs tree: `docs/ai-gateway/`
- My commits: `32bcba36a`, `9a6281a72`, `58a220a2d`
- Sergey's iter-2 (langwatch-saas): `0125ff2` (approx)
- Alexis's iter 3: `593571fb4` (VK UI), iter 4: `4e95415da` (public REST + budgets backend)

## What to do when iter 3 fires

1. Read this file + LANE-C-ITER-1.md.
2. Run `cd langwatch && pnpm install && pnpm start:prepare:files` to fix the dev-server boot issue.
3. Start `pnpm dev` in background and watch the server log until ready.
4. Spin up Playwright via `/browser-qa` and capture the 6 dogfood screenshots.
5. Implement `langwatch virtual-keys` CLI commands under `typescript-sdk/src/cli/commands/virtual-keys/` once Alexis's `/api/gateway/v1/virtual-keys/*` is live.
6. Fill the remaining stub docs (cli/{opencode,cursor,aider}, self-hosting/{config,health-checks,scaling}).
