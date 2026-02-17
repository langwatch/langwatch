# @langwatch/projection-replay

CLI tool to replay historical events from ClickHouse `event_log` through fold projections, backfilling projection state for a given tenant from a given date.

## When to use

When a new fold projection is added (or an existing one is modified), it only processes events arriving _after_ deployment. This tool replays historical events through the projection to backfill the state.

## Setup

```bash
cd langwatch/packages/projection-replay
cp .env.example .env
# Edit .env with your connection URLs
pnpm install
```

### Environment variables

Connection URLs can be set via `.env`, shell environment, or CLI flags. CLI flags take precedence over env vars.

| Variable | Description |
|----------|-------------|
| `CLICKHOUSE_URL` | ClickHouse connection URL (e.g. `https://user:pass@host:8123/langwatch`) |
| `REDIS_URL` | Redis connection URL (e.g. `redis://localhost:6379`) |

## Usage

### List available projections

```bash
pnpm dev list
```

### Dry run (count aggregates/events without replaying)

```bash
pnpm dev replay \
  --projection tenantDailyBillableEvents \
  --tenant-id project_abc123 \
  --since 2026-01-01 \
  --dry-run
```

### Full replay

```bash
pnpm dev replay \
  --projection tenantDailyBillableEvents \
  --tenant-id project_abc123 \
  --since 2026-01-01
```

### Replay with explicit connection URLs

```bash
pnpm dev replay \
  --projection experimentRunState \
  --tenant-id project_abc123 \
  --since 2025-06-01 \
  --clickhouse-url "https://user:pass@ch.example.com:8123/langwatch" \
  --redis-url "redis://redis.example.com:6379"
```

### Replay with custom batch size

```bash
pnpm dev replay \
  --projection experimentRunState \
  --tenant-id project_abc123 \
  --since 2025-06-01 \
  --batch-size 1000
```

### Replay with custom batch size & concurrency count

```bash
pnpm dev replay \
  --projection experimentRunState \
  --tenant-id project_abc123 \
  --since 2025-06-01 \
  --batch-size 10000 \
  --concurrency 20
```

### Cleanup (remove stuck markers after a crash)

```bash
pnpm dev cleanup --projection tenantDailyBillableEvents
```

## Arguments

### `replay` command

| Argument | Required | Description |
|----------|----------|-------------|
| `--projection <name>` | Yes | Fold projection name (use `list` to see available names) |
| `--tenant-id <id>` | Yes | Tenant ID to replay events for |
| `--since <YYYY-MM-DD>` | Yes | Discover aggregates with events from this date |
| `--clickhouse-url <url>` | No | ClickHouse connection URL (falls back to `CLICKHOUSE_URL` env var) |
| `--redis-url <url>` | No | Redis connection URL (falls back to `REDIS_URL` env var) |
| `--batch-size <n>` | No | Events per ClickHouse page (default: 5000) |
| `--concurrency <n>` | No | Max aggregate streams replayed in parallel (default: 10) |
| `--dry-run` | No | Count only, don't replay |

### `cleanup` command

| Argument | Required | Description |
|----------|----------|-------------|
| `--projection <name>` | Yes | Projection name to clean up markers for |
| `--redis-url <url>` | No | Redis connection URL (falls back to `REDIS_URL` env var) |

## How it works

1. **Discover** — Finds aggregates with relevant events since `--since` for the given tenant
2. **Batch replay** — Aggregates are processed in batches:
   - **Mark** — Sets Redis markers to defer live handler processing
   - **Drain** — Waits for in-flight jobs to complete
   - **Cutoff** — Records the latest EventId as the boundary
   - **Load** — Fetches all events from ClickHouse into memory
   - **Replay** — Folds events through the projection concurrently (up to `--concurrency` aggregate streams in parallel)
   - **Unmark** — Removes the markers; deferred events resume normally
3. **Cleanup** — Removes all Redis markers after completion

### Concurrent safety

While replay runs, the live system continues processing events. Per-aggregate Redis markers coordinate:
- Events <= cutoff: skipped by live handler (replay handles them)
- Events > cutoff: deferred by live handler until replay finishes
- Other aggregates: completely unaffected

### Coalescing and per-key locking

Different aggregates often map to the **same projection key** (e.g. same day + SDK combo). Two optimizations prevent Prisma `P2002` unique constraint races and reduce store calls:

1. **Coalescing** — Within each aggregate, all events are applied in memory first, then `store.store()` is called once per unique projection key with the accumulated state (e.g. `increment: 5` instead of five separate `increment: 1` calls).
2. **Per-key mutex** — A shared in-memory mutex serializes store calls across concurrent workers when they target the same projection key, preventing INSERT races on the same Postgres row.

### Resume support

If a replay is interrupted, re-running the same command detects previous progress and offers to resume from where it left off (skipping already-completed aggregates).

### Re-replay safety

- **ClickHouse stores** (evaluationState, experimentRunState, traceSummary): Safe to re-replay (latest row wins)
- **Prisma increment stores** (tenantDailyEventStats): Must truncate the table before re-replaying to avoid double-counting

## Replay log

Every run creates a JSONL log file in the working directory:

```
projection-replay-{projectionName}-{timestamp}.jsonl
```

Tail it for live progress:

```bash
tail -f projection-replay-*.jsonl
```
