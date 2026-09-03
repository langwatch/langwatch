# ADR-004: Docker Compose Development Environment

**Date:** 2026-01-23

**Status:** Accepted

## Context

Local development required running multiple services (postgres, redis, clickhouse, NLP, workers, app) manually in separate terminals. Different developers need different service combinations:

- Frontend work: app + postgres + redis + clickhouse
- Scenario development: + workers + bullboard + ai-server (scenario processing is part of workers)
- Full stack: everything

Additionally, macOS developers face platform mismatch issues: native Node modules (esbuild, Prisma) compiled for macOS don't work in Linux containers.

## Decision

We use Docker Compose with **profiles** for selective service startup, and an **init container** for cross-platform dependency installation.

### Profiles

| Profile   | Services                                                  | Use Case             |
| --------- | --------------------------------------------------------- | -------------------- |
| (none)    | postgres, redis, clickhouse, app                          | Minimal frontend dev |
| nlp       | + langwatch_nlp, langevals                                | Evaluations          |
| scenarios | + workers (includes scenarios), bullboard, ai-server, nlp | Scenario development |
| full      | Everything                                                | Full integration     |

### Init Container Pattern

```yaml
init:
  image: node:24
  command: sh -c "pnpm install && pnpm prisma generate"
  volumes:
    - ./langwatch:/app
    - app_modules:/app/node_modules # Named volume

app:
  volumes:
    - ./langwatch:/app
    - app_modules:/app/node_modules # Same volume
  depends_on:
    init:
      condition: service_completed_successfully
```

The init container installs Linux-native dependencies into a named volume. All other containers share this volume, avoiding platform mismatch.

### Networking

Internal services (postgres, redis, clickhouse, nlp, langevals) have no host port exposure. They communicate via Docker network hostnames (`postgres:5432`, `redis:6379`, `clickhouse:8123`). Only app, bullboard, and ai-server expose ports for browser access.

### Environment Variables

`CLICKHOUSE_URL` is set in the `x-common-env` anchor, pointing to the local ClickHouse container. `ELASTICSEARCH_NODE_URL` comes from `.env` for any remaining ES-compatible integrations.

### Resource Limits

- **App:** 4GB memory, 2 CPUs (turbopack is hungry)
- **Infra services:** Smaller limits (256MB-512MB) to prevent runaway

No limit means a misbehaving container can starve the whole system. Too tight means OOM kills (exit code 137).

## Rationale

**Why profiles over multiple compose files?**
Profiles keep everything in one file, easier to maintain. `--profile scenarios` is clearer than `-f infra/compose.yml -f infra/compose.scenarios.yml`.

**Why init container over host install?**
macOS binaries don't work in Linux containers. We tried `.npmrc` supportedArchitectures but it was unreliable. Init container guarantees correct platform binaries.

**Why node:24 over node:24-slim?**
Slim lacks build tools (python, gcc) for native modules and OpenSSL for Prisma. The ~200MB size difference is negligible for dev.

**Why custom server over next dev?**
The app uses `tsx src/server.ts` which wraps Next.js with metrics, proper upgrade handling, and other customizations. Plain `next dev` doesn't include these.

## Consequences

**Commands:**

```bash
make dev              # Minimal
make dev-scenarios    # Scenario work
make dev-full         # Everything
make quickstart       # Interactive chooser
make down             # Stop all
```

**Key files:**

- `dev/compose.dev.yml` - Docker Compose configuration
- `dev/scripts/dev.sh` - Interactive profile chooser
- `Makefile` - Convenience targets

**Trade-offs accepted:**

- First startup slower (init container installs deps), but mitigated by shared pnpm store volume
- Requires Docker Desktop with sufficient memory allocation
- Host node_modules still needed for IDE tooling (separate from container's)

**Performance optimization:**
The `pnpm_store` named volume persists downloaded packages across container restarts and is shared across all worktrees (`name: langwatch-pnpm-store`). After first install, subsequent `pnpm install` runs are significantly faster.

## Amendment: Worktree Isolation (2026-03)

### Context

The original design used `VOLUME_PREFIX` for volume naming but `dev/scripts/dev.sh` did not set it when running from worktrees, causing container and volume collisions between parallel worktrees.

### Changes

1. **Auto-detect worktree name** — `dev.sh` detects the git worktree directory name and sets `COMPOSE_PROJECT_NAME` and `VOLUME_PREFIX` for container and volume isolation.
2. **Idempotent init** — The init container hashes `pnpm-lock.yaml` and skips `pnpm install` when unchanged, reducing restart time.
3. **DRY environment variables** — Shared env vars extracted to `x-common-env` YAML anchor.
4. **Port scan fix** — BULLBOARD_PORT scan starts at 6380 (matching container port) instead of 3000.

### Decision: Named Volumes over Bind Mounts

We considered switching node_modules to bind mounts for automatic per-worktree isolation. This was rejected because:

- macOS VirtioFS performance degrades with 50K+ small files in node_modules
- pnpm hard-links from store to node_modules break across filesystem boundaries (named volume is ext4, bind mount is macOS APFS)
- Collapses the host/container node_modules separation (Linux ELF binaries would appear on host, breaking IDE tooling)

Instead, we use per-worktree named volumes via `VOLUME_PREFIX`, which gives the same isolation without these downsides.

## Amendment: Stateful volumes + intent-based modes (2026-05, #3860)

### Context

The 2026-03 worktree-isolation amendment treated **every** volume as per-worktree, and the compose profile names (`dev`, `nlp`, `scenarios`, `full`) named _which services exist_, not _what the developer is doing_. Two side effects:

1. Sign-up state didn't persist across worktrees. Sign up `browser-test@langwatch.ai` in worktree A; switch to worktree B; the account is gone.
2. Profiles conflated "what services exist" with "what URLs the app should use". The `x-common-env` anchor hard-set `DATABASE_URL` / `REDIS_URL` / etc. to local Docker network names regardless of profile, so a contributor's `.env` URLs never won — even when their intent was "I'm doing UI work, just leave my .env alone."

### Decision

**The contributor's `.env` is the source of truth.** A new `.env.dev-up` overlay is loaded as `env_file` AFTER `.env` and contains only the URLs whose services are starting locally for the chosen mode. `x-common-env` no longer sets infrastructure URLs.

**`make quickstart` is the single entry point** with five intent-based modes:

| Mode             | Compose services                                            | URLs overridden in `.env.dev-up`                      |
| ---------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `frontend-only`  | (none)                                                      | (none — pure `.env`)                                  |
| `backend-shared` | postgres + redis + clickhouse + app + init                  | `DATABASE_URL`, `REDIS_URL`, `CLICKHOUSE_URL`         |
| `migration`      | postgres + clickhouse on host ports (5432, 8123)            | `DATABASE_URL` and `CLICKHOUSE_URL` (localhost forms) |
| `nlp`            | + langwatch_nlp + langevals                                 | + `LANGWATCH_NLP_SERVICE`, `LANGEVALS_ENDPOINT`       |
| `full-local`     | `--profile full` (workers, scenarios, bullboard, ai-server) | all five infrastructure URLs                          |

Migration mode uses `dev/compose.dev.migration.yml` to expose host ports so the contributor can run `pnpm prisma migrate dev` and `pnpm clickhouse:migrate` from their host shell.

`make quickstart` accepts a positional mode arg (`make quickstart frontend-only`) for non-interactive runs. `make quickstart-help` (or `./dev/scripts/dev.sh help`) prints the mode reference.

**Stateful services share volumes across worktrees.** `db-data`, `clickhouse-data`, and `redis-data` use stable names (`langwatch-db-data`, `langwatch-clickhouse-data`, `langwatch-redis-data`) — they no longer interpolate `VOLUME_PREFIX`. Sign up once, persist forever.

Trade-off: only one worktree can have the same stateful container `up` at a time (postgres locks `/var/lib/postgresql/data`). `dev/scripts/dev.sh` detects this (`check_stateful_collision`) and fails fast with a clear message pointing at the other compose project.

**Redis is a singleton with a fixed host port.** `redis:alpine` exposes `:6379` on the host and uses the shared `langwatch-redis-data` volume. Parallel worktrees reuse the same redis instance.

**Per-worktree volumes still apply to:** `app_modules`, `bullboard_modules`, `goose_bin`. These hold Linux-platform dependencies that vary by branch lockfile and must stay isolated.

**Deprecated targets** (`make dev`, `dev-nlp`, `dev-scenarios`, `dev-test`, `dev-full`, and `dev-up` / `dev-down` / `dev-logs`) print a deprecation warning and forward to the corresponding `quickstart` mode for one release before being removed.

**Fail-fast SSRF guard.** `dev/scripts/dev.sh` errors if `.env` has `IS_SAAS=true` with `BLOCK_LOCAL_HTTP_CALLS=false`. (Compose's runtime always sets `BLOCK_LOCAL_HTTP_CALLS=true` via `x-common-env`, but workers running outside compose / lambdas would inherit the broken combo.)

### Migration

Existing worktrees have stale `lw-<hash>-db-data` / `lw-<hash>-clickhouse-data` / `lw-<hash>-redis-data` volumes from the previous scheme. The first `make quickstart` after upgrading creates the new shared volumes (`langwatch-*-data`) — old volumes are not deleted automatically. To recover space:

```
docker volume ls | grep -E '^local +lw-[0-9a-f]{8}-(db|redis|clickhouse)-data'
docker volume rm <volume-name>   # one per worktree, after confirming you don't need the data
```

If you previously relied on `x-common-env`'s implicit `DATABASE_URL` / `REDIS_URL` / `CLICKHOUSE_URL` overrides, those moved to `.env.dev-up` written by `quickstart`. Running `make dev` (deprecated alias for `quickstart backend-shared`) keeps the same effective behavior.

## Amendment: In-process workers for local dev (2026-07)

### Context

Locally, the app and the background workers run as two Node processes,
multiplexed by `concurrently` inside `scripts/start.sh` (the app plus a separate
`pnpm run start:workers` lane, alongside Vite and the Go services). The second
worker process has to be handed the exact matching env and Redis DB index, and
if it silently fails to boot you get an app that looks healthy but never drains
queues. Some contributors would rather run a single process locally.

Production is different and stays that way: it runs web and worker as separate
Deployments (`charts/langwatch/templates/{app,workers}`) so they scale
independently. Collapsing them is a _dev-only_ convenience, never a prod change.

### Decision

Make **single-process dev the default**. `pnpm dev` sets
`WORKERS_IN_PROCESS=1` and hosts the worker stack inside the app process; the
two-process topology is still available as `pnpm dev:concurrent`, and
`pnpm dev:app` / `pnpm dev:worker` run one side on its own. Amended after the
default was inverted: a laptop running several worktrees cannot afford a second
Node process per stack, and haven had already defaulted this way, so plain
`pnpm dev` disagreeing with it was the surprise rather than the safeguard.

A new process role `"all"` runs the web server AND the worker-side wiring in one
process. The three prior `processRole === "worker"` gates now go through
`roleRunsWorkers(role)` (`src/server/app-layer/config.ts`), which is true for
both `"worker"` and `"all"`:

- the outbox runtime + consumer/drainer and the heartbeat scheduler
  (`src/server/app-layer/presets.ts`),
- the GroupQueue consumer (`src/server/event-sourcing/eventSourcing.ts`),
- the heartbeat scheduler's `start()` no-op guard
  (`.../outbox/heartbeat/heartbeat.scheduler.ts`).

The imperative worker boot (topic clustering, scenario pool, anomaly / spend-spike
/ usage-stats workers, ingestion pullers, storage stats) is extracted from the
`src/workers.ts` entrypoint into a reusable `startWorkers()`
(`src/server/workers/startWorkers.ts`). The standalone worker calls it with its
own metrics HTTP server; `src/start.ts` calls it with `shouldStartMetricsServer: false`
(the web server already serves the shared prom registry at `/metrics`) after the
server is listening, and drains it before closing the shared App on shutdown.

`scripts/start.sh` skips the standalone `workers` concurrently lane when
`WORKERS_IN_PROCESS` is set in development; `scripts/check-ports.sh` stops
reserving the worker-metrics port in that mode.

### Consequences

- One fewer local process, guaranteed to boot with the app on the same Redis DB.
- **Prod is unaffected**: `WORKERS_IN_PROCESS` is gated on `NODE_ENV=development`
  in both `start.sh` and `start.ts`, and prod never sets it.
- Vite and the Go services (aigateway, nlpgo) remain separate processes — this
  only folds in the _worker_ Node process, not those.
- In-process workers are instrumented. `server.mts` loads `instrumentation.node`
  before the app graph evaluates — precisely because the standalone workers lane,
  which does the same import, no longer runs under the single-process default.
  Worker spans are real, not no-ops. (This was a known limitation when the mode
  was opt-in; making it the default is what closed it.)

## Amendment: Physical application workspaces (2026-08)

[ADR-111](./111-physical-application-workspaces.md) preserves single-process
development but changes its physical owner. The contributor-only
`tools/dev-runtime` composition imports the API and worker runtime construction
entry points, owns their shared infrastructure scope and closes it once. The API
application no longer imports or starts the worker application itself. The
separate `dev:app`, `dev:worker` and `dev:concurrent` modes remain available.

When `platform/app` is retired, the contributor source of truth moves from
`.env` to repository-root `.env`; quickstart and Haven write the
generated overlay to repository-root `.env.dev-up`. Root tooling loads the
source, while API and worker validate their own subsets independently. Existing
path assertions remain truthful until that migration stage lands and must move
atomically with the scripts that consume them.

## Amendment: three processes, no in-process worker (2026-09-03)

The "In-process workers for local dev (2026-07)" amendment above is **retired**,
and so is the physical owner the 2026-08 amendment gave it. `platform/app` is
gone; the product is three Node applications — `apps/ui` (Vite), `apps/api` and
`apps/worker` — and each is its own process in development exactly as it is in
production.

`WORKERS_IN_PROCESS` and `START_WORKERS` are dead variables. Nothing reads
either: there is no `startWorkers()` for an API process to call, no `"all"`
process role, and no `roleRunsWorkers`. `haven up` refuses a stack whose
environment still names one, on ANY value rather than only the value that used
to change what ran, because no value of either describes a topology this
repository has. `haven up ±workers` is refused the same way — the workers lane
always runs, so there is nothing left to select.

### What runs a local stack

| Entry point | What it starts |
| --- | --- |
| `pnpm dev` | `dev/scripts/dev-stack.sh`: the three Node lanes under `concurrently`, plus aigateway and nlpgo when their toolchain is present and their ports are free |
| `make haven up` | the same three lanes as supervised children (`ui`, `api`, `workers`), each `pnpm --filter <package> dev` from the workspace root, plus the routed Go services |
| `make quickstart <preset>` | `dev/compose.dev.yml`'s `ui`, `api` and `workers` services |

The port layout is unchanged and still derived from `PORT` (default 5560): ui on
`PORT`, api on `PORT + 1000`, worker metrics on `PORT - 2561`, gateway on
`PORT + 3`. `dev/scripts/check-ports.sh` reserves all three Node ports
unconditionally — there is no mode in which one of them is unbound.

### Consequences

- One more local process than the 2026-07 default, and it is the honest one:
  a dev stack that boots and processes no jobs is no longer reachable by
  configuration.
- The contributor source of truth is the **workspace-root `.env`**, with
  haven's `.env.portless` overlay beside it. Every application resolves both
  from there. A checkout upgrading across this change moves its own file:
  `mv platform/app/.env .env`.
- The migration lane the compose stack runs moved to the api service, which
  owns the schema: Prisma deploy then the ClickHouse task, once, before the
  process starts. The ui lane waits on it, so a browser never loads the SPA
  against a half-migrated database.
