Fixes #6139, #6140, #6141, #6142, #6146.

Filed off this work rather than fixed here, because each is its own surface: #6149 (the dogfood seed script's half-completed write), #6150 (retired Anthropic model ids failing a live-API test on main), and #6155 (sign-in returns 403 on any port but 5560, and the UI will not say why).

#6155 is the one to read if you are about to QA this. `trustedOrigins` is pinned to `NEXTAUTH_URL`, so every worktree past the first, which is exactly what `check-ports.sh` tells you to run, lands on a port where signing in is impossible, and the toast says only `Failed to sign in`.

These four came out of a hands-on competitive benchmark of our AI Gateway against Kong, run from a brand new account on a from-scratch self-hosted install. Each one is a surface that looks complete in the UI and does not work.

## 1. Guardrails did not enforce anything (#6139)

Three independent defects, each on its own enough to let every request through.

**The control-plane endpoint was a stub.** `POST /api/internal/gateway/guardrail/check` validated the request and returned allow, with a log line admitting it: `"guardrail/check plumbing stub - returning allow"`. It now runs the evaluators bound to the virtual key's guardrails, scoped by project, filtered by archive state and direction, and aggregates them into one verdict.

**The two sides disagreed about the direction vocabulary.** The Zod schema accepted the Prisma storage values `pre` and `post`, while the data plane sends the contract's `request` and `response`. Every live gateway call failed validation, and the data plane treated that failure as permission to proceed. The wire vocabulary now lives in one exported constant.

**The two sides disagreed about the verdict field.** The Go client parsed `action`, the control plane returns `decision` per contract 4.6. There is no `action` field, so every response fell through to the allow default. This is the nasty one: replacing the stub alone would not have restored enforcement. Someone could have implemented real evaluation, watched it return `decision: "block"`, and the gateway would still have allowed the request.

**Guardrails also failed open unconditionally.** Any evaluation error was logged and the request proceeded, so a control-plane outage silently disabled every guardrail while the UI still showed them as active. The pipeline now honours the per-direction fail-open flags the bundle already carried, defaults to fail-closed, and returns `guardrail_upstream_unavailable` when it stops a request that way. Stream chunks stay fail-open by design so a slow policy service never stalls a user's stream.

Contract tests pin the wire shape from both sides, including a Go test that reads the TypeScript schema, so a rename on either side fails the build instead of quietly disabling enforcement.

## 2. Gateway Prometheus metrics were deleted, docs still promised them (#6140)

`services/gateway/internal/metrics/metrics.go` existed and was actively developed. Commit `45d960ecf` (#3342) renamed the service to `services/aigateway` and deleted the package rather than carrying it over, 301 lines plus 108 lines of tests. The docs kept documenting `gateway_requests_total` and friends in three places, so a self-hosting operator following our own observability docs scrapes an endpoint that is not served.

Restoring the surface turned up three things that are behaviour changes, not just observability:

**The circuit breaker was never wired.** `pkg/breaker` was fully implemented and documented, but `retry.Options.Breaker` was left nil in the same restructure that deleted the metrics. `gateway_circuit_state` could never have held a value and `circuit_open` could never have been an outcome, because nothing ever opened a circuit. It is wired now, so a repeatedly failing credential is skipped instead of retried into the ground. Config is the already-documented `LW_GATEWAY_CIRCUIT_{WINDOW_S,THRESHOLD,COOLDOWN_S}`.

**Health probes and `/metrics` no longer count as requests.** They were diluting the error-rate denominator that the documented alert divides on, so a quiet gateway with a high probe rate looked healthier than it was.

**The stream-chunk fail-open is now visible.** That direction swallows its evaluation error on purpose, so a slow policy service never stalls a stream a user is already reading. That stays. What changed is that it returned a plain allow, making a chunk that passed unchecked identical to a chunk a guardrail actually cleared. The verdict now carries the bypass, `gateway_guardrail_verdicts_total{direction="stream_chunk",verdict="fail_open"}` is a real series, and `langwatch.guardrail.stream_chunk_fail_open` on the span carries the reason. Four docs asserted that series could never appear and now say it is the one to watch.

Also removed rather than reimplemented: the docs promised five `gateway_budget_debit_outbox_*` metrics and `gateway_budget_check_live_total` for a component that was deliberately deleted, so those alerts and runbook sections were describing something that no longer exists.

## 3. Budgets did not accrue or enforce (#6141)

A project-scoped blocking budget of $0.0001 took 68 real proxied requests and still read `$0.00 / $0.0001, 0%`. Nothing was blocked and no warning header appeared. Budget enforcement rides on an asynchronous projection that did not fire, and the UI rendered a confident zero rather than saying so.

### Screenshots

![Budgets list](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-gateway-hardening/budgets/budget-list.png)

![Scope trap surfaced](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-gateway-hardening/budgets/scope-warning.png)

One frame carries both halves. A row reads `$0.003701 / $0.0035` at 100% with `block` on breach, which is spend accruing and actually enforcing, against the reported `$0.00 / $0.0001, 0%` after 68 proxied requests. Another carries `No key sends traffic here`: traffic is attributed to the project a key is scoped to, so a budget that no active key can reach stays at zero and never stops a request. That misconfiguration used to render as a confident `$0.00`.

![Budget detail](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-gateway-hardening/budgets/budget-detail.png)

![Budgets on a narrow viewport](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-gateway-hardening/budgets/budget-list-mobile.png)

The narrow viewport shot documents a pre-existing, section-wide layout problem rather than a fix: the card root is `overflow-x: hidden` over a table with a much larger min-width, so below roughly 1280px the RESETS column and the row menu cannot be reached. Not addressed here.

## 4. The coding-agents onboarding path creates no project (#6142)

Choosing "Track AI coding agents" creates an organization and a team and zero projects. Model Providers requires a project, so "Add Model Provider" opens a menu and then silently does nothing. A new buyer on that path cannot configure a provider, so the gateway cannot route.

### Screenshots

![Model Providers with no project](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-gateway-hardening/onboarding/model-providers-no-project.png)

![The action states why it is unavailable](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-gateway-hardening/onboarding/add-provider-disabled-reason.png)

The precondition is now stated and the disabled action explains itself, against the reported symptom of a menu that opened and silently did nothing, twice, with no error.

![Create the first project](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-gateway-hardening/onboarding/create-first-project-drawer.png)

![Adding a provider works once a project exists](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-gateway-hardening/onboarding/add-provider-works-after-project.png)

![No-project state on a narrow viewport](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-gateway-hardening/onboarding/model-providers-no-project-mobile.png)

## 5. The virtual-key drawer offered providers that could not route (#6146)

The drawer's eligible-provider preview counted rows the gateway would never use, and attributed every one of them to the current project regardless of where it actually came from. A buyer picking a scope was told the key could reach providers it could not, at a scope that was not true.

### Screenshots

**Before**

![VK drawer before](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-6143/vk-drawer/before-drawer.png)

`This VK will be usable within PROJECT:Demo and can fall back to 5 providers (114 models)`. A phantom `Groq · 7 models` is listed, and all five rows are badged `via PROJECT:Demo`, including the ones that are team-scoped and org-scoped.

**After**

![VK drawer after](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-6143/vk-drawer/after-drawer.png)

`This key works in Demo and can route to 4 providers (107 models)`. Groq is gone, Anthropic shows its real `Platform` team chip, and the rest show the `ACME` org chip. The 114 minus 107 delta is exactly the phantom's 7 custom models.

**After, dark mode**

![VK drawer after, dark mode](https://raw.githubusercontent.com/langwatch/pr-screenshots/main/pr-6143/vk-drawer/after-drawer-dark.png)

### Nothing archived was leaking, and there is no archive to leak from

Worth stating plainly, because the intuitive diagnosis is wrong. `ModelProvider` has no `archivedAt`, `disabledAt` is never written by app code, and delete is a hard delete. What leaked was rows with `enabled: false`, which the settings page filters and the drawer did not.

The two identically-named `Gemini` rows were two genuinely distinct rows, not one row counted twice. The model counts prove it: `modelCount = registry chat models + custom models`, and the Gemini registry has exactly 26, so one row carried 0 custom models and the other 15.

## Deployment Impact

**Env vars:** `LW_GATEWAY_CIRCUIT_WINDOW_S`, `LW_GATEWAY_CIRCUIT_THRESHOLD` and `LW_GATEWAY_CIRCUIT_COOLDOWN_S` are now read. They were already documented but nothing consumed them, because the breaker was never wired. Defaults apply if unset, so no action is required to upgrade. The guardrail path keeps using the existing `LW_GATEWAY_INTERNAL_SECRET` and `LW_GATEWAY_BASE_URL`, unchanged.

**Helm values:** the budget block in `charts/gateway/values.yaml` drops `outboxFlushInterval`, `outboxMaxRetries`, `liveThresholdPct` and `liveTimeout`, and gains `warnThresholdPct`. The four removed keys configured the debit outbox and the live budget-check call, both of which were deliberately deleted earlier; they had no effect. An operator who set them in their own values file should remove them, and should set `warnThresholdPct` if they were relying on `liveThresholdPct` for the warn threshold. The network policy also opens the metrics port for scraping.

**Behaviour on a vanilla `helm install` with no overrides:** this is the part to read before rolling out. Guardrails start enforcing. An operator who switched a guardrail on and saw it pass everything was looking at a stub that returned allow; after this, a guardrail whose evaluator fails the content blocks the request. Traffic that has been flowing through an "active" guardrail untouched can start being refused, which is the intended fix but is still a live behaviour change on upgrade. Guardrails also stop failing open by default: when the control plane cannot be reached, a virtual key that has not opted into fail-open now gets `503 guardrail_upstream_unavailable` on the request and response directions instead of silently proceeding. Stream chunks stay fail-open by design so a slow policy service never stalls a stream. Anyone who needs the old permissive behaviour sets the per-direction fail-open flag on the key, which the bundle already carried and the pipeline now honours.

**BYOC dataplane:** relevant, and ordering matters. The wire contract between the Go data plane and the control plane changed on both halves: the direction vocabulary is now the contract's `request` / `response` / `stream_chunk` rather than the Prisma storage enum, and the client reads the verdict from `decision` rather than the non-existent `action`. A BYOC data plane older than this change sends `pre` / `post`, which the new schema rejects with a 400. Deploy the control plane first, then the data plane: an old data plane against a new control plane fails its guardrail checks, and a fail-closed key will then block rather than pass traffic, so the window is visible instead of silent. Contract tests pin the shape from both sides, including one that reads the TypeScript schema, so a future rename fails the build rather than quietly disabling enforcement again.

**Database migrations:** one ClickHouse migration, `00055_gateway_budget_scope_totals_period_start.sql`, adds the period-start dimension the budget projection needs to accrue per window. It is additive and runs on deploy.

## Testing

Specs first, per the repo workflow. `specs/ai-gateway/guardrail-check-endpoint.feature` describes the seam from the operator's point of view, including that a wire mismatch must fail loudly rather than allow traffic.

- Go: `go build ./... && go test ./...` clean across all 16 packages in `services/aigateway`.
- TypeScript: `pnpm typecheck` clean.
- New integration coverage runs against real Postgres, not mocks. Only the evaluator call is injected, because it is the one boundary the service does not own. Project scoping, archive filtering, direction bucketing, failure modes and aggregation all run against real rows.

## Proof that guardrails now enforce

Run against a real running control plane, with requests signed exactly the way the Go data plane signs them, against real Postgres rows. Verbatim responses:

```
### fail-closed guardrail, evaluator cannot run
HTTP 200
{"decision":"block","reason":"guardrail evaluator failed to run","modified_content":null,"policies_triggered":["QA fail-closed"]}

### fail-open guardrail, evaluator cannot run
HTTP 200
{"decision":"allow","reason":null,"modified_content":null,"policies_triggered":[]}

### guardrail id belonging to another project
HTTP 200
{"decision":"allow","reason":null,"modified_content":null,"policies_triggered":[]}

### the storage vocabulary the schema used to accept
HTTP 400
{"error":{"type":"bad_request","code":"validation_error",
 "message":"Invalid enum value. Expected 'request' | 'response' | 'stream_chunk', received 'pre'"}}
```

The first line is the whole point. Before this change that same request returned `allow`, and the gateway would have called the provider.

## Test results

- `services/aigateway`: `go build ./...` and `go test ./...` clean across all 16 packages, `gofmt` clean.
- `pnpm typecheck`: clean.
- `pnpm check:feature-parity`: clean. Every `@integration` / `@unit` scenario in the three feature files this PR adds is bound to a test, 15 in `guardrail-check-endpoint.feature`, 10 in `budgets.feature`, 7 in `first-project-required.feature`.
- 15 guardrail service integration tests against real Postgres: project scoping, archive filtering, direction bucketing, both failure modes, the skipped-evaluator case, aggregation, and the missing-monitor case.
- 9 route integration tests driving the real Hono app with real signatures.
- 19 budget integration tests against real Postgres and ClickHouse, covering accrual per window, blocking, the warning threshold, unavailable spend, and scope reach.
- 13 first-project onboarding tests driving the Model Providers page.
- Go contract tests pin the wire shape from both sides, including one that reads the TypeScript schema so a rename on either side fails the build. That test no longer skips itself when the file is unreadable, which had made it a guard that could never fire.

Two things the specs asked for that no code implemented, both now real: a skipped evaluator must not block (a skip is the evaluator declining to judge, not one that could not run), and a fail-open bypass must be recorded on the span so the request that skipped its guardrail is identifiable rather than just counted in a log line.

<!-- This is an auto-generated comment: release notes by coderabbit.ai -->
## Summary by CodeRabbit

- **New Features**
  - End-to-end gateway guardrail evaluation for `request`, `response`, and `stream_chunk` with consistent `decision`, `reason`, and aggregated `policies_triggered`.
  - Gateway budgets now expose spend availability and “reachable/unreachable by any key”, including UI warning states when spend can’t be totalled.
- **Bug Fixes**
  - Correct fail-open vs fail-closed behavior for evaluator errors/unavailability; skipped outcomes don’t block.
  - Control-plane now strictly enforces valid verdict decoding, avoiding silent allow on unknown values.
- **API / Contract Updates**
  - `POST /guardrail/check` now validates contract directions/structured content and uses the `decision` wire field.
- **Tests**
  - Added integration/contract/endpoint tests for guardrails, budget enforcement, and ClickHouse period-start rollups, plus model provider UI/behavior coverage.
<!-- end of auto-generated comment: release notes by coderabbit.ai -->




