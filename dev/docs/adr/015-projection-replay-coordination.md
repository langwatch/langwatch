# ADR-015: Projection Replay Coordination Protocol

**Date:** 2026-04-01

**Status:** Accepted

## Context

LangWatch uses event sourcing with fold projections that materialize state into ClickHouse (ReplacingMergeTree tables). Over time, projection logic evolves — bug fixes, new fields, schema changes — and historical data must be reprocessed ("replayed") to bring projection state up to date.

Replaying events while live processing continues creates a consistency problem: if both the replay tool and the live event pipeline write to the same projection row concurrently, ClickHouse's ReplacingMergeTree deduplication picks the row with the latest `UpdatedAt`. A replay write with an older `UpdatedAt` would be silently discarded (correct), but a live write arriving mid-replay could use stale fold state if the replay hasn't yet overwritten it (incorrect — the live event would fold on top of pre-replay state, producing a wrong result that the replay then can't fix because its `UpdatedAt` is older).

The system has ~70 million events in production across multiple tenants, some with dedicated ClickHouse databases. The replay tool must:

1. Not corrupt live projection state
2. Not require downtime
3. Handle crashes and resume without orphaning coordination state
4. Work across tenant-specific ClickHouse databases
5. Not OOM on large datasets

## Decision

We implement a **7-phase batch cycle** coordinated via Redis markers between the replay service (`src/server/event-sourcing/replay/`) and the live projection router (`projectionRouter.ts`). The replay is a first-class service within the event-sourcing framework, not a standalone package.

### The 7-phase batch cycle

For each batch of aggregates (default 1000):

1. **Mark** — `HSET projection-replay:cutoff:{projection} {aggKey} "pending"` for each aggregate. Live events hitting a "pending" marker are deferred (retried via GroupQueue backoff).

2. **Pause** — `SADD {event-sourcing/jobs}:gq:paused-jobs {pipelineName}/{projectionName}`. The GroupQueue stops dispatching new jobs for this projection.

3. **Drain** — Poll Redis for active job keys matching the batch's aggregates. Wait until all in-flight jobs complete (200ms poll interval, 60s timeout). After drain, no live events are being processed for these aggregates.

4. **Cutoff** — Query ClickHouse for each aggregate's latest `(EventTimestamp, EventId)` using `argMax`. Replace the "pending" marker with `{timestamp}:{eventId}`. Live events arriving after this point compare against the cutoff: events at or before the cutoff are skipped (replay handles them); events after the cutoff are deferred.

5. **Replay** — Stream events from ClickHouse page-by-page (cursor pagination, default 5000 per page). Each page is applied to a `FoldAccumulator` and immediately discarded — only fold states (bounded by batch size) stay in memory. This prevents OOM on large aggregates.

6. **Write** — Flush accumulated fold states to ClickHouse in a single batched INSERT per tenant (`wait_for_async_insert: 1`). Since ReplacingMergeTree uses `UpdatedAt` for dedup, the replay's writes always win because `apply()` produces the canonical state from all events.

7. **Unmark + Unpause** — `HDEL` cutoff markers, `SREM` the pause entry, signal GroupQueue wake-up. Deferred live events retry and process normally.

### Marker format and comparison

Cutoff markers use the format `{timestamp}:{eventId}` (colon-separated). The comparison function `isAtOrBeforeCutoff(eventTimestamp, eventId, cutoffTimestamp, cutoffEventId)` mirrors ClickHouse's `ORDER BY EventTimestamp ASC, EventId ASC`, ensuring the boundary is consistent between the replay's CH queries and the live event handler's Redis check.

This comparison is defined once in `replayConstants.ts` and shared by both the replay service and the live `RedisReplayMarkerChecker`.

### Redis key layout

| Key | Type | Purpose |
|---|---|---|
| `projection-replay:cutoff:{projectionName}` | Hash | Field = aggregateKey, Value = "pending" or "{ts}:{eventId}" |
| `projection-replay:completed:{projectionName}` | Set | Aggregate keys that finished replay (for resume) |

All markers have a 7-day TTL to prevent orphaned markers from permanently blocking live processing if a replay crashes without cleanup.

### Architecture: framework-owned service

The replay logic lives in `src/server/event-sourcing/replay/` as a first-class service:

- `ReplayService` — orchestrates the full batch cycle
- `FoldAccumulator` — streaming fold state accumulation (bounded memory)
- `replayEventLoader` — ClickHouse queries for discovery and event loading
- `replayMarkers` — Redis marker operations
- `replayDrain` — GroupQueue pause/unpause/wait
- `replayConstants` — shared key prefixes and comparison function

Fold projections are discovered via `PipelineRegistry.buildFoldProjections()` — single source of truth. The CLI package (`packages/projection-replay/`) is a thin TUI shell that calls the service.

### Batch inserts

All projection stores implement `storeBatch()` with single-INSERT semantics:

- `TraceSummaryClickHouseRepository.upsertBatch()` — single INSERT for N trace summaries
- `EvaluationRunClickHouseRepository.upsertBatch()` — single INSERT for N evaluation runs
- `ExperimentRunStateRepositoryClickHouse.storeProjectionBatch()` — single INSERT
- `SimulationRunStateRepositoryClickHouse.storeProjectionBatch()` — single INSERT
- `SuiteRunStateRepositoryClickHouse.storeProjectionBatch()` — single INSERT

All batch inserts use `wait_for_async_insert: 1` to ensure data lands before unpausing.

### Post-replay optimization

After all projections complete, the service runs `OPTIMIZE TABLE {table}` (without FINAL) on each touched ClickHouse table, per tenant database. This nudges ReplacingMergeTree to merge and deduplicate sooner. Non-fatal if it fails — merge happens eventually.

## Rationale / Trade-offs

**Why Redis markers instead of a database flag?** The live event path checks the marker on every event. Redis HGET returning null costs ~0.1ms — negligible overhead when no replay is active. A database query would add unacceptable latency to the hot path.

**Why pause + drain instead of just markers?** Markers alone create a race: a live event could read fold state, then the replay overwrites it, then the live event writes its result on top of stale state. Pausing the GroupQueue and draining in-flight jobs eliminates this race entirely. The pause window is brief (seconds per batch).

**Why stream events instead of loading all into memory?** With 70M events, a batch of 1000 aggregates could have 100K+ events with large JSON payloads. Loading all into memory risks OOM. Streaming through `FoldAccumulator` keeps memory bounded by the number of fold states (≤ batch size), not the number of events.

**Why not FINAL on OPTIMIZE?** `OPTIMIZE TABLE ... FINAL` forces a synchronous full merge which can be very expensive on large tables and block other operations. Without FINAL, ClickHouse schedules the merge in the background, which is sufficient since ReplacingMergeTree dedup is eventually consistent and queries already handle duplicates via `LIMIT 1 BY` or `argMax`.

**Why per-tenant CH client resolution?** Some tenants have dedicated ClickHouse databases (for data residency or performance isolation). The `clickhouseClientResolver: (tenantId: string) => Promise<ClickHouseClient>` pattern lets the replay service route writes to the correct database without hardcoding the topology.

## Consequences

**Positive:**
- Replay runs without downtime — live processing continues with brief per-batch pauses
- Crash safety — 7-day TTL on markers prevents permanent blocking; completed-set enables resume
- Memory-safe — streaming fold accumulation prevents OOM on large datasets
- Single source of truth — `PipelineRegistry.buildFoldProjections()` means adding a new projection automatically makes it available for replay
- Batch inserts — 1 HTTP request per batch instead of N, reducing ClickHouse load

**Negative:**
- Added complexity in the live event path — `RedisReplayMarkerChecker` adds a Redis HGET per event (mitigated: ~0.1ms when no replay active, returns null immediately)
- GroupQueue pause affects all events for the projection, not just the replayed aggregates — brief pause window minimizes impact
- Redis becomes a coordination dependency — if Redis is down, replay cannot run (but live processing continues via `NoopReplayMarkerChecker` fallback)

**Neutral:**
- The CLI package still exists for the TUI experience but contains no business logic — it delegates entirely to the framework service
- `OPTIMIZE TABLE` is best-effort — if it fails, eventual consistency handles it

## References

- Related ADRs: None (first event-sourcing operational tooling ADR)
- ClickHouse ReplacingMergeTree: https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/replacingmergetree
- BullMQ GroupQueue pause mechanism: internal `{event-sourcing/jobs}:gq:paused-jobs` set
