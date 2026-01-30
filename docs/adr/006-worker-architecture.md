# ADR-006: Single Entry Point Worker Architecture

**Date:** 2025-01-30

**Status:** Accepted

## Context

LangWatch uses BullMQ background workers for processing trace collection, evaluations, topic clustering, event tracking, usage stats, and event sourcing. Previously, workers could be initialized from two locations:

1. **start.ts** (via `initializeBackgroundWorkers()`) - Called when the HTTP server started
2. **workers.ts** (via `start:workers` command) - Dedicated worker entry point

This dual initialization created several problems:

- **Worker duplication risk** in deployments where both paths could execute
- **Confusion** about which deployment pattern was correct
- **Resource contention** when the same workers ran in multiple processes
- **Difficulty debugging** worker issues due to unclear ownership

## Decision

We will use a **single entry point** (`workers.ts`) for all background worker initialization. The HTTP server (`start.ts`) will only serve HTTP requests and will not initialize any background workers.

### Production Deployment Patterns

#### Pattern 1: Separate Worker Pods (Recommended for Scale)

```
Main Deployment (replicas: N)     Worker Deployment (replicas: 1-M)
├── start:app                     ├── start:workers
├── HTTP server                   ├── All BullMQ workers
└── /workers/metrics proxy        └── Metrics on port 2999
```

Use this pattern when:
- You need to scale HTTP and workers independently
- Workers are resource-intensive
- You want isolation between web and worker failures

#### Pattern 2: Combined Deployment (Simpler Setup)

```
Single Pod
├── start.sh (runs concurrently)
│   ├── start:app (HTTP server)
│   └── start:workers (BullMQ workers)
└── Redis configured via REDIS_URL
```

The `start.sh` script automatically detects Redis configuration and starts workers alongside the app using `concurrently`.

### Local Development

Workers start via:
- **Docker profile**: `make dev-scenarios` includes a worker container
- **Concurrent setup**: `pnpm start` runs both app and workers when Redis is configured

### Single Entry Point Principle

- `workers.ts` is the **only** place workers initialize
- `start.ts` must **never** import or call worker initialization code
- Workers are discovered via BullMQ queues, not process-local state

## Rationale

**Why remove workers from start.ts?**

1. **Clear ownership** - One file, one responsibility
2. **Deployment flexibility** - HTTP and workers can scale independently
3. **No duplication risk** - Impossible to accidentally run workers twice
4. **Easier debugging** - Worker logs come from one process type

**Why keep workers.ts as entry point?**

- Existing deployments already use `start:workers`
- Clean separation from Next.js lifecycle
- Independent restart/scaling of workers

## Consequences

**Positive:**
- Worker initialization is predictable and testable
- Deployments are simpler to reason about
- No risk of worker duplication in multi-pod deployments

**Negative:**
- Local development requires Docker or explicit worker start
- Existing single-process deployments need migration (handled by start.sh)

**Migration:**
- Deployments calling `startApp()` expecting workers must add `start:workers`
- The `start.sh` script handles this automatically for combined deployments

## References

- Related ADRs: ADR-003 (Logging), ADR-004 (Docker Dev Environment)
