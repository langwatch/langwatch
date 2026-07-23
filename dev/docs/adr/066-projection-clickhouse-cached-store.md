# ADR-066: Projection state storage — the ClickHouse-cached store

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

## Decision

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

## Rules

- Every ClickHouse-backed fold projection uses the platform ClickHouse-cached store. No projection wires its own store or cache. (Operational folds use the Postgres cursor store of ADR-049 — same read-back principle, different tier.)
- No fold projection, on any substrate, reads `event_log` on the delivery path. `event_log` is for the offline replay tool only.
- `store.get()` MUST be able to return the full working state. A store that returns null for a *live* aggregate is a bug, not a design choice.
- The durable state row MUST round-trip the fold's working state (ADR-007). Analytics/query columns are additive to that, never a substitute.
- Projection state tables are ReplacingMergeTree keyed by `(TenantId, aggregate)` + a monotonic version; reads select the latest version (`FINAL`/`argMax`) with LazilyRead `LIMIT 1` discipline.
- `store()` writes ClickHouse first (throws on failure), then Redis. A cache-write failure is logged, never thrown — ClickHouse already holds the durable state.
- Folds declare their ordering contract. `event_log` is never read on the delivery path — only by the replay tool, for version migration or recovery.
- Redelivery dedup travels with the state (applied-event-id set, reset on each fresh delivery, bounded to the in-flight batch).

## References

- [ADR-007](./007-event-sourcing-architecture.md) — event-sourcing architecture (this ADR hardens its storage model)
- [ADR-015](./015-projection-replay-coordination.md) — replay coordination (narrowed to off-hot-path)
- [ADR-021](./021-lean-fold-cache.md) — lean fold cache (fold-cache mechanics superseded here)
- [ADR-022](./022-event-log-source-of-truth.md) — event_log as source of truth (heavy-content axis)
- [ADR-034](./034-event-sourced-analytics-materialization.md) — analytics materialisation (its `refoldOnStoreMiss` continuity mechanism amended here)
- [ADR-049](./049-langy-projection-independent-reactions.md) — Postgres operational-projection store (sibling implementation of the read-back principle)
- [ADR-055](./055-canonical-otlp-metric-and-log-pipelines.md) — map-vs-fold projection choice
- [ADR-056](./056-coding-agent-pipeline-session-aggregate.md) — coding-agent session aggregate (store corrected here)
