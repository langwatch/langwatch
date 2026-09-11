# LangWatch

LLM Ops platform for evaluation, observability, and optimization of AI agents and pipelines.

## Before You Implement Anything

**Check `specs/` first.** Feature files ARE the requirements.

```
ls specs/                    # Find relevant subdirectory
cat specs/foo/bar.feature    # Read the scenarios
```

If no feature file exists for your task, create one before writing code.

**For frontend work, read the UX docs first.** Before any non-trivial frontend change (anything beyond a specific, targeted tweak the user spelled out), read the relevant pattern docs under `dev/docs/best_practices/` so you extend existing patterns instead of reinventing them. The UI ones: `react.md`, `drawers.md`, `row-actions-overflow-menu.md`, `selection-action-bar.md`, `scope-selector-and-badges.md`. If the surface you are building has no doc yet, write one as part of the change.

**Error paths are part of the feature, not an afterthought.** Any code that can fail — a route, a service method, a mutation, a form submit — ships its failure modes deliberately: read `dev/docs/best_practices/error-handling.md` and [ADR-045](dev/docs/adr/045-domain-errors-handled-boundary.md). The rule in one line: throw a `HandledError` **only** when we know the cause _and_ the caller can act on it; everything else stays a plain `Error` and correctly degrades to a generic "unknown" plus a trace id. When you add a feature, name its expected failures in the spec alongside the golden path, and give each one a stable `code`, customer-safe `message`, correct `fault`, remediation copy, and an entry in the client presentation registry (`packages/handled-error/src/presentation.ts`) — that registry, keyed by `code`, is where the words a customer actually reads live. "Unknown error" reaching a user for a failure we could have named is a bug in the feature, not a gap in the error system. **A failure scenario in a spec enforces nothing until it is tagged and bound.** `check-feature-parity.ts` only counts scenarios carrying `@unit`, `@integration`, `@e2e` or `@regression` (and skips `@unimplemented`), so an untagged `.feature` file reports `0/0 scenarios bound` / `✓ all bound` and reads green while binding nothing at all. Every scenario you write for an error path needs a binding tag **and** a `@scenario "<title>"` annotation on the test that covers it, or it is vacuously bound.

## Development Environment

The product is four Node applications — `apps/ui` (the browser application, Vite), `apps/api` (tRPC + REST + SSE), `apps/worker` (queues, schedulers, projections) and `apps/tasks` (one-shot migrations and backfills, run before the API serves and on demand) — plus two Go services, `services/aigateway` and `services/nlpgo`. The three long-running ones always run: a stack missing one serves pages and quietly processes no jobs, which looks identical to a healthy one until a job was expected to have run.

`.env` lives at the **workspace root**. Every application resolves it from there (`apps/ui`'s Vite config loads `../../.env`; the api and worker start scripts pass the same path to `--env-file-if-exists`), so there is no per-application dotenv any more. haven's own resolved values — hostnames, ports, database URLs — are **not** a second file: it injects them into every process it starts, and `eval "$(haven env)"` puts the same set in your shell (`haven env --json` for a machine reader, `haven status` to just look at them).

`make quickstart` is the single entry point. It asks what you're working on and starts only the services you need, overriding only the URLs whose services are local. Your `.env` is the source of truth for everything else.

### Running with no container runtime

Nothing in the day-to-day loop needs Docker or colima. If you run ClickHouse,
Postgres and Redis natively (brew, or a LaunchAgent), point `.env` at them and
set these two, and `make haven up` brings up the whole application stack,
everything except the observability container, with no container runtime
installed at all:

```bash
LANGWATCH_HAVEN_CH=0          # use .env CLICKHOUSE_URL instead of a managed container
LANGWATCH_HAVEN_OBS=0         # skip the LGTM telemetry stack
```

The langyagent worker needs no third knob: a development stack with no container
runtime reachable resolves the host tier by itself and prints one line saying so
on `up`. `LANGY_UNSAFE_HOST_ACCESS=0` refuses that and keeps the sandboxed tier
(langy then does not start without a runtime); `=1` still forces the host tier on
a machine that does have one.

haven resolves its own knobs from `.env` as well as the shell, so these travel
with the worktree; an exported variable still wins for a single run. Postgres and Redis stay haven-managed either way: it
starts them through brew, not a container.

Tests follow the same rule. `pnpm test:unit` never needed a container, and
`pnpm test:integration` runs against native services when
`LANGWATCH_TEST_CLICKHOUSE_URL`, `LANGWATCH_TEST_REDIS_URL` and
`LANGWATCH_TEST_DATABASE_URL` are set, using dedicated test databases so dev
data is untouched (`specs/ci/no-docker-integration-tests.feature`). Suites that
need several mutually isolated ClickHouse endpoints ask
`startTestClickHouseEndpoints` for them rather than starting their own
containers. `CI=1` disables the native mode and forces testcontainers, so locally
run the owning package's own `test:integration` script (only packages whose vitest config declares a datastore have one; the root `pnpm test:integration` is a stub that exits 1 and says so) and never `CI=1`.

What still wants a container: `make observability` (the Grafana LGTM stack) and
the sandboxed/container langy tiers. Both are opt-in.

### Where secrets come from locally

`packages/secrets/keys.json` classifies every environment variable that carries
a credential — 29 `secret`, 10 `composite` (a connection string: shape *and*
password), 1 `pointer`, and everything else `config`. It is the one source of
truth: `@langwatch/secrets` parses it with Zod and haven reads the same file in
Go, so a key added once is masked everywhere. See
[ADR-132](dev/docs/adr/132-secrets-are-not-config.md).

Nothing changes if you do nothing. Each application's boot seam resolves the
classified keys through an ordered chain **before** its Zod parse — shell
environment and `.env`, then 1Password when you opt in, then a refusal naming
what is missing — and hands the runtime a frozen record of plain values, so
every feature downstream sees exactly what it saw before. Each process prints
one boot line naming which source answered which secret, by key name, never by
value.

To keep credentials off disk, set `LANGWATCH_SECRETS_VAULT` to a 1Password
vault. A `.env` value written as `op://vault/item/field` is resolved through the
`op` CLI; a key with no value at all is looked up at
`op://<vault>/langwatch-<profile>/<KEY>`, where the profile is
`LANGWATCH_SECRETS_PROFILE` (default `dev`) — an explicit profile, **not** the
worktree name, so a directory rename cannot silently turn a secret into an
absent one. Add `LANGWATCH_SECRETS_GENERATE=1` and a first launch mints the four
generate-on-first-run values into the vault instead of into `.env`. Resolution
is never attempted when `NODE_ENV=production`: a pod reads the environment
Kubernetes gave it and nothing else.

`haven env` masks every classified key now; `haven env --reveal` prints values,
so `eval "$(haven env --reveal)"` is the shell form and plain `haven env` is the
one safe to paste into an issue.

Never read `.env` to find a value and never print one. `langwatch/secrets-through-source`
refuses `process.env.<SECRET_KEY>` outside the secrets package, a `platform/config/`
module, a process boot file and a test.

### Local dev by hostname — thuishaven / portless (recommended)

Stop juggling ports. Opt in with `make haven up` and traffic routes through
**`haven`** (the Go orchestrator in `tools/thuishaven`, binary `cmd/haven`), which
gives every worktree's services a
stable hostname via the [portless](https://github.com/vercel-labs/portless) proxy —
`app|gateway|nlp.<slug>.langwatch.localhost`, where `<slug>` is the worktree's own
directory name, sanitised (a checkout at `.../worktrees/portless` is the `portless`
stack). The UI and its API share one origin — open `app.<slug>...` for the UI,
hit `app.<slug>.../api` for the API. `.localhost` resolves to loopback natively,
so there is no `/etc/hosts`, DNS, or sudo for name resolution, and two worktrees
can never collide.

haven supervises **two** Node lanes — `ui` and `backend`, each `pnpm --filter
<package> dev` from the workspace root — beside a single `go` lane hosting the
data-plane services. None is selectable (`haven up ±workers`, `±api` and
`±backend` are refused by name); `haven logs ui`, `haven restart backend` and
`haven status --json`'s `lanes` array all name the same lanes. `haven logs go`
is where the gateway and the NLP engine now read, and restarting either means
restarting the lane — offering `gateway` on its own would silently take the NLP
engine down with it.

Hostname routing is **opt-in** — `pnpm dev` uses the plain `PORT`+offset scheme;
`make haven up` (or `make haven up`) routes through haven.

```bash
make haven up          # == make haven up (bootstraps portless itself on first run)
make haven install      # optional: go install so plain `haven ...` works everywhere
make haven status       # every stack, service health, shared servers — one shot
haven up +langy         # add a service to this worktree's stack, sticky
haven logs nlp -t       # tail one service's logs from any terminal
```

Open `https://langwatch.localhost` for the cross-worktree dashboard;
`observability.langwatch.localhost` proxies the local Grafana LGTM stack;
`telemetry.langwatch.localhost` fans OTLP out to every running stack. haven's
resolved config never touches disk — `eval "$(haven env)"` loads it into a
shell, and `haven up` deletes a `.env.portless` or `.env.haven` an older haven
left behind. Agent-driving haven? Add `--agent` (or
`HAVEN_AGENT=1`) for plain, token-free output; `haven status --json` is
machine-readable. See `tools/thuishaven/README.md`.

```bash
make quickstart                        # Interactive preset picker
make quickstart all-local              # Local CH + PG + Redis + app + workers, no NLP (fast iteration default)
make quickstart all-local-nlp          # all-local + nlpgo + langevals
make quickstart dev-storage            # Local DBs + workers, stored-objects -> dev S3 (runtime-storage-dev)
make quickstart dev-infra              # Local app + redis + workers compose; shared dev for PG/CH/NLP/S3
make quickstart frontend-only          # No compose, fastest — UI / design work
make quickstart migration              # postgres + clickhouse on host ports for prisma migrate (no app, no workers)
make quickstart full-local             # Kitchen-sink local: all-local-nlp + dedicated workers container + ai-server
make quickstart-help                   # Non-interactive preset reference
make down                              # Stop all services
make service svc=aigateway             # Start the Go AI Gateway data plane on :5563
make help                              # Full target list including boxd workflows
```

The preset-picker writes `.env.dev-up` listing only the URLs to override; everything else comes from your `.env`. **Credentials never go in the overlay** — only non-rotating infrastructure shape (bucket / endpoint / region / connection-host). For `dev-storage`, refresh AWS SSO credentials in `.env` first via `bash dev/scripts/refresh-dev-s3-env.sh` (the launcher hard-fails without S3_SESSION_TOKEN).

The legacy `make dev` / `make dev-nlp` / `make dev-scenarios` / `make dev-test` / `make dev-full` aliases were removed in #4053. Use the preset names directly. `make dev-up` / `make dev-down` / `make dev-logs` still exist for per-worktree isolated stacks (the `dev-up.sh` use case — separate from `quickstart`).

Stateful services (`langwatch-db-data`, `langwatch-clickhouse-data`, `langwatch-redis-data`) share data across worktrees: sign up once, persist across worktree switches. Only one worktree can have postgres or clickhouse `up` at a time — `quickstart` detects collisions and points at the other compose project. Redis is a singleton on host `:6379`.

For per-PR / per-issue cloud environments via boxd, see `dev/docs/runbooks/boxd-makefile.md` and `make boxd-help`.

See `dev/docs/adr/004-docker-dev-environment.md` for architecture decisions.

**Running the applications outside Docker (the default for TS work):** just run `pnpm dev` from the repo root (or `PORT=5570 pnpm dev` for a second instance). It runs `dev/scripts/dev-stack.sh`, which derives every port from `PORT`, starts the ui and backend lanes under `concurrently`, and adds the one Go lane when its toolchain is present and nothing already holds its ports. You never need to hunt processes by hand. If the ports are already held, `dev/scripts/check-ports.sh` refuses to start and prints two ready-to-paste options: a free-port-slot command (`PORT=5570 pnpm dev`), and a one-liner that kills only the node processes holding those exact ports by process group (Docker and everything else are left alone). Paste whichever fits. Do not reinvent process-tree walking, `pkill -f`, or pgid hunting; `dev/scripts/kill-dev-tree.sh` already does it correctly and port-scoped.

**Two local processes, no switch.** Locally `pnpm dev` runs **one** Node process for the backend — the api application and the worker application together — and **one** Go process for the data-plane services. Production is unchanged: three Node deployments and each Go service its own container.

The backend lane is a **launcher, not a process role**. Each application still resolves its own secrets, parses its own config and composes its own graph, once each, in the same order it does alone; neither shares a Prisma client or a Redis connection with the other; both health and metrics endpoints keep working. `WORKERS_IN_PROCESS` and `START_WORKERS` are still dead — nothing reads either, haven still refuses a stack whose environment carries one whichever way it is set, and no value of either changes what the launcher starts. Boot order is worker then api; **shutdown drains the worker before closing the api listener**, because worker jobs call back into the api's in-process graph.

| Script             | What runs                                                      |
| ------------------ | -------------------------------------------------------------- |
| `pnpm dev`         | `ui` + `backend` + `go` (+ `langy` when selected)              |
| `pnpm dev:ui`      | the browser application alone                                  |
| `pnpm dev:backend` | the api and the worker in one process                          |
| `pnpm dev:go`      | aigateway + nlpgo in one process                               |
| `pnpm dev:api`     | the API alone, its own process                                 |
| `pnpm dev:worker`  | the background worker alone, its own process                   |

Use `dev:api` + `dev:worker` when you need the production process shape — one shared event loop locally means a worker job that blocks it reads as API latency, and one crash takes both. `langyagent` keeps its own lane: it owns per-conversation worker subprocesses, so it must not be restarted with the rest of the Go code.

Both lanes **restart on change, debounced** (this is restart-on-change, not module swapping): the Node lane through `dev/scripts/dev-supervisor.mjs --watch`, the Go lane through `air`, which restarts only on a build that succeeded. One knob sets both quiet periods — `LANGWATCH_DEV_WATCH_DEBOUNCE_MS`, default **750 ms** — so a write storm from an agent is one restart, not hundreds.

The port layout is unchanged and still derived from `PORT` (default 5560): the ui lane binds it, the api `PORT + 1000`, the worker's metrics/healthz listener `PORT - 2561`, and the gateway `PORT + 3`. See `dev/docs/adr/004-docker-dev-environment.md` (Amendment, 2026-09-07: two local processes) and `specs/setup/haven-local-topology.feature`.

### AI Gateway (Go, services/aigateway/)

The gateway is a separate Go service (not in `dev/compose.dev.yml`) that terminates
virtual-key traffic, fans out to providers via Bifrost, and reports usage back to
the control plane. `pnpm dev` auto-starts it alongside vite + api when the Go
toolchain is on PATH; the process appears as `gateway` in the concurrent output
and reuses an existing listener on :5563 if another worktree already booted one.
Set `LANGWATCH_SKIP_AIGATEWAY=1` to opt out (e.g. TS-only contributors) — that
variable is for plain `pnpm dev`; under haven the equivalent is `haven up
-gateway`, which sticks (`haven up` refuses the variable and says so). To run
the gateway standalone:

```bash
make service svc=aigateway       # run once
make service-watch svc=aigateway # live reload via air
```

Requires `.env` with `LW_GATEWAY_INTERNAL_SECRET`,
`LW_GATEWAY_JWT_SECRET`, and `LW_GATEWAY_BASE_URL` set — see the
"AI GATEWAY" block at the bottom of `.env.example`. Generate
secrets with `openssl rand -hex 32`. The Go gateway and the TS
control-plane both source the same `.env`, so each secret lives in
exactly one place (no prefix duplication). Set
`FEATURE_FLAG_FORCE_ENABLE=release_ui_ai_gateway_menu_enabled` to unhide the UI.

### NLP Engine (Go, services/nlpgo/)

`nlpgo` is the Go NLP engine that runs optimization-studio executions and
evaluators. `pnpm dev` auto-starts it alongside vite + api when the Go toolchain
is on PATH; the process appears as `nlpgo` in the concurrent output. It binds the
port the app dials via `LANGWATCH_NLP_SERVICE` (default `:5561`, otherwise PORT+1)
and reuses an existing listener if another worktree already booted one. When
`LANGWATCH_NLP_SERVICE` points at an external host, no local engine is started.
Set `LANGWATCH_SKIP_NLP=1` to opt out — that variable is for plain `pnpm dev`;
under haven the equivalent is `haven up -nlp`, which sticks (`haven up` refuses
the variable and says so). To run it standalone:

```bash
make service svc=nlpgo       # run once
make service-watch svc=nlpgo # live reload via air
```

### Langy agent manager (Go, services/langyagent/)

`langyagent` is the manager a Langy turn runs in: it spawns one `langy-worker`
subprocess per conversation, on the **pi** harness — the only one it can spawn.
`pnpm dev` auto-starts it on `PORT + 4` when the Go toolchain is on PATH; the
process appears as `langy` in the concurrent output, reuses an existing listener
on that port, and follows `LANGY_AGENT_URL` instead when an env file pins one
(external addresses start nothing). Nothing needs configuring first: the
launcher writes the Langy block into `.env` on its first run — the shared
secret, the session and workspace roots, `LANGY_UNSAFE_DEV_DISABLE_ISOLATION`
(the ADR-033 per-worker UID sandbox needs root, which a laptop process has not)
and `release_langy_enabled` on the forced-flag list — and never overwrites a
value you set. Those defaults are development only: the launcher writes nothing
when `NODE_ENV=production`, and the manager refuses the isolation bypass
whenever `ENVIRONMENT` is not local-like. A chat also needs the worker binary,
`pnpm --filter @langwatch/langyworker build:binary` (needs bun); the startup
line says so when it is missing, along with the harness, the isolation posture
and the address. `LANGWATCH_SKIP_LANGY=1` opts out of the lane; under haven the
equivalent is `haven up -langy`. To run it standalone:

```bash
make service svc=langyagent       # run once
make service-watch svc=langyagent # live reload via air
```

## Commands

From the repo root:

```bash
pnpm typecheck        # apps/api, apps/worker, apps/ui — one project each, tests included
pnpm typecheck:one @langwatch/eventing   # or a directory: pnpm typecheck:one packages/eventing
pnpm typecheck:all    # every workspace package. What CI runs; minutes, not seconds
pnpm lint             # oxlint + architecture-lint, the only JavaScript/TypeScript linters
pnpm format           # oxfmt, the only formatter
pnpm test             # every workspace package's own suite
```

There is no whole-tree TypeScript project: `pnpm typecheck` is a fanout that
runs `tsc --noEmit -p tsconfig.test.json` once per application, and that
project is the superset — colocated `src/**/__tests__/**` and `tests/**` are
both inside it. So `pnpm typecheck` DOES check test files. Each application
also keeps a `tsconfig.json` without the tests, for the editor and for anything
that needs to ask what the shipped source alone compiles to; nothing runs it as
a second pass, because checking the same 9,000 files twice per application cost
more than everything else in the command put together.

Project references are ruled out here, so an application is the smallest unit
`typecheck` knows. `pnpm typecheck:one <package>` is the smaller one: name a
workspace package or its directory and it type-checks that package alone,
through the same queue — seconds for a feature package against most of a minute
for a whole application.

Tests are per package now — each application and each feature package owns its
`vitest.config.ts` and its own `test` script:

```bash
pnpm --filter @langwatch/platform-api test      # apps/api
pnpm --filter @langwatch/worker test            # apps/worker
pnpm --filter @langwatch/ui test                # apps/ui
pnpm --filter @langwatch/trace-server test      # one feature package
pnpm --filter @langwatch/ui test:e2e            # Playwright
```

**`.integration.test.ts` still states a test LEVEL** — renders a component,
mocks its boundaries — and that is still the right name for such a test. The
automatic component-versus-datastore LANE SPLIT is gone: it lived in the
platform application's two vitest configs and `src/test-utils/integrationLanes.ts`,
and it went with them. Each package now declares what it needs in its own
config, and a package with no datastore never boots one. If you add a test that
reaches Postgres, ClickHouse or Redis, say so in that package's config rather
than relying on a repository-wide rule to notice.

**Whole-repo checks take a machine-wide slot.** A typecheck holds a 2.3 to
3.5 GiB working set and uses every core — though what you see in Activity
Monitor is its footprint, which expands toward whatever `GOMEMLIMIT` the queue
gave it (ADR-100). That is fine once and ruinous four times over, so
`typecheck`, `typecheck:one`, `typecheck:all`, `lint`, `lint:fix` and `format` all go through
`dev/scripts/check-queue.mjs`. It
counts the runs live across every worktree, terminal and agent on the machine
against **one** counter (they compete for the same cores), and a run past the
limit waits its turn instead of piling on. With haven installed the wrapper
delegates the run to `haven slot run`, which gates on the same flock semaphore
`haven typecheck` holds — the queue's decisions are Go code in
`tools/thuishaven`, and the JS queue is only the fallback for machines without
haven (`CHECK_QUEUE_IMPL=js` forces it). With a slot free it prints nothing
and is otherwise transparent (same stdio, same exit code). Queued, it says so on
stderr, which is what tells you a slow run was waiting rather than hung.
`CHECK_SLOTS=N` overrides the limit, and `CHECK_SLOTS=0` turns the queue off
from a person's shell only: agent shells carry `CLAUDECODE`, and a gate-off
there is ignored with a note (never set `CHECK_SLOTS` yourself — the queue
exists to serialize agents). Unset, the limit comes from the machine (one per
6 GiB of RAM, capped at one per 4 cores) and CI does not queue at all. `node dev/scripts/check-queue.mjs
--explain` shows the limit and who currently holds a slot. Don't cap a tool's
own threads instead (`RAYON_NUM_THREADS` works on the Rust tools): it spends
the same CPU over 5x the wall clock. See `specs/setup/check-slots.feature`.

**Going around the scripts does not go around the queue.** The workspace
root's `node_modules/.bin/{tsc,tsgo}` are shims installed by
`dev/scripts/install-check-shims.mjs` from postinstall, so `pnpm exec tsc
--noEmit -p apps/api/tsconfig.json` and `./node_modules/.bin/tsgo -p ...` take a
slot too. Only whole-tree runs do: a `-p`/`--project`, a directory argument, or
no path argument at all. Naming files (`tsc --noEmit src/foo.ts`) stays instant
and unqueued, and `--watch` / `--lsp` never queue, since they would hold a slot
for the session. A run that already holds a slot exports `CHECK_SLOTS=0` with
its pid in `CHECK_QUEUE_HELD` to everything it spawns, so it can't queue behind
itself; the marker only convinces a descendant of that run, and only when the
pid names one of the queue's own wrappers. The installer stands
down entirely when `NODE_ENV=production` or `CI` is set to anything but `0` or
`false`, so an image build or a server install keeps pnpm's own bin entries.

One catch on targeted runs: with a `tsconfig.json` present, `tsc --noEmit
<file>` fails with `TS5112` unless you add `--ignoreConfig`. That error is what
pushes people to widen the command to a whole `-p` run of the nearest project.
Reach for `pnpm typecheck:one <package>` instead — it is the narrow run, and it
queues — and keep `--ignoreConfig` for the single-file case.

When debugging locally, **prefer the observability stack over the log file if it is up** (haven starts it by default; `make haven status` confirms). Query the real logs/traces/metrics by attribute with `gcx` — Grafana's CLI, wired by `make observability-connect` — instead of grepping a giant `server.log`: indexed attribute search finds the failure far faster, and with the stack up the console is muted to warn+ anyway so the detail only lives in Grafana. Filter to your own worktree with the `langwatch_worktree` structured-metadata field (a pipe filter, not a stream label), e.g. `gcx logs query '{service_name="langwatch-app"} | langwatch_worktree="<slug>"' --since 15m` and `gcx traces query '{ resource.service.name = "langwatch-service-langyagent" }' --since 15m`. See `dev/docs/best_practices/local-observability.md` ("Reading the data as an agent"). With the stack down, `pnpm dev`'s own terminal output is the fallback — pipe it to a file yourself if you need to grep it.

## Structure

```
apps/ui/             # Browser application (Vite SPA, :5560)
apps/api/            # Interactive API process — tRPC + REST + SSE (:6560)
apps/worker/         # Background process — queues, schedulers, projections
apps/tasks/          # One-shot migrations and backfills (`@langwatch/tasks`)
apps/server/         # The `npx @langwatch/server` CLI
modules/*/ # One feature each, as {contract,server,web}
services/nlpgo/      # Go NLP engine (:5561, built as langwatch/langwatch_nlp)
services/aigateway/  # Go AI Gateway data plane (:5563)
services/langevals/  # Python evaluators
tools/dev-runtime/   # Contributor-only: api + worker in one local process
charts/gateway/      # Helm sub-chart for the gateway
packages/            # Shared TypeScript workspace packages
sdks/python/         # Python SDK
sdks/typescript/     # TypeScript SDK
sdks/go/             # Go SDK
mcp/typescript/      # MCP server
specs/               # BDD feature specs
```

## Key References

- `dev/docs/CODING_STANDARDS.md` - clean code, SOLID + CUPID principles
- `dev/docs/TESTING_PHILOSOPHY.md` - test hierarchy, BDD workflow
- `dev/docs/best_practices/` - language/framework conventions
- `dev/docs/best_practices/error-handling.md` - handled vs unhandled errors, and how they reach the user
- `dev/docs/best_practices/service-repository-adapter-port.md` - the four layers of a feature package, with the typed-Prisma seam
- `dev/docs/adr/` - Architecture Decision Records

## General

| Common Mistake                                                                                              | Correct Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Building from scratch without checking existing code                                                        | Search the codebase first - follow existing patterns, extend existing systems, reuse existing abstractions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Building settings UI without reading the UX guidelines                                                      | Read `dev/docs/best_practices/` first (`scope-selector-and-badges.md`, `drawers.md`, `row-actions-overflow-menu.md`, `scoped-resources.md`). Scope selection ALWAYS uses `ScopeChipPicker` (multi-scope, `personalScopes` for personal-project variants), never a hand-rolled Select                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Exposing internal technical details in user-facing copy ("in-process", "uses the analysis service")         | Read `dev/docs/best_practices/copywriting.md`. Copy says what the feature does for the customer, never how it is built; descriptions stay short, full lists go in a `(?)` tooltip pinned to the code by a test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Abbreviating words in user-facing copy ("156.8K tok", "oai", "req", "ctx")                                  | Spell them out: "tokens", "OpenAI", "requests", "context". A shortened word saves a few pixels and costs the reader a guess, and the guess is often wrong. Applies to labels, tooltips, chart axes, empty states and error copy. Identifiers, units with a standard symbol (ms, KB, USD) and vendor names written the vendor's own way are not abbreviations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Repeating the frontmatter `title` as the first body heading of a `docs/` page                               | The frontmatter renders as part of the page: `title` becomes the H1 and `description` the visible lede under it, so a body heading or opening sentence with the same text shows twice. Never restate either. Give the first section its own name for what it covers, for example "Getting Started" or "What are Run Parameters"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Implementing without checking feature files                                                                 | Check `specs/` for existing feature files first - they ARE the requirements. If none exists, create one before coding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Using "should" in test descriptions                                                                         | Use action-based descriptions: `it("checks local first")` not `it("should check local first")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Describe blocks without "when" context                                                                      | Inner describe blocks must use "when" conditions: `describe("when user clicks submit", () => ...)` not `describe("submit behavior", ...)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Flat test structure with GWT comments                                                                       | Use nested `describe("given X")` and `describe("when Y")` blocks for BDD structure, not comments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Naming tests as unit when they render components                                                            | Tests that render components and mock boundaries are integration tests (`.integration.test.ts`), not unit tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Writing string-assertion "regression tests" for runtime bugs                                                | If the bug is a runtime crash/error, the regression test must execute the code path and observe the crash — not just assert the generated output string looks different. String checks are supplementary, not primary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Code before tests                                                                                           | Outside-In TDD: spec → test → code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Tests after TODO list                                                                                       | BDD specs come first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Shared types in `types.ts`                                                                                  | Colocate unless truly shared                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Duplicating Zod + TS types                                                                                  | When you need both validation AND types, use Zod only with `infer`. For internal constants (no external input), `as const` is sufficient                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Skipping test run after edits                                                                               | Always run tests after any code change to catch regressions immediately                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Running `npx vitest` / `npm exec vitest` directly                                                           | Always go through a package's own scripts: `pnpm --filter <package> test:unit <path>`, and `test:integration` only in the packages that declare one. The root `test:component` and `test:integration` scripts are stubs that exit 1. The RAM guardrails CLAUDE.md used to promise (`vmForks`, `isolate: false`, a per-worker memory cap) lived in the deleted monolith's config and no per-package config restores them yet; CI caps worker count with `VITEST_MAX_WORKERS`, local runs do not, so scope runs narrowly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Running a component-lane test with `pnpm test:integration` and finding it "missing"                         | The two lanes are complements: `test:integration` only includes files that need a datastore, so a jsdom file naming none is not in it. Use `pnpm test:component`. If you meant it to have a database, name the dependency — that is what moves it back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Adding a datastore to an existing jsdom integration test and expecting CI to notice                         | It does, automatically: the lane is recomputed from the file's source on every run, so mentioning Prisma/ClickHouse/Redis moves it to the datastore lane with no config change. The reverse also holds — removing the last mention moves it out, so check that is what you wanted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Hand-rolling a throwaway `vitest.*.config.ts` (in `/tmp` or a worktree)                                     | Never. A bare config inherits none of the guardrails above, so vitest defaults to the `forks` pool at `availableParallelism - 1` workers (10 on an 11-core laptop) at ~200-500MB each — several GB per run, multiplied by every parallel agent worktree. Use an existing config                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Writing a jsdom config because the repo "has no jsdom environment"                                          | It is per-file on purpose — neither config declares a global `environment`; 515 test files set `// @vitest-environment jsdom` in a docblock. Add the docblock to your test file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Reaching for `--maxWorkers=1` to be gentle on RAM                                                           | It serializes the run so it stays resident far longer, overlapping every other agent's run. Scope the run down instead — pass a narrower path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Leaving a killed vitest run behind                                                                          | Interrupting vitest orphans its forked workers (they reparent to `ppid 1` and keep holding RAM). After an interrupted run, sweep with `pkill -f "vitest/dist/workers"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Writing tests in the incorrect order                                                                        | Outside-In TDD: integration tests first, then unit tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Defining BDD specs on the end of the TODO list                                                              | BDD specs should come before any other tasks to guide them, not the other way around                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `gh pr edit --body`                                                                                         | Use `gh api repos/OWNER/REPO/pulls/N -X PATCH -f body="..."` (avoids Projects classic deprecation warning)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Inconsistent branch naming                                                                                  | Issue branches: `issue123/slug`, features: `feat/slug`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Feature file scenarios with implementation details like `settings.X equals Y`                               | Feature files describe behavior from user perspective, not config values or internals. Write "job fails without retry" not "settings.attempts equals 1"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Forgetting `projectId` in Prisma queries                                                                    | Always include `projectId` in WHERE clauses for project-level models — the multitenancy middleware will reject queries without it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Duplicating legacy code into new locations with minor rewrites                                              | Reuse the existing function via import, or refactor into a shared module. Do not copy-paste legacy tree-walking/utility code into mappers or services                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Writing comments describing behavior that the code doesn't actually implement                               | If you write a comment like "extracts X from Y", the code must actually do that. Delete misleading comments, or implement what they promise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Re-exporting from a module for "backwards compatibility"                                                    | Never re-export — update the existing consumers to import from the new location directly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Using `gh api graphql -f`/`-F` variable parameters for GraphQL queries                                      | Inline the values directly in the query string (replace `OWNER`, `REPO`, `NUMBER` literals). The `-f`/`-F` flags cause escaping issues with multiline queries and special characters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Using gpt-4o or gpt-4.1-mini in tests, scenarios, or fixtures                                               | Always use `gpt-5-mini` — it's the cheapest and most capable model. Default to `openai("gpt-5-mini")` for scenario judges, user simulators, and test fixtures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Only verifying tests parse (CI=1) without running them end-to-end                                           | Always run scenario tests end-to-end locally (`npx vitest run file.test.ts` without CI flag) to verify they actually pass with Claude Code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Dogfooding agent-usage tracking features with `claude -p` or other headless modes                           | Never. Spin up a sub-tmux session (`tmux new-session -d`, `send-keys`, `capture-pane`) and drive the agent interactively, the way a user runs it: headless mode skips or reorders the session lifecycle (hooks, prompts, settings reads) that these features exist to observe. Verify the captured data landed in the product afterward, not just that the process exited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Returning JSX from hooks                                                                                    | Hooks return state and callbacks, never JSX. If a hook needs to "render" something (dialog, tooltip), return props/state and let the consumer render the component explicitly. Use `.ts` for hooks, `.tsx` for components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Mounting a drawer component from inside another drawer (`useState`/`useDisclosure`)                         | Drawers are URL-routed singletons with a navigation stack. A sub-flow navigates: `openDrawer("target", { onSuccess, onClose: goBack })`, and `goBack` returns to the caller. Pass `onClose`, never let the target call `closeDrawer` (it clears the whole stack), and keep the caller's draft in a store that survives its unmount. See `dev/docs/best_practices/drawers.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Using `form.watch()` in child components that receive `form` as a prop                                      | Use `useWatch({ control: form.control, name: "field" })` instead — `form.watch()` doesn't trigger re-renders in child components (especially inside `useFieldArray` items). Only the form owner component should use `form.watch()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Relying solely on `gh pr checks` to assess CI status                                                        | Use `gh run list --branch <branch>` to see all workflow runs — `gh pr checks` deduplicates by check name and can mask failing runs behind passing ones from earlier commits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Toasting a raw `error.message` from a mutation `onError`                                                    | Since #5984 the wire message for a handled error **is the code slug** — `description: error.message` shows the customer `validation_error`. Read the handled payload (`readHandledError`) and render copy from the code-keyed registry. See `dev/docs/best_practices/error-handling.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Letting a knowable failure surface as a generic "unknown error"                                             | If we can name the cause and the caller can act on it, it gets a `HandledError` with a stable `code`. Reserve "unknown" for genuinely unanticipated failures — that path is intentional, not a fallback for laziness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Inventing a `HandledError` to wrap an infra failure (`new HandledError("database_error", pgError.message)`) | Throw the plain `Error`. It degrades to "unknown" at the boundary and gets logged with the trace id. Dressing internals up as handled leaks them and promises the caller an action they don't have                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A `HandledError` subclass with a 5xx status and no explicit `fault`                                         | `fault` defaults to `"customer"`, so an unannotated 5xx logs a real incident as routine noise. Set `platform` or `provider` explicitly on every 5xx subclass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Writing a `HandledError` message that names an env var, a hostname or an internal service                   | `message` must be **customer-safe** — nothing on a handled error is sensitive, and the REST boundary ships it in the response body. Internals go in the log line, not the message. It is still not the app's UI copy: what the customer reads comes from the client presentation registry keyed by `code` (tRPC replaces the wire message with the code, #5984)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Adding a new error code without customer-facing copy                                                        | Two guards, and only one is the type system: the presentation registry is exhaustive over the _enumerated_ codes (`APP_ERROR_CODES` + the generated Go/node ones), so a missing entry for a listed code fails `pnpm typecheck` — but a brand-new app code you haven't listed yet is caught by `apps/ui/src/model/errors/__tests__/codes.unit.test.ts`. Add the code to `packages/handled-error/src/app-codes.ts` (sorted) and write its `presentation.ts` entry in the same change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Stuffing debug context into `meta`                                                                          | `meta` is a client contract, not a scratchpad — only fields a UI or agent actually reads. If nothing renders it, log it instead. Name the consumer before adding a field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Surfacing server validation errors as a toast                                                               | Map `meta.fieldErrors` onto the offending form fields so the user sees the rejection where they're looking, and make it visually clear the submit was rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Hand-rolling `c.json({ error: "..." }, { status })` in a Hono route                                         | Throw a `HandledError` — `createServiceApp`'s `onError` serialises it. A generic string response bypasses the whole contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Asserting on error message prose in tests                                                                   | Assert on `code` — the message is copy and will change. Use `code` equality rather than `instanceof` anywhere the error may have crossed a process, worker, or serialisation boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Hono routes calling repositories directly                                                                   | Routes must go through a service layer — never instantiate or import from repositories. Business logic (validation, guards) belongs in the service, not the route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Using `list` or `get` for repository methods                                                                | Repositories use `findAll`/`findById`. Services use `getAll`/`getById`. Routes call services only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Taking `database: object` in an adapter's `.create(` and casting `as PrismaClient` at the repository seam   | The composition root already holds a typed `PrismaClient`. Pass it through: adapter takes `prisma: PrismaClient`, hands it to the repository (also typed), no cast at any layer. Only `repositories/prisma/**` and `adapters/postgres.*.adapter.ts` may name `PrismaClient` — that is what `prisma-containment` allows, and `typed-prisma-seam` rejects any new file that reintroduces the old untyped shape. Full shape and diagrams in `dev/docs/best_practices/service-repository-adapter-port.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Spawning a subagent without naming its model, effort and context size                                    | Every spawn states all three, plus one clause saying why. Leaving them unset does not mean "the default" - it means whatever the harness happens to pick, which is how a whole fleet of lanes silently lands on one model nobody chose. Decide from the work in front of you: **Opus** for architecture, behaviour-parity review, cross-module integration and hard debugging; **Fable** for restructuring, documentation and templates once the shape is decided; **Sonnet** for ordinary scoped implementation and straightforward tests; **Haiku** for inventory, formatting and narrow validation. Raise the effort for work that is genuinely hard to get right, not for work that is merely long. Name the wide-context variant only when the task actually needs it - a large context costs on every turn, so it is a decision, not a default. The choice should be defensible in one line and made in one breath: pick what is correct rather than deliberating, and state it without hedging. Routing table and spawn mechanics: `.claude/coordinator/COORDINATOR.md` section 3 |
| Setting up a Monitor / sleep that _can_ cross the prompt-cache TTL                                          | A wait that crosses the TTL forces an uncached re-read of the full conversation on wake-up (slower + double-pays for tokens). **The TTL depends on where you are running: main sessions get 1h, subagents get 5min.** In a main session cap each poll cycle at ~15 min; inside a subagent cap it at **4.5 min (270s)** — re-check, then re-arm either way. If the work is obviously hours away (long deploy, overnight run), don't sit on a Monitor at all — drop it and hand control back to the user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Using inline `import("...")` anywhere                                                                       | Never use inline `import()` — always use top-level `import` / `import type` statements. **One exception: the CLI startup path** (`sdks/typescript/src/cli/**` and `sdks/typescript/tsup.config.ts`), where lazy `import()` is load-bearing — it is what keeps commander, chalk, zod, js-yaml, the command modules and the command catalog off the boot graph and the cold start at ~30ms. There, defer at the seam (command actions, format branches) and keep the boot graph pinned by `src/cli/__tests__/index-boot.unit.test.ts`. Everywhere else the ban stands                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Running `pnpm typecheck` and assuming the whole repository is checked                                       | It checks three applications — `apps/api`, `apps/worker`, `apps/ui` — and their tests are in it. It does NOT reach the other ~180 workspace packages: a feature package you broke goes unseen until `pnpm typecheck:all`, which is what CI runs. Iterate with `pnpm typecheck:one <package>` on what you touched, and run `typecheck:all` once before you push                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Assuming `go build`, `go test` and `gofmt` are enough before pushing Go                                     | Run `golangci-lint run ./services/aigateway/... ./services/nlpgo/... ./pkg/... ./cmd/... ./tools/migrationorder/...`, which is exactly what `go-ci / lint` runs. It catches a class the other three never will, most often `misspell` (it enforces US spelling, so `behaviour`, `unrecognised`, `labelled` and `funnelled` all fail even though the repo's prose uses British forms), `nolintlint` (a `//nolint` for a code already in the global `gosec.excludes` is flagged as unused) and `testifylint`. The pinned version is in `.golangci.yml`; `golangci-lint run --fix` handles misspell and nolintlint automatically                                                                                                                                                                                                                                                                                                                                                                             |
| Rewriting `assert.Equal(t, 1.0, ...)` to `assert.InEpsilon` because testifylint's `float-compare` says so   | Check whether the expectation can be zero first. `InEpsilon` divides by the expected value, so it returns false even for `InEpsilon(0.0, 0.0)`, and a counter assertion meaning "this did not move" becomes one that always fails. For Prometheus counters, which are exact integers in a float64, `assert.Equal` is correct and `float-compare` is a false positive; `.golangci.yml` scopes an exclusion to `adapters/gatewaymetrics/*_test.go` rather than contorting the assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Installing from inside `apps/api/`, `sdks/typescript/`, `mcp/typescript/` or `skills/`                      | One `pnpm install` at the **repo root** covers every JavaScript project — the repo is a single pnpm workspace with one lockfile (ADR-076). Installing from a subdirectory resolves the whole workspace anyway, because pnpm walks up to the root. To install just one project, filter from the root: `pnpm install --filter "@langwatch/platform-api..."` (the trailing `...` includes its workspace dependencies)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Adding a security `override` to a single project's `package.json`                                           | pnpm honours `overrides` only at the workspace root, so put it in the root `pnpm-workspace.yaml`. A `pnpm` block in a member package.json is silently ignored — it looks active and does nothing. This is why the pins used to drift when the repo had six install roots                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Referring to "the app" as one package                                                                       | There is no one app package. The product is `@langwatch/ui` (`apps/ui`), `@langwatch/platform-api` (`apps/api`) and `@langwatch/worker` (`apps/worker`). `langwatch` is the published TypeScript SDK, in `sdks/typescript/`, and `@langwatch/server` is the `npx` CLI in `apps/server/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `cd` into an application before every command                                                               | The repo root proxies the common ones, so `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm prisma:migrate` and friends work from wherever you are. `cd` only when you want a script the root does not proxy — `pnpm --filter @langwatch/platform-api <script>` reaches any of them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Importing a component into server code to reuse a constant it happens to export                             | No _value_-import chain from server code may reach a browser-only package (React, Chakra, Ark, Emotion, react-router, lucide-react, browser OTel). One such import pulled 2,020 modules / 212 MB RSS into every backend process. **Enforced:** `packages/architecture-lint/tests/frontend-boundary.unit.test.ts` walks the real value-import graph transitively from the API and worker entrypoints, every `*.composition.ts` they wire, and every `modules/*/server` + `packages/*/src/server` source — and it refuses a module out of `apps/ui` or a `*-web` package too, not only the toolkits one imports. `@langwatch/mail` is the one exception, since react-email renders its templates server-side. **Convention on top:** don't value-import a `**/ui/**` file from a `server` package at all, even a framework-free one — it invites exactly that chain later. Move the shared value into a framework-free module both sides import (`import type` is always fine — types are erased) |

## TypeScript

| Common Mistake                                                         | Correct Behavior                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Using npm tsc to compile                                               | Use `pnpm typecheck` instead — it names the right project and the right compiler. Locally, a **whole-tree** `tsc` reached any other way still queues, because the bin shim sees to it; a file-targeted run, a `--watch`/`--lsp` session and CI do not (see "Going around the scripts" above). So the reason to go through the script is correctness, not the queue |
| Importing the TypeScript compiler API from `typescript`                | TypeScript 7's root export is a version constant; the compiler lives behind `typescript/unstable/*`, and nothing parses a string in-process any more. Static scans go through `src/test-utils/tsAst.ts`, which owns the one API session. See ADR-099                                                                                                               |
| Creating shared types for single-use interfaces                        | Colocate interfaces with their usage; only extract to `types.ts` when shared across multiple files                                                                                                                                                                                                                                                                 |
| Using -- on pnpm tasks, pnpm adds the -- automatically                 | Using e.g. `pnpm test:unit path/to/file` directly                                                                                                                                                                                                                                                                                                                  |
| Using positional parameters for functions with multiple args           | Use named parameters via object destructuring: `fn({ a, b })` not `fn(a, b)`                                                                                                                                                                                                                                                                                       |
| A workspace package tsconfig without `incremental` + `tsBuildInfoFile` | Every package tsconfig sets `"incremental": true` and its own `"tsBuildInfoFile": "node_modules/.cache/tsbuildinfo/<pkg>.tsbuildinfo"`. Without it each typecheck re-checks cold; without a per-package path the packages clobber each other's cache                                                                                                               |

## Database

**Read `dev/docs/best_practices/clickhouse-queries.md` before writing or modifying any ClickHouse query.**

| Common Mistake                                                                                                  | Correct Behavior                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modifying deployed migrations                                                                                   | Never edit migrations that have been deployed - they are immutable history. Create a new migration instead. (New migrations not yet in production can be fixed before merging)                                                                                                                      |
| Hardcoding schema names in migrations                                                                           | Use unqualified table names (e.g., `"Monitor"` not `"langwatch_db"."Monitor"`) - Prisma uses the schema from connection string                                                                                                                                                                      |
| Writing ClickHouse queries without TenantId filtering                                                           | Every ClickHouse query MUST include `WHERE TenantId = {tenantId:String}` — no other ID (ScenarioRunId, BatchRunId, etc.) is unique across tenants. Always make TenantId the first predicate                                                                                                         |
| Using `LIMIT 1 BY` with heavy columns in subqueries                                                             | Use the IN-tuple dedup pattern (`GROUP BY key + max(UpdatedAt)` in subquery). `LIMIT 1 BY` forces ClickHouse to materialize ALL selected columns for entire granules (~8K rows), causing OOM with heavy payloads (Messages, SpanAttributes, ComputedInput/Output)                                   |
| Using `max(column)` for pagination sort keys on deduped tables                                                  | Use `argMax(column, UpdatedAt)` to derive sort keys from the latest version only. `max()` may pick values from stale versions, causing cursor pagination to skip/duplicate rows                                                                                                                     |
| Not filtering on the partition key column in WHERE                                                              | Always include `StartedAt`/`OccurredAt`/`StartTime` range in WHERE when a date range is available — this enables partition pruning. Without it, ClickHouse scans ALL partitions including cold storage on S3, turning 100ms queries into 1-2s                                                       |
| Using a `_count` relation include on a Prisma list query                                                        | Prisma builds `_count` as an uncorrelated join that aggregates the whole related table, and the planner can re-run that aggregate once per listed row (2.3s per call on a 192k-row table in production, see the prompt list). Run a second `groupBy` count restricted to the listed row ids instead |
| Writing down migrations in ClickHouse migration files                                                           | Always comment out down migrations to prevent accidental data loss. Add a note: "To roll back, uncomment and run manually"                                                                                                                                                                          |
| Putting multiple ALTER TABLE statements in one StatementBegin block                                             | ClickHouse does not support multi-statement queries. Each ALTER TABLE needs its own `-- +goose StatementBegin` / `-- +goose StatementEnd` block                                                                                                                                                     |
| Getting "Cannot find module" errors for generated files (.prisma/client, types.generated, evaluators.generated) | Run `pnpm start:prepare:files` from the repo root to regenerate all generated types (Prisma, Zod, SDK versions, langevals). This is needed after fresh clones, worktree creation, or any schema changes                                                                                             |

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
rtk uv run <cmd>        # Compact uv project command output
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->