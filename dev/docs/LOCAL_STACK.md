# Running the local stack

Reference for bringing up and debugging a LangWatch stack on a development
machine. The first-run walkthrough is `GETTING_STARTED.md`; failures that look
like a slow boot are covered by the `haven-setup` skill.

## Processes

| Process | Package | What it is |
|---|---|---|
| `apps/ui` | `@langwatch/ui` | The browser application (Vite SPA, :5560) |
| `apps/api` | `@langwatch/platform-api` | tRPC + REST + SSE, serves the browser bundle (:6560) |
| `apps/worker` | `@langwatch/worker` | Queues, schedulers, projections, subscribers |
| `apps/tasks` | `@langwatch/tasks` | One-shot migrations and backfills, run before serve |
| `apps/server` | `@langwatch/server` | The `npx @langwatch/server` CLI |
| `services/aigateway` | Go | Virtual-key data plane (:5563) |
| `services/nlpgo` | Go | Optimization-studio executions and evaluators (:5561) |
| `services/langyagent` | Go | Langy conversation manager (PORT+4) |
| `services/langevals` | Python | Evaluators |

ui, api and worker always run together. A stack missing one serves pages and
quietly processes no jobs, which looks healthy until a job was expected to run.

## `.env` and secrets

`.env` lives at the workspace root; every application resolves it from there.
haven injects its own resolved values (hostnames, ports, database URLs) into
every process it starts, and `eval "$(haven env)"` puts the same set in your
shell.

Credential-carrying variables are classified once in `packages/secrets`
(ADR-132). Each app resolves them through an ordered chain (env/.env, then
1Password when `LANGWATCH_SECRETS_VAULT` is set, then a refusal by name) before
its Zod parse. Never read `.env` to find a value and never print one:
`haven env` masks every classified key (`--reveal` for the shell form).

## haven (thuishaven)

`make haven up` routes this worktree's services through the portless proxy at
`app|gateway|nlp.<slug>.langwatch.localhost`, where `<slug>` is the sanitised
worktree directory name. UI and API share one origin: `app.<slug>…` for the UI,
`app.<slug>…/api` for the API. `.localhost` resolves to loopback natively, so
there is no `/etc/hosts`, no sudo and no port collision between worktrees.

```bash
make haven up          # start this worktree's stack (bootstraps portless on first run)
make haven install     # go install so plain `haven …` works, then check prerequisites
make haven status      # every stack, service health, shared servers
haven up +langy        # add a service to this stack, sticky (likewise -gateway, -nlp, -langy)
haven logs nlp -t      # tail one service's logs from any terminal
```

haven supervises two Node lanes, `ui` and `api`, beside one `go` lane holding the
data-plane services. None is individually selectable (`haven up ±api` and the
old `±backend`/`±workers` are refused by name). The api lane hosts the worker
beside the API, so `haven logs api` and `haven logs worker` each show one of
them, and `haven logs go` shows the gateway and NLP engine. Restarting any of
them means restarting the lane.

`https://langwatch.localhost` is the cross-worktree dashboard;
`observability.langwatch.localhost` proxies local Grafana;
`telemetry.langwatch.localhost` fans OTLP out to every running stack. When
driving haven as an agent, add `--agent` (or `HAVEN_AGENT=1`);
`haven status --json` is machine-readable. Full reference:
`tools/thuishaven/README.md`.

`haven up` also installs `haven gate` as a PreToolUse hook in the worktree's
`.claude/settings.local.json`, so tests, typechecks and builds an agent starts
take a machine-wide slot instead of all landing at once.

### Without a container runtime

With ClickHouse, Postgres and Redis running natively (brew or a LaunchAgent),
point `.env` at them and set:

```bash
LANGWATCH_HAVEN_CH=0   # use .env CLICKHOUSE_URL instead of a managed container
LANGWATCH_HAVEN_OBS=0  # skip the LGTM telemetry stack
```

Postgres and Redis stay haven-managed either way (through brew, not a
container). The langy worker resolves its own host tier without a runtime;
`LANGY_UNSAFE_HOST_ACCESS=0` refuses that and `=1` forces it. Integration
suites run against native services when `LANGWATCH_TEST_CLICKHOUSE_URL`,
`LANGWATCH_TEST_REDIS_URL` and `LANGWATCH_TEST_DATABASE_URL` are set (dedicated
test databases; dev data untouched). `CI=1` forces testcontainers; never set it
locally. Only `make observability` and the sandboxed langy tiers still want a
container, and both are opt-in.

## Plain `pnpm dev`

Without haven, every port derives from `PORT` (default 5560): ui on `PORT`, api
on `PORT+1000`, worker metrics on `PORT-2561`, gateway on `PORT+3`, nlp on
:5561, langy on `PORT+4`. If the ports are held, `dev/scripts/check-ports.sh`
refuses and prints two ready-to-paste options (a free slot via
`PORT=5570 pnpm dev`, or a port-scoped kill). Paste one; don't hunt processes by
hand. `dev/scripts/kill-dev-tree.sh` already does it correctly.

Locally there are two Node processes: the `api` lane runs the api and the worker
in one process. It is a launcher, not a process role: each still resolves its
own secrets, config and graph; boot is worker then api, and shutdown drains the
worker first. Production runs three Node deployments.

| Script | What runs |
|---|---|
| `pnpm dev` | ui + backend + go (+ langy when selected) |
| `pnpm dev:ui` / `dev:backend` / `dev:go` | one lane alone |
| `pnpm dev:api` + `pnpm dev:worker` | the production process shape; use when a blocked worker job must not read as API latency |

Both Node lanes restart on change, debounced by
`LANGWATCH_DEV_WATCH_DEBOUNCE_MS` (default 750 ms); the Go lane restarts through
`air` on successful builds only. The Go services auto-start when the toolchain is
on PATH and reuse an existing listener from another worktree. Opt out per
service with `LANGWATCH_SKIP_AIGATEWAY=1`, `LANGWATCH_SKIP_NLP=1` or
`LANGWATCH_SKIP_LANGY=1` (plain `pnpm dev` only; under haven use
`haven up -gateway` etc., which sticks). Standalone: `make service svc=aigateway`
or `make service-watch svc=nlpgo`. The gateway needs the "AI GATEWAY" block
from `.env.example`; langyagent writes its own `.env` block on first run and
needs the worker binary (`pnpm --filter @langwatch/langyworker build:binary`).

## Compose presets

`make quickstart` is the interactive preset picker for compose-based stacks
(`all-local`, `all-local-nlp`, `dev-storage`, `dev-infra`, `frontend-only`,
`migration`, `full-local`). `make quickstart-help` is the reference and
`make down` stops everything. Stateful volumes are shared across worktrees, so
only one worktree can have Postgres or ClickHouse up at a time; quickstart
detects collisions.

## Debugging

Prefer the observability stack over log files when it is up (haven starts it
by default). Query logs, traces and metrics by attribute with `gcx` (wired by
`make observability-connect`), filtered to your worktree:

```bash
gcx logs query '{service_name="langwatch-app"} | langwatch_worktree="<slug>"' --since 15m
```

See `dev/docs/best_practices/local-observability.md`. With the stack down,
`pnpm dev`'s terminal output is the fallback.

Locally built binaries land only in `.bin/<name>/<name>` (git- and
Docker-ignored). Release pipelines pass their own `--outfile`.
