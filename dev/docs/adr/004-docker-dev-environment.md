# ADR-004: Docker Compose Development Environment

**Date:** 2026-01-23

**Status:** Accepted

## Context

Local development required running multiple services (postgres, redis, clickhouse, NLP, workers, app) manually in separate terminals. Different developers need different service combinations:
- Frontend work: just app + postgres + redis
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
