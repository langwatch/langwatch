# ADR-066: Taking `event_log` off the per-item hot path — read-through fold store + append coalescing

**Date:** 2026-07-23

**Status:** Proposed

**Re-affirms & hardens:** [ADR-007](./007-event-sourcing-architecture.md) §"Fold Projections", §"No Checkpoints" ("fold state = stored data"; "`store.get()` loads last state").

**Supersedes:** [ADR-021](./021-lean-fold-cache.md) (the fold-cache *mechanics*; its content-leanness decisions live on in [ADR-022](./022-event-log-source-of-truth.md)).

**Amends:** [ADR-034](./034-event-sourced-analytics-materialization.md) — replaces its `refoldOnStoreMiss` store-continuity mechanism with read-back (the analytics-materialisation shape itself stands).

**Corrects:** [ADR-056](./056-coding-agent-pipeline-session-aggregate.md) §session-aggregate store (the no-read-back store that this ADR forbids).

**Sibling implementation:** [ADR-049](./049-langy-projection-independent-reactions.md) applies the same read-back principle to *operational* folds on Postgres (in-row cursor, no Redis fold cache). This ADR does not supersede it — it names the shared principle and owns the ClickHouse implementation.

**Relates to:** [ADR-015](./015-projection-replay-coordination.md) (replay, narrowed to off-hot-path), [ADR-022](./022-event-log-source-of-truth.md) (heavy-content offload — a separate axis), [ADR-055](./055-canonical-otlp-metric-and-log-pipelines.md) (map-vs-fold choice).

## Context

ADR-007 fixed the model years ago: **fold state = stored data**, the store is a *dumb read/write layer*, and *"on recovery, `store.get()` loads last state, next event continues from there."* A fold reads its state, applies an event, writes it back. Nothing reads the event log on the hot path.

The platform then drifted away from that model, one accretion at a time:

1. A Redis write-through cache (`RedisCachedFoldStore`) was introduced in front of the ClickHouse store, wired **per projection** with its own TTL, and treated as an optional accelerator.
2. Fold options accreted — `refoldOnStoreMiss` and `refoldOnOutOfOrder` — that **replay the aggregate's history from `event_log`** whenever the store can't answer or an event arrives out of order.
3. ADR-056's `codingAgentSession` store took the final step away from ADR-007: its `get()` returns `null` **by design**, because it persists a *lossy analytics row* that cannot reconstruct the fold's working state. That made every cache miss — and, because the flag was never set, every out-of-order delivery — fall through to a full `event_log` refold.

The result was a production outage (2026-07-23). A coding-agent session keyed by trace id accumulated thousands of events; each cache-miss / out-of-order delivery replayed the **entire** aggregate history from `event_log` — 20–100 MB reads that walked cold S3 partitions. Those reads pinned ClickHouse at its memory ceiling, starved background merges (which OOM'd), stalled `event_log` part merges, tripped `TOO_MANY_PARTS`, and made **every** pipeline's event append fail at once. The refold machinery, and the lossy store that depends on it, were the root cause.

Underneath the incident is a design smell: the cache and the ClickHouse store were treated as two things a projection *assembles*, with knobs — read back or return null, refold or don't, what TTL. **Every knob is a way to get it wrong**, and one projection got it wrong in the way that takes production down.

### The same table was overwhelmed from the *other* side too

`event_log` did not part-buildup from the fold refolds alone. The other heavy contributor was **producer-side**: a hot automation trigger firing tens of thousands of times minted **one tiny `async_insert` into `event_log` per match** (`recordTriggerMatch` has no coalescing — it appends one `TRIGGER_MATCH_RECORDED` event per match). Tens of thousands of individual inserts feed exactly the small-parts explosion that starves merges.

So the outage had one shape from two directions:

- **Read side (folds):** every cache miss / out-of-order event *replays* `event_log` → unbounded reads.
- **Write side (producers):** every item *inserts* into `event_log` → unbounded tiny parts.

The unifying decision of this ADR is therefore not just "fix the store" — it is **take `event_log` off the per-item hot path in both directions**: read-through fold store (reads become one-row state look-ups, never replays) and append coalescing (writes become one insert per batch, never per item). Fixing only one side leaves the part-buildup a re-occurrence away.

## Decision

This ADR has **two pillars** under one principle — *no per-item `event_log` traffic on the hot path*. Pillar 1 is the read side (the fold store); Pillar 2 is the write side (append coalescing).

## Pillar 1 — the read-through fold store

### The principle (substrate-independent)

**A fold projection reads back its own last committed state; it never reconstructs state from `event_log` on the delivery path.** Continuity comes from the projection's own durable store, ordering is a property of the derivation (not of the storage), and idempotency travels with the state. `event_log` is read on the delivery path by nothing — only by the offline replay tool (ADR-015), for projection-version migration and disaster recovery.

This principle already has two implementations, and both are correct:

- **ClickHouse-backed, Redis-cached** — this ADR — for high-volume analytics / aggregate folds (traces, coding-agent sessions, analytics rollups).
- **Postgres, in-row cursor, no Redis cache** — [ADR-049](./049-langy-projection-independent-reactions.md) — for low-volume *operational* folds (Langy conversations, automations, topic-clustering scheduling).

They differ only in tier. What they must never differ on is the principle: **`get()` returns the state; the delivery path never refolds from `event_log`.**

### The ClickHouse implementation

**For ClickHouse-backed folds, state has one storage primitive: a ClickHouse-backed, Redis-cached store, provided by the platform — not assembled per projection.** ClickHouse and Redis are not two stores a fold chooses between or layers by hand; they are one storage solution. ClickHouse is the durable tier, Redis is the read tier. **Caching is part of the storage design, not an optimisation a projection opts into.**

Every ClickHouse-backed fold projection gets the same store with the same contract:

- **`get(aggregate)`** → Redis cache; on miss → a ClickHouse **point read of the latest state row**; on no row → `init()`. It **never returns null for a live aggregate, and it never reads `event_log`.**
- **`apply(state, batch)`** → in-process derivation. Pure; order-tolerant per the fold's *declared* ordering contract.
- **`store(state)`** → **ClickHouse first (throws on failure), then Redis.** A full-state **replace**, keyed by `(TenantId, aggregate)` + a monotonic version (ReplacingMergeTree), latest version wins. **No read-time aggregation.**

Idempotency is a **platform property**, not a per-fold concern: writes are full-state idempotent replaces; the GroupQueue serialises per aggregate (FIFO); redelivery is deduped by the applied-event-id set carried alongside the state (reset on each fresh delivery, so it stays bounded to the in-flight batch).

What the contract removes:

- **`refoldOnStoreMiss` is gone.** There is no store miss that returns null, so there is nothing to refold. A cache miss is a one-row ClickHouse read.
- **`event_log` leaves the projection hot path entirely.** It is read only by the **replay tool** (ADR-015), for deliberate, offline projection-version migration or disaster recovery.
- **Ordering is a property of the derivation, declared by the fold — not a cache knob.** Order-insensitive folds (accumulators, first-seen bounded sets, business-time step insertion) need no reprocessing. Order-dependent folds (state machines) encode monotonic transitions. Neither reaches for `event_log`.
- **A store whose `get()` cannot return the state is not permitted.** The durable row must round-trip the fold's working state (this is ADR-007's "state = stored data"). A projection may *also* expose queryable analytics columns, but those ride alongside a lossless state; they never replace it.

**Why this is "impossible to foul up":** a projection author supplies exactly two things — the derivation, and the state↔row mapping. They do **not** choose a store, a cache, a TTL, or a refold flag. There is one store, and there is no configuration surface on which to repeat the `codingAgentSession` mistake.

## Pillar 2 — producer-side append coalescing

Pillar 1 stops the *reads*. It does nothing for the *writes*, and the writes were the other half of the outage.

**A command that appends one `event_log` event per item, at high fan-in, MUST coalesce its appends into batched inserts** — N items become one `INSERT` of N rows, not N inserts of one row. `event_log` inserts already use `async_insert: 1, wait_for_async_insert: 1`; batching at the producer is what keeps each flush from becoming its own part.

- The trigger of this ADR's incident, `recordTriggerMatch`, appends one `TRIGGER_MATCH_RECORDED` per match with no coalescing (`serializeByAggregate: true` only, no `coalesceMaxBatch`). A hot trigger firing 27k times is 27k inserts. It is both a *victim* of the `event_log` stall (its jobs can't commit) and a *contributor* to it.
- The queue substrate already supports coalescing (`coalesceMaxBatch` / `processBatch` on the GroupQueue — the same mechanism the fold side uses). Producers this hot opt into it; the batched handler stores one multi-row insert per drained batch.
- This is **not** the fold store — a producer has no read-modify-write state to read back. It is the write-side sibling of the same principle: keep `event_log` off the per-item hot path.

Coalescing is applied where fan-in is high, not everywhere — a producer minting one event per human action does not need it. The rule is: **if one aggregate can mint events faster than they drain, its producer coalesces.** Whatever bounds coverage (which producers, what batch cap) is logged, not silent — an un-coalesced high-fan-in producer is a latent part-buildup source.

## Rationale / Trade-offs

- **Read-back is correct for every fold, regardless of order-sensitivity**, because it returns the last *committed* state and only new events fold on top. That is why storage-unification is universal while ordering stays a derivation concern — the two are independent axes, and we stopped conflating them.
- **Read-back is more faithful to the live path than a refold, not less.** Approximate, arrival-order fields (e.g. `previousCallContextTokens`, which drives cache-rebuild detection) are *preserved* across a cache miss; a refold re-derives them in sorted order and silently produces a different value. The refold was never "the correct answer" for these fields — just a different one.
- **The cost we accept:** a cache miss now reads a heavy state row from ClickHouse, so it must obey the heavy-column read discipline in `dev/docs/best_practices/clickhouse-queries.md` (latest-version via `FINAL`/`argMax`, LazilyRead `LIMIT 1`). That is bounded (one row) and rare (warm cache) — versus an unbounded, ever-growing `event_log` history replay.
- **Version bumps still cost a replay** — but that is an explicit, offline ops action (ADR-015), not a per-delivery hot path. We narrowed replay to what it is actually for.

## Caveats — approaches we no longer use, and why

*(Read this section instead of the superseded ADRs. You do not need to reconstruct the history to understand the system.)*

1. **We do not refold projection state from `event_log` on a cache miss.** *(Was: `refoldOnStoreMiss`.)* It replays the aggregate's whole history per miss; on large aggregates that is an unbounded, S3-walking read that starved ClickHouse merges and caused a platform-wide outage (2026-07-23). The store reads its own last committed state instead.
2. **We do not refold on out-of-order delivery.** *(Was: `refoldOnOutOfOrder`, default-on.)* Ordering is handled in the derivation, not by replaying history — a no-op for order-insensitive folds, and encoded in transitions for order-dependent ones.
3. **We do not allow a projection store whose `get()` returns null or cannot reconstruct its state.** *(Was: `codingAgentSession`'s lossy analytics row.)* It is exactly what forced (1) and (2). The durable row must round-trip the fold state; analytics columns are additive.
4. **We do not aggregate projection state at read time in ClickHouse.** *(No `SummingMergeTree`/`AggregatingMergeTree` merging partial rows.)* The fold owns all aggregation in-process; ClickHouse stores the complete state, latest-version-wins. Read-time aggregation would return a merged partial that is **not** the fold's state, which breaks read-back.
5. **Caching is neither optional nor a speed feature.** *(Was: `RedisCachedFoldStore` as a wrap-if-you-want accelerator with a TTL knob tuned to avoid catastrophe.)* Redis is the read tier of one storage solution. Because read-back works, a cache miss is cheap, so the TTL is a latency knob — never a correctness or cost lever.
6. **We do not carry heavy content in fold state or its cache.** Heavy IO lives in `event_log`; projections carry previews + refs. This is a *separate axis* owned by [ADR-022](./022-event-log-source-of-truth.md) — cross-linked here, not restated.

## Consequences

- **The outage class is closed structurally.** Projection refolds can no longer materialise unbounded `event_log` history, so they can neither drive `event_log` part-buildup nor OOM a worker. Cache misses are O(one row).
- **Fewer ways to be wrong.** One primitive, no per-projection store wiring, no refold flags. The failure mode that took production down has no configuration surface to recur on.
- **State rows get heavier.** They now carry the full working state (including fields previously "bookkeeping only, not projected to the row"), and the miss-path read must respect ClickHouse heavy-column discipline. Bounded and worth it.
- **Migrations for existing lossy projections.** `codingAgentSession` is the first adopter: give `coding_agent_sessions` a lossless state representation, make `get()` read it back, delete its refold reliance, and declare it order-insensitive.
- **Replay (ADR-015) is unchanged in mechanism but narrowed in role** — projection-version migration and disaster recovery only, never the delivery path.

## Scope — the two workloads that motivated this

The principle is general; these are the components it lands on. Note that only the *fold* takes Pillar 1, and only the *high-fan-in producer* takes Pillar 2 — most components take neither.

**Coding-agent pipeline** — one fold, several producers/maps:

| Component | Kind | Lever |
|---|---|---|
| `codingAgentSession` fold | CH fold, lossy row, refolds `event_log` | **Pillar 1 adopter #1** — the component on fire |
| `codingAgentTraceSessions`, `sessionMetricSeries` | map projections (append-only) | None — append stores, not read-modify-write; leave as-is |
| `codingAgentSpanFactsDispatch` (+ log / metric) subscribers | event producers | None from this ADR — but move the coding-agent-name gate **before enqueue** so non-agent spans never mint jobs |
| `contributeSpanFacts` command | producer | None |

Independently of the store: fix the **session = traceId fallback** so one large trace does not become one unbounded aggregate (the amplifier behind the refold cost).

**Trigger-matched workload** (the 27k-pending group):

| Component | Kind | Lever |
|---|---|---|
| `recordTriggerMatch` command | producer — one `TRIGGER_MATCH_RECORDED` per match, no coalescing | **Pillar 2 adopter #1** — append coalescing |
| `triggerSettlement` | ADR-052 process manager, Postgres outbox state | None — evolves state incrementally from a PM store, never refolds `event_log`; its backlog is pure `event_log`-stall *symptom*, not a cause |

## Adopters & sequencing

1. **Now (relief):** `refoldOnOutOfOrder: false` on `codingAgentSession` — safe today (order-insensitive derivation), stops the replay storm. Small standalone PR.
2. **Pillar 1, first adopter:** `codingAgentSession` → lossless read-back store (kills `refoldOnStoreMiss` on the hot path). Then roll the same pattern to any other lossy-row fold.
3. **Pillar 2, first adopter:** append coalescing for `recordTriggerMatch`; audit other high-fan-in `event_log` producers and coalesce them.
4. **Durable dedup watermark** in fold state — closes the cold idempotency hole so "throw-and-retry" is truly idempotent even across cache loss (the applied-event-id set is cache-only today).

## Server-side ClickHouse settings (defense-in-depth)

Pillars 1 and 2 take `event_log` off the per-item hot path in the application. The ClickHouse server config is the complementary layer, and one knob on the prod `event_log` cluster was left un-tuned for part reduction:

- **Flush window.** `async_insert_busy_timeout_ms` decides how many buffered inserts coalesce into one part. Prod ran at **200ms** (ClickHouse's default), which batches almost nothing under a burst — so a spike of tiny inserts (per-span coding-agent, per-match trigger) became a flood of tiny parts. Raise it to **1000ms** (the value the repo's own `clickhouse-serverless` config already uses). `async_insert_max_data_size` (10 MB) still flushes early under heavy load, so peak-load throughput is unaffected; the win lands in the medium-burst regime that caused the outage. Prod config: `langwatch-saas/infrastructure/clickhouse.tf`.
- **Keep `async_insert_wait = 1`.** Durability plus protective backpressure. `wait = 0` on a source-of-truth log would ack a job before its event is durable (data loss) and remove the safety valve — never do it.
- **The real merge-OOM fix is memory headroom, not async batching.** The 2026-07-23 cascade was background merges failing with `MEMORY_LIMIT_EXCEEDED` against the server memory cap; async tuning only reduces the *rate* parts are created, it does not let a starved merge complete. Server memory (`max_server_memory_usage` / pod memory) and merge sizing (`max_bytes_to_merge_at_max_space_in_pool`, vertical merge) are the levers there, and they live in infra, not this repo.

Recorded here so the application-side and server-side levers are visible together; the server values themselves are owned by infra.

## Rules

- Every ClickHouse-backed fold projection uses the platform ClickHouse-cached store. No projection wires its own store or cache. (Operational folds use the Postgres cursor store of ADR-049 — same read-back principle, different tier.)
- No fold projection, on any substrate, reads `event_log` on the delivery path. `event_log` is for the offline replay tool only.
- `store.get()` MUST be able to return the full working state. A store that returns null for a *live* aggregate is a bug, not a design choice.
- The durable state row MUST round-trip the fold's working state (ADR-007). Analytics/query columns are additive to that, never a substitute.
- Projection state tables are ReplacingMergeTree keyed by `(TenantId, aggregate)` + a monotonic version; reads select the latest version (`FINAL`/`argMax`) with LazilyRead `LIMIT 1` discipline.
- `store()` writes ClickHouse first (throws on failure), then Redis. A cache-write failure is logged, never thrown — ClickHouse already holds the durable state.
- Folds declare their ordering contract. `event_log` is never read on the delivery path — only by the replay tool, for version migration or recovery.
- Redelivery dedup travels with the state (applied-event-id set, reset on each fresh delivery, bounded to the in-flight batch).
- **High-fan-in `event_log` producers coalesce their appends** — a batched multi-row insert per drained batch, not one insert per item. A producer where a single aggregate can mint events faster than they drain, and does not coalesce, is a part-buildup regression. Any cap on coalescing coverage is logged, not silent.

## References

- **Behavioural contract:** [specs/event-sourcing/fold-read-back-store.feature](../../../specs/event-sourcing/fold-read-back-store.feature) (pillar 1), [specs/event-sourcing/producer-append-coalescing.feature](../../../specs/event-sourcing/producer-append-coalescing.feature) (pillar 2)
- [ADR-007](./007-event-sourcing-architecture.md) — event-sourcing architecture (this ADR hardens its storage model)
- [ADR-015](./015-projection-replay-coordination.md) — replay coordination (narrowed to off-hot-path)
- [ADR-021](./021-lean-fold-cache.md) — lean fold cache (fold-cache mechanics superseded here)
- [ADR-022](./022-event-log-source-of-truth.md) — event_log as source of truth (heavy-content axis)
- [ADR-034](./034-event-sourced-analytics-materialization.md) — analytics materialisation (its `refoldOnStoreMiss` continuity mechanism amended here)
- [ADR-049](./049-langy-projection-independent-reactions.md) — Postgres operational-projection store (sibling implementation of the read-back principle)
- [ADR-055](./055-canonical-otlp-metric-and-log-pipelines.md) — map-vs-fold projection choice
- [ADR-056](./056-coding-agent-pipeline-session-aggregate.md) — coding-agent session aggregate (store corrected here)
