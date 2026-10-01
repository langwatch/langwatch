# Running the local stack

Reference for bringing up and debugging a LangWatch stack on a development
machine. The first-run walkthrough is `GETTING_STARTED.md`; failures that look
like a slow boot are covered by the `haven-setup` skill.

## Processes

| Process               | Package                   | What it is                                            |
| --------------------- | ------------------------- | ----------------------------------------------------- |
| `apps/ui`             | `@langwatch/ui`           | The browser application (Vite SPA, :5560)             |
| `apps/api`            | `@langwatch/platform-api` | tRPC + REST + SSE, serves the browser bundle (:6560)  |
| `apps/worker`         | `@langwatch/worker`       | Queues, schedulers, projections, subscribers          |
| `apps/tasks`          | `@langwatch/tasks`        | One-shot migrations and backfills, run before serve   |
| `apps/server`         | `@langwatch/server`       | The `npx @langwatch/server` CLI                       |
| `services/aigateway`  | Go                        | Virtual-key data plane (:5563)                        |
| `services/nlpgo`      | Go                        | Optimization-studio executions and evaluators (:5561) |
| `services/langyagent` | Go                        | Langy conversation manager (PORT+4)                   |
| `services/langevals`  | Python                    | Evaluators                                            |

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

Monitors and evaluations need langevals, which is off by default: its imports
hold a few GiB. `haven up +langevals` (sticky) runs `services/langevals` with
`uv` (install it with `brew install uv`) on a port haven allocates, and points
`LANGEVALS_ENDPOINT` at it for every lane. Without it, `.env`'s
`LANGEVALS_ENDPOINT` stands, and nothing listens there unless you run
`make -C services/langevals start` yourself. The first start syncs the Python
dependencies, which takes a few minutes. diffsuite's `-langevals` does the same
for a branch stack it starts with `-up`.

The six simulators (`mail`, `idp`, `storage`, `llm`, `voice`, `analytics`) each serve a
console at `<name>.<slug>.langwatch.localhost`, appear as rows in the hub and the stack
home, and log through `haven logs <name>`. `mail`, `idp` and `storage` run by default
(`-mail`, `-idp`, `-storage` turn them off); `llm`, `voice` and `analytics` are opt-in
(`+llm`, `+voice`, `+analytics`).

In a dev checkout every selected simulator runs in one `sims` lane, a second
`service combined` process beside the `go` lane (gateway, nlp), so a simulator under
load cannot starve the gateway. `haven restart sims` bounces them together. Point a
load driver at `127.0.0.1:<port>` from `haven status`. Mail, storage and analytics
start with sample content (haven sets `MAILSIM_SEED`, `STORAGESIM_SEED`,
`ANALYTICSSIM_SEED` to 1). Each keeps a bounded recent history: `MAILSIM_MAX_MESSAGES`
(10000), `ANALYTICSSIM_MAX_RECORDS` (5000), `LLMSIM_MAX_CALLS` (500); the `sims` skill
has the rest. Without haven, `make service svc=combined args="mailsim storagesim llmsim analyticssim"`
runs them in one process.

Uploads need S3, which `storagesim` stands in for. It runs by default as the
`storage` lane (`haven up -storage` turns it off), stores objects under haven's
home in `storage/<slug>/`, and answers only the calls the product makes:
path-style PUT, GET, HEAD and DELETE of an object, plus HEAD bucket. It checks
SigV4 (header and presigned) against haven's dev key and refuses as S3 does
(services/storagesim/README.md). haven sets `STORED_OBJECTS_BACKEND=s3`,
`S3_BUCKET_NAME=langwatch`, `S3_ENDPOINT=http://127.0.0.1:<port>` and dummy
`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` for every lane. It sets none of them
when `.env` or your shell already names `STORED_OBJECTS_BACKEND`,
`S3_BUCKET_NAME`, `S3_ENDPOINT` or `LANGWATCH_LOCAL_STORAGE_PATH`, because the
root `.env` beats haven's overlay and a half-applied S3 config would mix the
two. Only the stack's own app origin may call it from a browser (CORS).

Model calls can cost nothing: `haven up +llm` (sticky, off by default) runs
`llmsim`, which answers OpenAI chat completions, embeddings and models and
Anthropic messages with seeded Markov text (same prompt, same answer), JSON
that fits a requested schema, and tool calls built from the tool's schema.
haven sets `OPENAI_BASE_URL=http://127.0.0.1:<port>/v1` and
`ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`, plus `OPENAI_API_KEY` and
`ANTHROPIC_API_KEY=llmsim` where `.env` sets no key. A provider whose base URL
`.env` names is left alone. The seeded model providers then carry those
values, so the playground, evaluators, scenario runs and Langy reach llmsim
through the gateway, the nlp service and LiteLLM alike. A model name
containing `langy-echo` switches to Langy's echo mode, and one containing
`error-429` or `error-500` forces that error; `services/llmsim/README.md` has
the rest. Gemini, Vertex, Azure, xAI and Groq still reach the real provider
when `.env` holds their key.

ElevenLabs voice calls can run against `voicesim`: `haven up +voice` (sticky,
off by default because it replaces a real provider). It answers the ElevenLabs
signed-URL mint and conversation socket with a scripted agent, and OpenAI's
`pcm` speech and transcription with tones and a fixed transcript, checking no
key. Unless `.env` or your shell names `ELEVENLABS_BASE_URL`, haven sets it to
voicesim, adds a dummy `ELEVENLABS_API_KEY` when none is set, and sets the
product's dev-only switch `VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS=1`; the seed
then stores the ElevenLabs provider row at voicesim. The switch admits only
`127.0.0.1` or `localhost` with an explicit port; production never sets it.
haven never sets `OPENAI_BASE_URL`: the product has no audio-only OpenAI seam,
so the caller's OpenAI speech still reaches OpenAI. Its console at
`voice.<slug>.langwatch.localhost` shows each call's turns (`VOICESIM_SEED=1`
adds a sample call; `VOICESIM_MAX_CALLS` and `VOICESIM_MAX_EVENTS_PER_CALL` cap it).

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

| Script                                   | What runs                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm dev`                               | ui + backend + go (+ langy when selected)                                                |
| `pnpm dev:ui` / `dev:backend` / `dev:go` | one lane alone                                                                           |
| `pnpm dev:one`                           | ui + api + worker in one Node process (see "One process" below)                          |
| `pnpm dev:api` + `pnpm dev:worker`       | the production process shape; use when a blocked worker job must not read as API latency |

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

### One process (trial, ADR-168 B1)

`LANGWATCH_DEV_ONE_PROCESS=1` (plain `pnpm dev`, or `haven up -f` with it
exported or in `.env`) replaces the ui and backend lanes with one `app` lane:
`tools/dev-runtime` hosts the UI's Vite server (`apps/ui/vite.config.ts`,
unchanged, still proxying `/api`) and loads the api and worker through a Vite
module runner. `pnpm dev:one` runs that process alone. Ports are unchanged.

A backend edit that touches a loaded file re-links only what it reaches, then
drains the old generation (worker, then api) and boots the new one; the browser
keeps its HMR socket. A change that does not link leaves the old generation
serving; a failed boot waits for the next change. Each generation logs one
`backend ready` line with its number, changed files, `drainMs`, `readyMs` and
`rssMiB`. Under haven, `haven logs ui|api|worker` read the `app` capture;
`haven restart ui` or `api` restarts the whole process.

## Build cache

Every worktree shares one Nx cache, `~/.nx/<id>/`, whether it runs under haven
or plain `pnpm`. Preparing a fresh worktree (`pnpm start:prepare:files`, then
`pnpm ensure:built`) restores the Prisma client and the SDK, MCP, `ksuid` and
`mail` builds from it when another worktree already made them from the same
inputs. Don't set `NX_CACHE_DIRECTORY`: it makes the cache per worktree again.
Why and how the cache stays trustworthy: ADR-150.

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
