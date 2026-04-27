# @langwatch/projection-replay

CLI tool for replaying historical events through fold projections. Use this to backfill projection state after adding new projections, changing projection logic, or recovering from data issues.

## Setup

```bash
cp .env.example .env
# Edit .env with your connection details
pnpm install
```

## Commands

### List projections

```bash
pnpm dev list
```

Shows all discovered fold projections with their pipeline, event types, and pause keys.

### Replay

```bash
# Interactive mode (wizard prompts for all options)
pnpm dev replay

# Single tenant, single projection
pnpm dev replay --projection traceSummary --tenant-id proj_abc --since 2026-01-01

# All tenants for a projection (omit --tenant-id)
pnpm dev replay --projection experimentRunState --since 2026-01-01

# Multiple projections
pnpm dev replay --projection traceSummary,evaluationRun --tenant-id proj_abc --since 2026-01-01

# Batch mode with tenant file (unattended, stops on first error)
pnpm dev replay --projection traceSummary --tenant-file tenants.txt --since 2026-01-01

# Dry run (discover and count without replaying)
pnpm dev replay --projection traceSummary --tenant-id proj_abc --since 2026-01-01 --dry-run
```

### Cleanup

Remove stale Redis markers from a crashed or aborted replay:

```bash
pnpm dev cleanup --projection traceSummary
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--projection <name>` | Projection name(s), comma-separated | interactive |
| `--tenant-id <ids>` | Tenant ID(s), comma-separated | interactive |
| `--tenant-file <path>` | File with tenant IDs (one per line) | - |
| `--since <date>` | Discover aggregates with events from this date | interactive |
| `--batch-size <n>` | Events per ClickHouse page | 5000 |
| `--aggregate-batch-size <n>` | Aggregates per batch | 1000 |
| `--concurrency <n>` | Parallel aggregate replays per batch | 10 |
| `--dry-run` | Discover and count without replaying | false |
| `--clickhouse-url <url>` | ClickHouse URL (or `CLICKHOUSE_URL` env) | - |
| `--redis-url <url>` | Redis URL (or `REDIS_URL` env) | - |
| `--database-url <url>` | Database URL (or `DATABASE_URL` env) | - |

## How it works

### Batch cycle

Each batch of aggregates goes through six phases:

1. **Mark** — Redis markers set to "pending" for the batch
2. **Pause** — Projection paused in GroupQueue (no new jobs dispatched)
3. **Drain** — Wait for in-flight jobs to complete (fast — only active jobs)
4. **Cutoff** — Record max EventId per aggregate from ClickHouse
5. **Load** — Fetch all events up to cutoff into memory
6. **Replay** — Fold events in memory, batch write to ClickHouse (5k rows/INSERT)
7. **Unmark + Unpause** — Remove markers, resume live processing

### Live event coordination

While replay is active for an aggregate, the `ReplayMarkerChecker` in `ProjectionRouter` handles live events:

- **No marker** → normal processing
- **"pending"** → throw `ReplayDeferralError` (queue retries with backoff)
- **Event ≤ cutoff** → skip (replay handles it)
- **Event > cutoff** → defer (queue retries until replay finishes)

### Resume support

If a replay crashes or is aborted, markers are preserved. Re-running the same command detects the previous run and offers to resume (skipping completed aggregates) or start fresh.

### Tenant isolation

Events are grouped by `tenantId` at every stage — discovery, loading, folding, and writing. The replay executor uses tenant-scoped keys (`${tenantId}::${projectionKey}`) to prevent cross-tenant state leakage.
