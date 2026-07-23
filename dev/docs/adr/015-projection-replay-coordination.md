# ADR-015: Projection Replay Coordination Protocol

**Date:** 2026-04-01

**Status:** Accepted

**Related to:** [ADR-062](./062-projection-clickhouse-cached-store.md) — the replay protocol defined here is unchanged, but it is now **off the projection hot path**. Projections read back their own committed state and never refold from `event_log` on delivery, so this protocol runs only for projection-version migration and disaster recovery.

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

7. **Unmark + Unpause** — replace each replayed aggregate's cutoff marker with a terminal `done:` marker (`markCompletedBatch`: `HDEL` from the cutoff hash + `SET` of the per-aggregate done key carrying the same `{ts}:{eventId}` value) and `SADD` it into the completed set; aggregates that had no cutoff (no events found) are plain-`HDEL`ed. Then `SREM` the pause entry and signal GroupQueue wake-up. Deferred live events retry: the done marker keeps events at or before the cutoff skipped — a job staged but never active during the pause is not caught by the drain, and without the boundary it would re-process events the replay just rebuilt — while events after the cutoff process normally.

### Marker format and comparison

Cutoff markers use the format `{timestamp}:{eventId}` (colon-separated). The comparison function `isAtOrBeforeCutoff(eventTimestamp, eventId, cutoffTimestamp, cutoffEventId)` mirrors ClickHouse's `ORDER BY EventTimestamp ASC, EventId ASC`, ensuring the boundary is consistent between the replay's CH queries and the live event handler's Redis check.

This comparison is defined once in `replayConstants.ts` and shared by both the replay service and the live `RedisReplayMarkerChecker`.

### Redis key layout

| Key | Type | Purpose |
|---|---|---|
| `projection-replay:cutoff:{projectionName}` | Hash | Field = aggregateKey, Value = "pending" or "{ts}:{eventId}" — in-flight markers for the current batch |
| `projection-replay:done:{projectionName}:{aggregateKey}` | String | Value = "{ts}:{eventId}" — terminal per-aggregate marker written when replay finishes an aggregate, preserving its cutoff boundary so post-unpause stragglers (jobs staged but never active during the pause) still skip events at/before the cutoff while newer events process normally |
| `projection-replay:completed:{projectionName}` | Set | Aggregate keys that finished replay (for resume) |

The cutoff hash has a 7-day TTL to prevent orphaned markers from permanently blocking live processing if a replay crashes without cleanup. Done markers live in their own short-TTL string keys (15 minutes, `DONE_MARKER_TTL_SECONDS`) rather than in the cutoff hash, so a giant all-tenant replay does not retain a marker per aggregate for its whole duration — the cutoff hash stays bounded to in-flight aggregates and done markers self-expire. The completed set has no TTL; it is deleted by the final cleanup after full completion.

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

**Why not FINAL on OPTIMIZE?** `OPTIMIZE TABLE ... FINAL` forces a synchronous full merge which can be very expensive on large tables and block other operations. Without FINAL, ClickHouse schedules the merge in the background, which is sufficient since ReplacingMergeTree dedup is eventually consistent and queries already handle duplicates via the IN-tuple dedup pattern (`GROUP BY key + max(UpdatedAt)` in subquery) or `argMax`.

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

## Amendment (2026-07-14): Per-batch pause in the optimized replay + bulk write/query fixes

The optimized multi-projection path (`replayOptimized`) had drifted from this
ADR in ways that made production replays take weeks while freezing live
processing for the entire run:

1. **Pause/drain scope.** `replayOptimized` paused ALL selected projections
   and drained ALL discovered aggregates once, up front, and only unpaused
   after the last batch — a full-run freeze, contradicting the "seconds per
   batch" pause window above. It now pauses, drains (only the current batch's
   aggregates), replays, and unpauses **per batch**, exactly like the
   non-optimized path, with the unpause in a per-batch `finally` so a batch
   failure can never leave projections frozen. The marker protocol
   (pending/cutoff/done) already guarantees correctness across the unpaused
   gaps between batches.

2. **Map-projection bulk writes.** The replay `MapAccumulator` grouped
   buffered records per AGGREGATE and sequentially awaited one
   `store.bulkAppend` per group. For `spanStorage` the aggregate is a single
   trace, so each trace became its own awaited ClickHouse INSERT
   (`wait_for_async_insert: 1`, ~200ms each). Records are now flushed in
   chunks (default 5000) per TENANT; `AppendStore.bulkAppend` takes a
   tenant-scoped `BulkAppendContext` (no `aggregateId` — records carry what
   stores need per row). The live `append()` path is unchanged.

3. **Partition pruning.** `event_log` is `PARTITION BY
   toYearWeek(EventOccurredAt)`, but the cutoff/load queries filtered only on
   TenantId/AggregateId, scanning every partition (including S3 cold storage)
   once per batch. Each batch now first computes the `EventOccurredAt`
   min/max over ALL events of its aggregates (`getAggregateOccurredAtBounds`,
   a cheap key-column read) and passes that range to the cutoff and load
   queries. The bound is provably safe — every event those queries must see
   existed when the bounds were computed; later appends fall after the cutoff
   and are handled live. (Bounding by the replay's `since` would be unsafe:
   folds rebuild from `init()` and need history predating `since`.)

4. **Per-tenant I/O and progress cadence.** Cutoff and load queries now run
   in parallel across tenants within a batch; replay-phase progress emits are
   throttled (every 100 aggregates) instead of per aggregate; and the ops
   replay lock (1h TTL) is kept alive by a standalone heartbeat timer in the
   ops `ReplayService` — a `setInterval` firing every
   `LOCK_REFRESH_INTERVAL_MS` (60s) for the duration of the run, cleared in a
   `finally` around the runtime call. This supersedes the earlier per-batch
   refresh: running independently of progress/batch callbacks, the heartbeat
   keeps the lock (and status updates) alive even when a single batch phase
   (a huge tenant's drain wait, a slow ClickHouse load) emits nothing for
   longer than the lock TTL. Each tick calls `ReplayRepository.refreshLock`
   and also polls the cancel flag; if the refresh reports the lock is now
   held by another run, the tick flags the stale run for abort via the
   existing cancellation path and stops the heartbeat.

## Amendment (2026-07-14): Failed batches clear their in-flight replay markers

The per-batch error path (and a cancellation that abandons an in-flight batch,
which surfaces through the same catch) previously returned early without
touching the batch's `pending`/cutoff markers, so the live checker kept
deferring the failed batch's aggregates until the 7-day marker TTL lapsed or
an operator re-ran the replay. The failure path now removes those markers
(`removeInFlightMarkers` — HDEL only) before returning: the batch's aggregates
were never replayed, so they go straight back to unconditional live
processing, matching their pre-replay state. `done` markers and completed-set
entries written by previously completed batches are deliberately left intact
so a re-run still skips completed aggregates (resume). Cleanup is best-effort
— a marker-cleanup failure is logged and never masks the original batch error.

## References

- Related ADRs:
  - [ADR-007: Event Sourcing Architecture](./007-event-sourcing-architecture.md) — the event-sourcing foundation this replay tooling operates on
  - [ADR-021: Lean Fold Cache](./021-lean-fold-cache.md) — fold cache whose rebuilds are coordinated through this replay protocol
  - [ADR-022: event_log as single source of truth](./022-event-log-source-of-truth.md) — the event log replays read from
  - [ADR-024: Cold-path tiered storage](./024-cold-path-tiered-storage.md) — the S3 cold storage that the amendment's partition pruning avoids scanning
  - [ADR-034: Event-Sourced Analytics Materialization](./034-event-sourced-analytics-materialization.md) — analytics projections rebuilt via this replay mechanism
- Spec: `specs/event-sourcing/projection-replay.feature` — behavioural scenarios for the replay coordination this ADR decides
- ClickHouse ReplacingMergeTree: https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/replacingmergetree
- BullMQ GroupQueue pause mechanism: internal `{event-sourcing/jobs}:gq:paused-jobs` set
