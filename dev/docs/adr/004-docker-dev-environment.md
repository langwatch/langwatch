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

| Profile | Services | Use Case |
|---------|----------|----------|
| (none) | postgres, redis, clickhouse, app | Minimal frontend dev |
| nlp | + langwatch_nlp, langevals | Evaluations |
| scenarios | + workers (includes scenarios), bullboard, ai-server, nlp | Scenario development |
| full | Everything | Full integration |

### Init Container Pattern

```yaml
init:
  image: node:24
  command: sh -c "pnpm install && pnpm prisma generate"
  volumes:
    - ./langwatch:/app
    - app_modules:/app/node_modules  # Named volume

app:
  volumes:
    - ./langwatch:/app
    - app_modules:/app/node_modules  # Same volume
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
Profiles keep everything in one file, easier to maintain. `--profile scenarios` is clearer than `-f compose.yml -f compose.scenarios.yml`.

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
- `compose.dev.yml` - Docker Compose configuration
- `scripts/dev.sh` - Interactive profile chooser
- `Makefile` - Convenience targets

**Trade-offs accepted:**
- First startup slower (init container installs deps), but mitigated by shared pnpm store volume
- Requires Docker Desktop with sufficient memory allocation
- Host node_modules still needed for IDE tooling (separate from container's)

**Performance optimization:**
The `pnpm_store` named volume persists downloaded packages across container restarts and is shared across all worktrees (`name: langwatch-pnpm-store`). After first install, subsequent `pnpm install` runs are significantly faster.

## Amendment: Worktree Isolation (2026-03)

### Context

The original design used `VOLUME_PREFIX` for volume naming but `scripts/dev.sh` did not set it when running from worktrees, causing container and volume collisions between parallel worktrees.

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

## Amendment: Stateful volumes + entry point (2026-05, #3860)

### Context

The 2026-03 worktree-isolation amendment treated **every** volume as per-worktree. That worked for `node_modules` (Linux ELF deps that diverge across branches) but had two side effects:

1. Sign-up state didn't persist across worktrees. Sign up `browser-test@langwatch.ai` in worktree A; switch to worktree B; the account is gone.
2. Profiles conflated *what services exist* with *what I want containers for*. Frontend-only work doesn't actually need its own postgres / redis / clickhouse — it could share with whatever else is running.

### Changes

**Stateful services share volumes across worktrees.** `db-data`, `clickhouse-data`, and `redis-data` use stable names (`langwatch-db-data`, `langwatch-clickhouse-data`, `langwatch-redis-data`) — they no longer interpolate `VOLUME_PREFIX`. Sign up once, persist forever.

Trade-off: only one worktree can have the same stateful container `up` at a time (postgres locks `/var/lib/postgresql/data`). `scripts/dev.sh` detects this (`check_stateful_collision`) and fails fast with a clear message pointing at the other compose project.

**Redis is a singleton with a fixed host port.** `redis:alpine` exposes `:6379` on the host and uses the shared `langwatch-redis-data` volume. Parallel worktrees reuse the same redis instance.

**Per-worktree volumes still apply to:** `app_modules`, `bullboard_modules`, `goose_bin`. These hold Linux-platform dependencies that vary by branch lockfile and must stay isolated.

**`make quickstart` is now the single entry point.** `make dev`, `make dev-nlp`, etc. and `make dev-up` / `make dev-down` / `make dev-logs` print a deprecation warning on stderr and forward to the same compose flow for one release before being removed. New: `make quickstart-help` (or `./scripts/dev.sh help`) prints a non-interactive mode reference for agents and CI.

**Fail-fast SSRF guard.** `scripts/dev.sh` errors if `langwatch/.env` has `IS_SAAS=true` with `BLOCK_LOCAL_HTTP_CALLS=false`. (Compose's runtime always sets `BLOCK_LOCAL_HTTP_CALLS=true` via `x-common-env`, but workers running outside compose / lambdas would inherit the broken combo.)

### Migration

Existing worktrees have stale `lw-<hash>-db-data` / `lw-<hash>-clickhouse-data` / `lw-<hash>-redis-data` volumes from the previous scheme. The first `make quickstart` after upgrading creates the new shared volumes (`langwatch-*-data`) — old volumes are not deleted automatically. To recover space:

```
docker volume ls | grep -E '^local +lw-[0-9a-f]{8}-(db|redis|clickhouse)-data'
docker volume rm <volume-name>   # one per worktree, after confirming you don't need the data
```

### Deferred (separate follow-up)

This amendment intentionally does not change the **default** of `make quickstart`. AC#2 / AC#3 of #3860 — intent-based prompting and "frontend-only → `pnpm dev` against remote dev services" — depend on remote dev services existing as a documented user-facing surface. They don't yet. A separate issue tracks that prerequisite work; until then, the existing local-services default stays.
