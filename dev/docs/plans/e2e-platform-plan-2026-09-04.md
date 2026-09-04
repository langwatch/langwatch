# End-to-end platform suites — plan (2026-09-04)

Alex asked for four things on 2026-09-04: browser tests that launch the
application and walk the product (sign up, organization, agent, evaluator,
simulation, run, results, evaluator hit, trace), and three outside-in suites
that drive a local platform through the TypeScript SDK, the `langwatch` CLI
and the MCP server. This plan fixes the shape; Opus lanes build it, one suite
at a time, each lane owning its stack.

Facts behind every decision here: `/Users/afr/.claude/jobs/eeb488e6/tmp/e2e-facts.md`
(browser surfaces, file:line) and `e2e-sdk-cli-mcp-facts.md` (SDK, CLI, MCP).
The build lane reads them before touching anything.

## What already exists, and what we keep

```
                     runs in CI          boots the stack   covers the journey
dev/tests/agentic-e2e   yes (e2e-ci.yml)   no (CI boots it)  agent → suite → scenario → run
apps/ui/e2e             no                 no (auth.json)    four stale prompt/workflow paths
sdks/typescript e2e     yes (heavy gate)   no (CI boots it)  spans, prompts, cli pull/push/sync/tag
mcp/typescript          yes                n/a               canned-response tool sweep, no MCP client
```

Decisions:

1. **`dev/tests/agentic-e2e` is the browser suite.** It is the one CI runs and
   its `tests/scenarios/steps.ts` already has working selectors for the
   agent → suite → scenario → run leg. We extend it; we do not start a second
   Playwright tree. `apps/ui/e2e/happy-paths/*`, `save-auth-state.ts` and the
   `auth.json` gate are deleted once their two useful paths (create workflow,
   prompt create) are ported as journey steps. The root `test:e2e` tombstone
   becomes the real script.
2. **Every suite reuses a stack when there is one, and boots one otherwise.**
   Resolution order: `LANGWATCH_E2E_BASE_URL`, then this worktree's haven stack
   (discovered through `haven status --json --agent`, skipped silently when
   haven is absent), then a stack already answering at `BASE_URL`, and only
   then a boot of its own. One
   shared helper, `dev/tests/e2e-stack/` (a small TypeScript package, no
   vitest config of its own): `startStack({ port })` runs
   `dev/scripts/dev-stack.sh` with `PORT`, `LANGWATCH_ENDPOINT=http://localhost:PORT`,
   `BLOCK_LOCAL_HTTP_CALLS=false`, waits on `GET /` (200 or 302), `GET /api/health`
   (204) and the worker `/healthz` (200), returns `{ baseUrl, stop }`. When
   `LANGWATCH_E2E_BASE_URL` is set it boots nothing and returns that. CI sets
   it; a developer runs the suite bare and gets a stack. Port slot per suite:
   browser 5600, SDK and CLI 5610, MCP 5620, so they never collide locally.
3. **The browser journey signs up fresh; the three outside-in suites use the
   seeded project.** Sign-up is part of the product and the browser test owns
   it. The SDK, CLI and MCP suites need a key before their first call, and the
   seed (`pnpm prisma:seed`, idempotent) gives `sk-lw-local-development-key` on
   `local-dev-project` with model providers from the environment. The helper
   exposes `seededProject()` with those constants read from
   `packages/prisma-client/prisma/seed.ts`, never retyped.
4. **"The evaluator was hit" is proven through a monitor, not through the
   scenario run.** A scenario run is judged by its own criteria; nothing in the
   scenario server references a project evaluator (facts §5). What does invoke
   a project evaluator on incoming traces is a monitor (online evaluation,
   `packages/features/monitor/web/src/screens/online-evaluations`). So the
   journey creates a code evaluator, creates a monitor that runs it on every
   trace, runs the simulation, and asserts the evaluation result appears on the
   run's trace. That is the product's real wiring, and it exercises the worker,
   nlpgo and the trace pipeline together.
5. **The target agent answers.** The run must complete, so the browser lane's
   global setup starts a tiny local HTTP agent (`node:http`, one route, echoes
   a fixed reply as `{ "output": "…" }`) on an ephemeral loopback port and
   registers it as the HTTP agent. The existing steps file points the agent at
   a dead address and accepts a failed run; the new journey does not.
6. **Model provider is a step, not a precondition.** A fresh self-hosted
   organization has no provider even with `OPENAI_API_KEY` in the environment
   (facts §4). The journey adds OpenAI at `/settings/model-providers` with the
   key from `process.env.OPENAI_API_KEY`, choosing `openai/gpt-5-mini`
   wherever a model is asked for. Without that variable the run leg and the
   monitor leg skip with the named reason `OPENAI_API_KEY not set`; every
   other leg still runs.
7. **Known platform gaps fail by name.** The trace transcript route is
   unmounted and workflow evaluate always refuses. Tests that cover them are
   written as they should pass and marked `test.fail` with a one-line reason
   naming the gap, so they turn red the day it closes and the marker has to
   go. Decision 20 is resolved and carries no marker: every REST family now
   answers at `/api/v1/{family}` as well as bare, so B, C and D address the
   canonical `/api/v1` form and the management families are ordinary legs.
8. **Specs first.** Each suite gets a feature file under `specs/e2e/` with
   `@e2e` scenarios, and every Playwright or vitest test carries
   `// @scenario "<title>"` verbatim. Error paths are scenarios too.

## Suite A — browser journey (`dev/tests/agentic-e2e`)

```
  global-setup                      journey specs (serial, one worker)
  ┌──────────────────┐   state      ┌────────────────────────────────────────┐
  │ startStack(5600) │ ───────────▶ │ 01 sign-up → onboarding → project slug │
  │ start echo agent │   .auth/     │ 02 model provider (OpenAI, gpt-5-mini) │
  │ (loopback port)  │   user.json  │ 03 agent: HTTP, url = echo agent       │
  └──────────────────┘              │ 04 evaluator: Custom (Code)            │
                                    │ 05 monitor: run evaluator on all traces│
                                    │ 06 suite → scenario → Save & Run       │
                                    │ 07 run drawer → verdict; Results tab   │
                                    │ 08 traces: run trace row; evaluation   │
                                    │    result from 04 on that trace        │
                                    │ 09 prompts + workflow (ported paths)   │
                                    │ 10 error paths                         │
                                    └────────────────────────────────────────┘
```

- `playwright.config.ts`: add `globalSetup` stack boot (decision 2), keep
  `workers: 1`, chromium, storage state from the `setup` project. Sign-up
  goes through the real `/auth/signup` form (labels in facts §1); the tRPC
  shortcut in `auth.setup.ts` stays only as the fallback for CI's seeded run.
- Onboarding path (facts §2): organization name, terms, `Next`, radio
  `Monitor & evaluate my LLM app`, `Finish`, then `Continue to LangWatch`;
  read the project slug from the address, never compute it.
- Step 08 waits with bounded polling on the traces table for a row whose
  trace belongs to the run (the run drawer exposes the trace id), then opens
  the trace drawer and asserts the evaluator's result by evaluator name.
- Error paths: sign-up with a mismatched password confirmation shows the
  field error; run dialog with no agent shows `Choose an agent to run against.`;
  run against an agent address that does not answer ends in a failed verdict
  with a named reason, not a blank drawer.
- Root `package.json` `test:e2e` runs this suite. `apps/ui` `test:e2e` and
  `test:e2e:save-auth-state` are removed with the stale tree.
- Selectors: `getByRole`/`getByLabel` first, existing `data-testid` second;
  a missing accessible name is fixed in the owning web package, never worked
  around.

## Suite B — SDK application (`sdks/typescript/__tests__/e2e/sdk-app/`)

A small application built only on the published surface (`langwatch`,
`langwatch/observability/node`, `langwatch/agent`), run by the existing
`vitest.e2e.config.mts` and `pnpm --filter langwatch test:e2e`, against
`startStack(5610)` or `LANGWATCH_E2E_BASE_URL`, with the seeded key.

Legs, in order, each its own file, each asserting through the platform's read
side (not through the request it just made):

1. **Traces**: `setupObservability`, an LLM span with input, output, metrics
   and a customer id, `shutdown()`, then poll `langwatch.traces` until the
   trace is searchable with the tokens and cost the pipeline computed. Bounded
   timeout; a hang is a failure (memory: OTLP body read once hung 120 s).
2. **Evaluation on a span**: `span.addEvaluation(...)` then read it back on
   the trace. **Evaluation by slug**: create a code evaluator through
   `langwatch.evaluators`, call `evaluations.evaluate(slug, …)`, assert the
   result; this needs nlpgo, which the stack starts.
3. **Prompts**: create, get with each fetch policy, compile, tag, sync from a
   local `prompts/` directory, delete.
4. **Datasets**: create, add records, list, update a record, delete.
5. **Agent from code**: `connectAgent` over `LANGWATCH_AGENT_TRANSPORT=http`,
   create a scenario and a test suite that targets it, run through
   `langwatch.testSuites`, poll `simulationRuns` to a terminal status, assert
   the handler was invoked. Skips with `OPENAI_API_KEY not set` when the
   platform has no provider for the simulator and judge.
6. **Experiments**: `experiments.init`, `evaluate`, results logged, then read
   through `experiments`.
7. **Management families**: organization, roles, scim-tokens, at their
   canonical `/api/v1` addresses. No marker — decision 20 is resolved.

## Suite C — CLI (`sdks/typescript/__tests__/e2e/cli/`)

Built CLI (`pnpm build` first, `helpers/cli-runner.ts`), same stack slot as B
(the lane runs B and C against one stack), credentials only through
`LANGWATCH_API_KEY` and `LANGWATCH_ENDPOINT` in the spawned environment
(never a config file, never the device flow; `login --api-key` is covered as
its own leg writing a temp `.env`). Legs: `whoami`; prompt `init/add/push/pull/sync/tag`
(existing, kept); `dataset` create and records; `evaluator` create/list;
`scenario` create; `test-suite` create and run; `simulation-run` list;
`agent` list/get; `trace search` and `trace get` for the SDK leg's trace;
`trace transcript` marked `test.fail` (unmounted route); the `organization`
family as an ordinary leg. Each command asserts exit code,
stdout shape (`--json` where the command has it) and the platform state it
changed, read back through the SDK.

## Suite D — MCP (`mcp/typescript/src/__tests__/e2e/`)

The first real MCP client in the repo: `@modelcontextprotocol/sdk/client`
`Client` over `StdioClientTransport` spawning `node dist/index.js --apiKey …
--endpoint …`, and a second run over `StreamableHTTPClientTransport` against
`--http` with the bearer session. `startStack(5620)` or the env override.
Legs: `tools/list` pins the tool names (a sorted snapshot in the test, so an
added or dropped tool is a visible diff); then one call per family with the
platform read back through the SDK: `platform_create_project` is out (needs an
org key), so: `platform_create_evaluator` → `platform_list_evaluators`;
`platform_create_dataset` + records; `platform_create_prompt` → `get`;
`platform_create_scenario` → `platform_create_test_suite` → `run_test_suite`
→ `platform_get_simulation_run` (skips without a provider); `search_traces`
and `get_trace` for a trace the SDK leg posted; `get_analytics`;
`discover_schema`. Error paths: a wrong key answers a tool error with the
`code`, not a stack; a missing endpoint fails at connect with a named reason.
Package script `test:e2e` added to `mcp/typescript/package.json`, run by
`pnpm --filter @langwatch/mcp-server test:e2e`.

## Lane order and what each lane must report

Sequential, one stack on the machine at a time: A, then B+C in one lane, then
D. Each lane: reads the two facts files and this plan; writes its `specs/e2e/*.feature`
first; builds; runs the suite for real end to end; fixes the tests; records
any product defect it hits in `dev/docs/plans/e2e-journey-2026-09-04.md`
(request, status, file:line) and makes the affected test fail with that named
reason; kills its stack. It never stages, commits, stashes, checks out,
resets, cleans, reads `.env*`, runs root typecheck/lint/format, or edits the
frozen OpenAPI documents. It reports: legs with pass/fail/skip and reasons,
the file list, the exact command, and the defects recorded. Root typechecks
and commits by pathspec.

## Out of scope for these lanes

Fixing product defects beyond an accessible name; the Stripe
webhook; the trace transcript route; CI workflow rewiring beyond pointing
`e2e-ci.yml` at the same commands (root does that after the suites are green).
