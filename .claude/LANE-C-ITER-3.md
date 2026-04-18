# Lane C (Andr) — Ralph Iteration 3 Learnings

## What shipped (commit `2ccbcdfd0` + follow-up SDK docs)

### Docs — 6 stub pages filled with real content
- `docs/ai-gateway/cli/opencode.mdx` — opencode provider config (OpenAI-compat + Anthropic-shape via `@ai-sdk/anthropic`), trace-propagation via `headers` field, governance recipes (hackday mode, blocked tools).
- `docs/ai-gateway/cli/cursor.mdx` — Cursor IDE setup (**Settings → Models → Override OpenAI Base URL**), Anthropic-shape via translation, per-engineer VK provisioning pattern, cheap-by-default autocomplete recipe.
- `docs/ai-gateway/cli/aider.mdx` — Aider config showing cache-aware repo maps via `/v1/messages` (critical for the 90% Anthropic cache discount on 20–50k-token repo maps), trace propagation via `OPENAI_EXTRA_HEADERS`.
- `docs/ai-gateway/self-hosting/config.mdx` — full env-var reference: secrets, routing, auth cache, provider tuning, tracing, guardrails+budgets, + operational defaults.
- `docs/ai-gateway/self-hosting/health-checks.mdx` — `/livez` `/readyz` `/healthz` semantics with K8s probe specs, end-to-end synthetic, graceful shutdown (30s drain + `preStop` sleep fix), common failure table.
- `docs/ai-gateway/self-hosting/scaling.mdx` — HPA (metric = inflight-requests-per-replica, NOT CPU), capacity baselines (5K req/s per 2-vCPU replica), connection pooling, ephemeral-port exhaustion, blue-green.

### CLI — `langwatch virtual-keys` subcommand
- `typescript-sdk/src/client-sdk/services/virtual-keys/virtual-keys-api.service.ts` — `VirtualKeysApiService` with `list / get / create / update / rotate / revoke`. Uses direct `fetch` (matches `secrets/list.ts` pattern) since `/api/gateway/v1/*` routes aren't in the generated openapi schema yet. Hits Alexis's Hono routes from iter 4 (`4e95415da`).
- `typescript-sdk/src/cli/commands/virtual-keys/{list,get,create,rotate,revoke}.ts` — 5 CLI command modules matching `model-providers/*.ts` style (chalk + ora spinner + formatTable). `create` and `rotate` show-once-secret formatting with explicit warning. `revoke` has no confirm (CLI is scriptable).
- `typescript-sdk/src/cli/index.ts` — registered `langwatch virtual-keys <subcmd>` (alias `vk`). Flags: `--name`, `--description`, `--env live|test`, `--provider <id...>` (repeatable), `--principal <userId>`, `--format text|json`.
- `pnpm typecheck` in `typescript-sdk/` passes.

### SDK docs — response headers cited (after @sergey's iter-4-pt1 traceparent propagation landed)
- `docs/ai-gateway/sdks/python.mdx` — added a "Response headers for correlation" table with `X-LangWatch-Trace-Id` (32-hex), `X-LangWatch-Span-Id` (16-hex), `traceparent` (re-injected), `X-LangWatch-Request-Id`. Added a SDK-less recipe using `opentelemetry.trace.propagation.tracecontext.TraceContextTextMapPropagator` for OTel-instrumented apps.
- `docs/ai-gateway/sdks/typescript.mdx` — parallel additions: response-header table + SDK-less `propagation.inject(context.active(), carrier)` recipe.

## Team coordination log (iter 3)

- @alexis iter 5: typecheck drift fixed (16 errors from UI drift + Prisma nullables + tRPC `.use()` chain + Dialog.Positioner + shared DTO import). Budget create drawer + `/gateway/budgets` list page with live progress bars ✅. Provider binding drawer + wire ✅. Next: materialiser + budget.service unit tests, then guardrail-check plumbing.
- @sergey iter 4 pt1: langwatch-saas `e9b04e6` — `internal/otel` package (`Provider`, `RouterExporter`, `Middleware`, `EnrichFromBundle`); 4 unit tests green. langwatch `134878648` — `specs/ai-gateway/trace-propagation.feature` (8 scenarios). Next: fallback engine + circuit breaker. Asked me (Lane C) to cite concrete response headers in SDK docs — **done** in this iter.
- Dev server boot: `pnpm install && pnpm start:prepare:files` already run, `pnpm dev` spins up cleanly at `http://localhost:5560`. Boot time ~45s.
- **Dogfooding blocker: Auth0**. Local dev redirects to Auth0 (`dev-frj2zgeo5352i1kj.us.auth0.com`) — no creds available in-session. Can't log in via playwright. Screenshot of login captured at `.claude/lane-c-iter3-01-auth0-block.png` as evidence the server booted. To dogfood in a future iter, either: (a) configure a test-email+password flow in Auth0, (b) switch dev to the Credentials NextAuth provider, or (c) have @rchaves run the browser-qa with his session. Ownership: Alexis is closer to this since she's on UI. **DO NOT** hardcode test creds into a CI or commit.

## Locked decisions (iter 3 additions)

1. **CLI uses direct `fetch` not openapi-typed client**: `/api/gateway/v1/*` routes aren't in `src/app/api/openapiLangWatch.json` yet. Service matches `secrets/list.ts` pattern (direct `fetch` + `formatFetchError`). Can retrofit once Alexis wires `hono-openapi` properly — it's a drop-in replacement.
2. **CLI alias `vk`**: `langwatch vk list` / `langwatch vk create ...`. Matches `kubectl` mental model and saves a lot of typing in demos.
3. **`create` requires explicit `--provider <id>` flags, at least one**: no auto-bind. Users must know which provider-credential ids to attach; help text hints at `langwatch virtual-keys providers` (future) or the UI.
4. **Response headers locked** (from @sergey's Lane A iter 4 pt1): `X-LangWatch-Trace-Id` (32-hex), `X-LangWatch-Span-Id` (16-hex), `traceparent` (W3C re-injected), `X-LangWatch-Request-Id` (ULID). Now cited verbatim in Python and TS SDK docs.

## Open items for iter 4

- [ ] **Dogfood VK UI** — blocked on Auth0 creds. Could reach out to @rchaves or @alexis to get past. Once in: screenshots for empty state + VK drawer + show-once-reveal + populated list + rotate + revoke, + new surfaces: Budget create drawer + `/gateway/budgets` page + Provider drawer (from @alexis iter 5).
- [ ] **End-to-end CLI test** — once dev server auth-accessible, run `langwatch virtual-keys create --name dev --provider <id>` against it, copy secret, hit `curl https://.../v1/chat/completions` against local gateway (Sergey's Go service). Capture into a scenario test under `skills/` or `typescript-sdk/src/cli/commands/__tests__/virtual-keys/`.
- [ ] **`langwatch virtual-keys update` command** (I shipped the service layer method but no CLI command yet — defer until there's a clear user need; rotate+revoke cover most flows).
- [ ] **`langwatch gateway-budgets` + `langwatch gateway-providers` CLI groups** — Alexis's public REST routes exist. Mirror the VK CLI pattern.
- [ ] **OpenAPI retrofit** — Alexis to wire `hono-openapi`'s `describeRoute` on gateway-platform; then VirtualKeysApiService can use typed client.
- [ ] **CLI scenario test** using real Claude Code CLI against a running gateway (depends on @sergey's bifrost dispatcher + @alexis's resolve-key both live — that's his iter 4/5).

## Iteration 3 end state

- 5 Lane C commits: `32bcba36a` (iter 1), `9a6281a72` (iter 1 memo), `58a220a2d` (iter 2), `29ccb640e` (iter 2 memo), `2ccbcdfd0` (iter 3), this file + SDK docs + LANE-C-ITER-3.md.
- `specs/ai-gateway/` unchanged — all locked behavior from iter 1/2.
- `docs/ai-gateway/` now has ~35 real pages. No remaining stubs except what was already noted as "overview-only".
- `typescript-sdk/` has a working `langwatch virtual-keys` CLI (pending real server to run against).

## Useful file pointers

- CLI: `typescript-sdk/src/cli/commands/virtual-keys/*.ts`
- Service: `typescript-sdk/src/client-sdk/services/virtual-keys/virtual-keys-api.service.ts`
- CLI registration: `typescript-sdk/src/cli/index.ts` (search `virtualKeysCmd`)
- Public REST (Alexis): `langwatch/src/app/api/gateway-platform/[[...route]]/app.ts`
- Shared service layer: `langwatch/src/server/gateway/{virtualKey,budget,providerCredential}.service.ts`

## What to do when iter 4 fires

1. Read `.claude/LANE-C-ITER-{1,2,3}.md`.
2. Check `kanban channel history langwatch-ai-gateway -n 30` for overnight activity.
3. Try to unblock Auth0 dogfooding — ping @rchaves or attempt the Auth0 test-user flow. If blocked, move to CLI `gateway-budgets` + `gateway-providers` command groups.
4. Once @sergey's fallback engine + circuit breaker land, update `docs/ai-gateway/providers/fallback-chains.mdx` with any concrete ordering/back-off values he chose.
5. Once guardrail-check plumbing lands (Alexis iter 5), cross-reference in `docs/ai-gateway/guardrails.mdx`.
