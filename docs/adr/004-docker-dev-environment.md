# ADR-004: Docker Compose Development Environment

**Date:** 2026-01-23

**Status:** Accepted

## Context

Local development required running multiple services (postgres, redis, opensearch, NLP, workers, app) manually in separate terminals. Different developers need different service combinations:
- Frontend work: just app + postgres + redis
- Scenario development: + workers + bullboard + ai-server (scenario processing is part of workers)
- Full stack: everything

Additionally, macOS developers face platform mismatch issues: native Node modules (esbuild, Prisma) compiled for macOS don't work in Linux containers.

## Decision

We use Docker Compose with **profiles** for selective service startup, and an **init container** for cross-platform dependency installation.

### Profiles

| Profile | Services Added | Use Case |
|---------|----------------|----------|
| (none) | postgres, redis, app | Minimal frontend dev |
| search | + opensearch | Trace/search features |
| nlp | + langwatch_nlp, langevals | Evaluations |
| workers | + workers | Background job processing |
| debug | + bullboard | Queue inspection |
| test | + ai-server | AI test server for scenarios |
| scenarios | + workers, bullboard, ai-server, nlp | Scenario development (combines workers + debug + test + nlp) |
| full | Everything | Full integration |

### Workers: Dev vs Production

**Development (`compose.dev.yml`):**
Workers run as a separate container with the `workers` profile. No `START_WORKERS` env var needed — the container runs `pnpm tsx src/workers.ts` directly.

**Production (`compose.yml`):**
Workers run in-process with the app. Controlled by `START_WORKERS` env var:
```yaml
environment:
  START_WORKERS: true  # Enables in-process workers via start.sh
```

The `scripts/start.sh` script checks this:
```bash
if [[ "$START_WORKERS" = "true" || "$START_WORKERS" = "1" ]]; then
  START_WORKERS_COMMAND="pnpm run start:workers && exit 1"
fi
```

### Init Container Pattern

```yaml
init:
  image: node:24
  working_dir: /app
  volumes:
    - ./langwatch:/app
    - app_modules:/app/node_modules
    - pnpm_store:/root/.local/share/pnpm/store
  command: >
    sh -c "
      corepack enable &&
      pnpm config set store-dir /root/.local/share/pnpm/store &&
      if [ ! -f node_modules/.modules.yaml ]; then
        echo 'Installing dependencies for Linux...' &&
        pnpm install &&
        pnpm prisma generate
      else
        echo 'Dependencies already installed'
      fi
    "

app:
  volumes:
    - ./langwatch:/app
    - app_modules:/app/node_modules  # Same volume
  depends_on:
    init:
      condition: service_completed_successfully
```

The init container installs Linux-native dependencies into a named volume. All other containers share this volume, avoiding platform mismatch.

### Per-Worktree Port Configuration

Multiple worktrees can run simultaneously with different ports:
```bash
export APP_PORT=5561        # Default: 5560
export BULLBOARD_PORT=3001  # Default: 3000  
export AI_SERVER_PORT=3457  # Default: 3456
```

The `scripts/dev.sh` auto-detects free ports starting from the defaults.

### Networking

Internal services (postgres, redis, opensearch, nlp, langevals) have no host port exposure. They communicate via Docker network hostnames (`postgres:5432`, `redis:6379`). Only app, bullboard, and ai-server expose ports for browser access.

### Environment Variables

`ELASTICSEARCH_NODE_URL` comes from `.env`, not hardcoded in compose. This allows developers to use shared dev Elasticsearch instead of local opensearch when the search profile isn't needed.

### Resource Limits

| Service | Memory | CPUs | Notes |
|---------|--------|------|-------|
| app | 6GB | 2.0 | Turbopack is hungry |
| workers | 1.5GB | 0.5 | Background processing |
| langwatch_nlp | 1GB | 0.5 | NLP service |
| opensearch | 512MB | 1.0 | Search engine |
| bullboard | 512MB | 0.5 | Queue UI |
| postgres | 256MB | 0.5 | Database |
| langevals | 256MB | 0.5 | Evaluators |
| ai-server | 128MB | 0.25 | Test server |
| redis | 64MB | 0.25 | Cache/queues |

**Approximate totals:**
- Minimal (dev): ~6.3GB
- Scenarios: ~9.3GB
- Full: ~10GB

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

**Why separate workers container in dev?**
Easier to restart workers independently, clearer logs, matches how Kubernetes deployments separate app and worker pods.

## Consequences

**Commands:**
```bash
make dev              # Minimal (postgres + redis + app)
make dev-search       # + opensearch
make dev-nlp          # + NLP + langevals
make dev-scenarios    # + workers + bullboard + ai-server + NLP
make dev-test         # + ai-server
make dev-full         # Everything
make quickstart       # Interactive chooser
make down             # Stop all services
```

**Key files:**
- `compose.dev.yml` - Docker Compose dev configuration (profiles, init container)
- `compose.yml` - Docker Compose production configuration (START_WORKERS)
- `scripts/dev.sh` - Interactive profile chooser
- `scripts/start.sh` - Production startup script (handles START_WORKERS)
- `Makefile` - Convenience targets

**Trade-offs accepted:**
- First startup slower (init container installs deps), but mitigated by shared pnpm store volume
- Requires Docker Desktop with sufficient memory allocation
- Host node_modules still needed for IDE tooling (separate from container's)

**Performance optimization:**
The `pnpm_store` named volume persists downloaded packages across container restarts and is shared across all worktrees (`name: langwatch-pnpm-store`). After first install, subsequent `pnpm install` runs are significantly faster.
