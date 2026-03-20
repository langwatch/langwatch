# ES → ClickHouse Migration

CLI tool to migrate simulation events and batch evaluation data from ElasticSearch to ClickHouse via the event sourcing system.

## How it works

Reads documents from ES, aggregates them into domain objects, then calls `processCommand()` directly (no Redis/BullMQ needed). Events are stored in `event_log` and projections (fold/map) run synchronously in-process.

Reactors are skipped via `processRole: "migration"` — no SSE broadcasts or ES sync writes.

## Quick start

```bash
# From langwatch/langwatch/packages/es-migration

# Required env vars
export ELASTICSEARCH_NODE_URL="http://localhost:9200"
export CLICKHOUSE_URL="http://localhost:8123"

# Optional ES auth
export ELASTICSEARCH_API_KEY="your-api-key"

# Safest first test — dry run a single batch, outputs to ./dry-run-simulations.jsonl
pnpm tsx src/index.ts simulations --dry-run --single-batch

# Review the output
cat dry-run-simulations.jsonl | jq .

# Run a single live batch
pnpm tsx src/index.ts simulations --single-batch

# Full migration
pnpm tsx src/index.ts all
```

## Usage

```
es-migration [target] [options]

Targets:
  simulations         Migrate simulation events only
  batch-evaluations   Migrate batch evaluation data only
  all                 Migrate both (default)

Options:
  --dry-run, -n       Read ES and check CH, but don't write anything.
                      Outputs JSONL with ES input + generated commands.
  --single-batch, -1  Process one batch then stop (good for testing)
  --help, -h          Show help
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ELASTICSEARCH_NODE_URL` | Yes | — | ES connection URL |
| `ELASTICSEARCH_API_KEY` | No | — | ES API key |
| `CLICKHOUSE_URL` | Yes | — | ClickHouse connection URL |
| `BATCH_SIZE` | No | 1000 | Events per ES fetch |
| `CONCURRENCY` | No | 50 | Parallel aggregates per batch |
| `MAX_EVENTS` | No | unlimited | Stop after N events |
| `MAX_BATCHES` | No | unlimited | Stop after N batches |
| `DRY_RUN` | No | false | Same as `--dry-run` flag |
| `DRY_RUN_OUTPUT` | No | `./dry-run-{target}.jsonl` | Custom dry-run output path |
| `BATCH_DELAY_MS` | No | 0 | Delay between batches (ms) |
| `CURSOR_FILE` | No | `./cursor-{target}.json` | Custom cursor file path |
| `LOG_LEVEL` | No | info | `debug\|info\|warn\|error` |
| `ES_PORT_FORWARD` | No | false | Enable kubectl port-forward for ES |

### Recommended values

#### Traces & Evaluations

```
BATCH_SIZE=5000
SUB_BATCH_SIZE=2000
CH_BATCH_SIZE=5000
CONCURRENCY=1000
CURSOR_REWIND_MS=21600000
```

#### DSpy Steps

```
BATCH_SIZE=100
CH_BATCH_SIZE=100
CONCURRENCY=10
CURSOR_REWIND_MS=21600000
```

## Dry-run output

When using `--dry-run`, the output is a JSON array file (`./dry-run-{target}.json`). Each entry contains the ES source data, the commands that would be dispatched, and the events that `processCommand` would produce:

```json
[
  {
    "aggregateId": "run_abc123",
    "esInput": { /* raw ES document or aggregated events */ },
    "commands": [
      {
        "commandName": "startRun",
        "commandType": "StartRunCommand",
        "payload": { /* command payload */ }
      }
    ],
    "events": [
      {
        "id": "evt_...",
        "type": "RunStarted",
        "aggregateId": "run_abc123",
        "data": { /* event data (projection input) */ }
      }
    ]
  }
]
```

This lets you compare the ES source data against the commands and resulting events/projections.

## Cursor & resume

The migration saves progress to a cursor file (`./cursor-simulations.json` or `./cursor-evaluations.json`). If interrupted, it resumes from the last processed event on restart.

Delete the cursor file to start from the beginning.

## Runtime controls

- **Pause/Resume**: Press `p` during migration to pause after the current batch. Press `p` again to resume.
- **Graceful shutdown**: `Ctrl+C` finishes the current batch then exits. Press again to force quit.

## ClickHouse backpressure

The migrator monitors ClickHouse parts-per-partition and pauses automatically when the merge load is too high (>50 parts). It resumes when merges catch up (<20 parts).

## Testing workflow

1. **Dry-run single batch** — verify the mapping is correct:
   ```bash
   pnpm tsx src/index.ts simulations --dry-run --single-batch
   cat dry-run-simulations.jsonl | jq .
   ```

2. **Live single batch** — process one batch and verify in ClickHouse:
   ```bash
   pnpm tsx src/index.ts simulations --single-batch
   ```

3. **Limited run** — process a few thousand events:
   ```bash
   MAX_EVENTS=5000 pnpm tsx src/index.ts simulations
   ```

4. **Full migration**:
   ```bash
   pnpm tsx src/index.ts all
   ```
