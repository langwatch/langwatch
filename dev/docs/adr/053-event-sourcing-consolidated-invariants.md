# ADR-053: Consolidated event-sourcing invariants

**Date:** 2026-07-18

**Status:** Draft

**Supersedes / retires:** see [Disposition of prior ADRs](#disposition-of-prior-adrs). This ADR is the single normative statement for the event-sourcing subsystem. Where it conflicts with an earlier ADR, this one wins.

---

## Context

Sixteen event-sourcing ADRs have accumulated over five months. They contradict each other, and the contradictions are load-bearing rather than cosmetic.

- **ADR-007, the document every other ADR cites as the foundation, is substantially false.** It describes fold projections on "a GroupQueue (BullMQ + Redis)" and map projections on "a SimpleQueue (BullMQ)". There are zero `bullmq` imports under `event-sourcing/` and no `SimpleQueue` module. It states "fold state = stored data" and "the fold state serves as both data store and checkpoint", but two folds return `null` from `get()` unconditionally (`pipelines/shared/analyticsStoreBase.ts:153-158`, `traceAnalytics.store.ts:99-104`). It states "reactors only fire on success", which ADR-039's heartbeat contradicts by dispatching with no triggering event. Its status still reads `Accepted`, with no amendment block.
- **"Source of truth" is asserted four times with four referents** — fold state (`007:37,65`), `event_log` (`022:24,140`), the GroupQueue and the PG audit row (`030b:38`).
- **Numbering collisions force ad-hoc disambiguation.** Two ADR-022s both govern ClickHouse durability of trace data; `040-durable-stored-object-offload:7` cites both in one sentence and invents a naming scheme to tell them apart. Three ADR-026s, two in this subsystem, same date, same status. Two ADR-030s, both event-sourcing.
- **Two `Proposed` ADRs (029, 030a) are fully shipped**, and `029:7` supersedes an `Accepted` ADR's Decision section while itself remaining `Proposed`.
- **Idempotence is required by nobody and assumed by everybody.** ADR-007 mandates determinism (`apply(s,e) == apply(s,e)`), never idempotence (`apply(apply(s,e),e) == apply(s,e)`). ADR-034 cites ADR-021 for "folds idempotent under replay" — a claim ADR-021 does not make. That single mis-citation is the origin of the assumption the rest of the corpus builds on.

### The live defect

Four of seven fold projections can silently corrupt state on an ordinary queue retry.

| Fold | Non-idempotent handlers | Exposure |
|---|---|---|
| `traceSummary` | `traceSummary.foldProjection.ts:214,373,423,566`; `span-cost.service.ts:253-259`; `trace-attribute-accumulation.service.ts:341` | double-count on warm retry; under-count on cold |
| `traceAnalytics` | `traceAnalytics.foldProjection.ts:555,675,719,801,444-452` | double-count on warm retry |
| `experimentRunState` | `experimentRunState.foldProjection.ts:184,186,189-191,194-197,227-232,275` | double-count on warm retry |
| `suiteRunState` | `suiteRunState.foldProjection.ts:121,140,142,147,149` | double-count; propagates into `PassRateBps` and the `allDone` terminal-status trigger |

Mechanism, identical in all four: ClickHouse insert lands (`redisCachedFoldStore.ts:124`) → Redis `SET` lands (`:130`) → a reactor throws (`projectionRouter.ts:1134-1139`) → the job is never acked (`groupQueue.ts:1002,1011`) → the retry re-dispatches → `store.get()` hits the warm cache holding already-applied state (`:101-106`) → the same events apply again. Nothing invalidates the cache; nothing deduplicates.

Aggravators: five of seven live writes use `wait_for_async_insert: 0`, so the correctness argument at `redisCachedFoldStore.ts:60-63` ("CH fails → throw → event retried by queue") has never held — that comment and the setting landed in the same commit. And re-staged siblings do not carry `__attempt` (`groupQueue.ts:1324`), so the 25-attempt budget resets when a sibling leads a batch.

### What has already been tried, and why it failed

This matters more than any argument from first principles. The obvious fixes are not available, because they were shipped and reverted.

| PR | Change | Outcome |
|---|---|---|
| #2728 (`d2203b4364`) | `insert_quorum=auto`, async_insert disabled, for the `simulation_runs` fold — to fix replication-lag stale reads | Superseded by the Redis cache |
| #2751 (`6b3d058f32`) | Redis write-through cache; `wait_for_async_insert` 1→0 | **"Per fold step: ~200ms → ~1.5ms (133x faster). Per 6-span trace: ~1.2s → ~9ms."** Also removed `CLICKHOUSE_PRIMARY_REPLICA_URL` routing, because Redis now supplied read-after-write |
| #2899 (`9ab3f263bb`) | Removed `select_sequential_consistency` from reads | It caused **"10-14s read latency on cache misses in the fold projection path"** |

So `wait_for_async_insert=1`, `insert_quorum`, and `select_sequential_consistency` are all measured-bad and stay rejected. The single survivor is `wait_for_async_insert=1` on `experiment_runs`, kept deliberately for the `getGroupKey` parallel-results race (`a7b9ac631f`).

Coalescing (`DEFAULT_FOLD_COALESCE_MAX_BATCH = 500`, `projectionRouter.ts:59`; one `store.store()` per batch at `foldProjectionExecutor.ts:275`) changes the arithmetic but does not rehabilitate `wait_for_async_insert=1`, because **batch fill is per-aggregate**: `drainGroupReady` drains within one `groupId`. High-span traces fill batches; a firehose of 3-span traces fills nothing and lands back on a flush wait per trace.

### The trilemma this ADR dissolves

Because the durable row is not guaranteed fresh, a cache miss offers any two of three properties:

- **refold from the event log** — correct and fresh, but O(all events). At 25–40k spans per trace this is tens of thousands of reads and re-applies on the hot path, recurring for the life of the trace. Untenable.
- **read the durable row as-is** — cheap, but a stale row silently loses accumulated counts.
- **quorum + sequential consistency** — correct and fresh, but measured at 10-14s (#2899).

Every prior attempt picked a corner and patched around the cost. The escape is not to choose better, but to remove the premise: *make a cache miss mean something it does not mean today.*

---

## Decision

**The fold cache entry is evicted when ClickHouse is confirmed to hold the state — not when a timer expires.**

Today a TTL removes the entry on a schedule unrelated to durability, so a miss carries no information: the row might be present, might be inside the ~200ms `async_insert` flush window, might be lossy. Under this decision the only thing that removes a cache entry is confirmation that the durable tier has the state.

**Therefore a cache miss is a proof that ClickHouse holds the state, and reading the durable row on a miss is correct by construction.**

Everything else falls out. No `wait_for_async_insert=1`. No `insert_quorum`. No `select_sequential_consistency`. No refold on the steady-state path. No checkpoint column, and no per-aggregate sequence number — which is fortunate, because none exists for traces, analytics, or logs: their events carry a KSUID `id` and an `occurredAt`, both creation-ordered rather than per-aggregate, and both defeated by late delivery.

### The confirmation processor

**Registration.** On `store()`, alongside the Redis `SET`, the fold `ZADD`s the aggregate id into a pending-confirmation sorted set scored `now + checkDelay`. One extra Redis op on a path already performing a SET.

**Draining.** A processor takes due entries via `ZRANGEBYSCORE`, groups them by tenant, and issues one batched query per group.

**The check MUST establish the row is on every replica, not on whichever replica answered.** Reads are load-balanced across replicas behind an NLB, so confirming against one node and deleting the cache would let a later read land on a laggard and see stale or absent state — exactly the loss the cache exists to prevent. Confirmation takes the **laggard's** position, not the leader's:

```sql
SELECT TraceId, min(mx) AS slowest, uniqExact(host) AS replicas_seen FROM (
  SELECT TraceId, hostName() AS host, max(UpdatedAt) AS mx
  FROM clusterAllReplicas({cluster}, {db}.trace_summaries)
  WHERE TenantId = {tenantId:String} AND TraceId IN ({ids:Array(String)})
  GROUP BY TraceId, host
) GROUP BY TraceId
```

Confirmed requires **both** `slowest >= cached.UpdatedAt` **and** `replicas_seen` equal to the expected replica count — a replica missing the row entirely contributes no group, so the count guard is what distinguishes "all replicas have it" from "the replicas that answered have it". Confirmed → `DEL` the cache key and `ZREM` the entry. Unconfirmed → re-score with backoff. One query per batch, never per aggregate.

Where `CLICKHOUSE_CLUSTER` is unset the table is unreplicated and the check is trivially satisfied by a plain `max(UpdatedAt)`.

`UpdatedAt` is reused deliberately: it already exists on every fold row and is already the `ReplacingMergeTree` dedup key, so no new column and no version bump.

The ADR-039 outbox heartbeat is a periodic, Redis-locked, worker-only scheduler and is the natural host.

**`checkDelay`** must clear the `async_insert` flush window (~200ms) comfortably so the first check usually succeeds. A few seconds suffices and keeps re-checks rare.

**Hot aggregates need no special handling.** A trace still folding re-`ZADD`s on every write, updating its score and pushing the check out. Active aggregates are never considered, and the key survives exactly as long as it is needed — the opposite of today's behaviour, where a 300s TTL evicts mid-flight on precisely the longest traces.

### Failure modes are all conservative

| Failure | Effect |
|---|---|
| Read hits a stale replica, under-reporting `max(UpdatedAt)` | key retained |
| Processor down | keys retained |
| ClickHouse slow or lagging | keys retained |
| Backstop TTL fires | degrades to today's behaviour, and is instrumented |

Every path fails toward *keep the cache*, which is the safe direction. The one unsafe path is Redis evicting these keys under memory pressure before confirmation, which reintroduces today's hole — so `maxmemory-policy` becomes load-bearing and must not evict them.

### Memory

The working set **shrinks**. Redis holds one state per aggregate either way; today it is retained for 300s after the last write, whereas confirmation removes it seconds after. The retained set under this decision is a strict subset of the retained set today. The backstop TTL therefore stops being a working-set parameter and becomes purely a leak guard, so it can be generous. The only new memory is the pending-confirmation sorted set — ids and scores.

### The retry hole, and its closure

If the processor confirms and deletes between a fold's durable write and a **retry** of that fold, the retry reads already-applied state from ClickHouse and double-counts. Retry backoff runs to 600s (`queues/shared.ts:17-21`), so this is not hypothetical.

**Closure: the processor skips aggregates with in-flight queue jobs.** The GroupQueue already tracks active, staged and blocked groups; the processor consults that and leaves those keys alone. No new lifecycle state.

Rejected alternative: shrink the entry to a marker carrying only the applied-event-ids on a TTL exceeding max retry backoff. It works and costs a few hundred bytes per recently-confirmed aggregate, but it introduces a second entry shape for a case the liveness check already covers.

Independently, `__attempt` must survive sibling restaging (`groupQueue.ts:1318-1325`) so the 25-attempt budget cannot reset. That is a retry-accounting bug on its own merits.

### What stays refold-only

`traceAnalytics` and `evaluationAnalytics` have no durable row to read: ADR-034 made those rows deliberately lossy and their `get()` returns `null` unconditionally. Durability-gated eviction does not help them, because there is nothing to confirm against and nothing to read back.

They keep `refoldOnStoreMiss: true`, which is their behaviour today — so this ADR neither improves nor worsens them. **ADR-034's lossy-row decision is the root cause and is the named follow-up**; it is out of scope here because it is a projection redesign with its own replay implications.

---

## Invariants

1. **`event_log` is the sole durable source of truth.** Every other store — ClickHouse projection tables, the fold cache, the PG outbox audit projection, queue payload blobs — is derived and may be discarded and rebuilt. Where a component must hold state that cannot be reconstructed (a dispatch that reached a customer), it is an *anchor*, not a projection, and must be named as one. Replaces the four competing claims in `007:37,65`, `022:24,140`, `030b:38`.

2. **A fold cache entry is evicted only on confirmed durability.** A cache miss therefore proves the durable tier holds the state, and reading it is correct. Time-based expiry survives solely as a leak backstop.

3. **`apply` MUST be idempotent per `(aggregate, event id)` where redelivery can reach it.** Determinism is not sufficient and never was. Under invariant 2 the steady-state paths are closed structurally; the applied-event-id set in the cache entry closes redelivery against a live entry, and the processor's liveness check closes it against a confirmed-and-deleted one.

   The set **accumulates** across fold steps rather than holding only the last write. A retry chain is why: retry 1 skips the redelivered batch and applies whatever arrived alongside it, so an entry holding only that write would fail to recognise the original batch when retry 2 redelivers the whole set.

   **A single watermark would be cheaper and does not work here.** `occurredAt` is not monotonic per aggregate — folds carrying `refoldOnOutOfOrder: false` (`traceSummary.foldProjection.ts:298`, `traceAnalytics.foldProjection.ts:626`) legitimately apply late-arriving older events, so skip-if-older drops real data. Event ids are KSUIDs, ordered by creation rather than delivery, with the same defect. `event_log.CreatedAt` is stamped per insert across concurrent pods, so clock skew and interleaved writes leave it short of a total order too.

   **The watermark becomes available if consumption becomes log-ordered.** A fold that consumed the log in log order could carry one position instead of a set, and the memory question would disappear. That is not the current architecture — the queue dispatches by its own score and restaged siblings re-enter at their original scores, so delivery order and log order are unrelated — and moving to it means a log-tailing consumer rather than push-on-write, which would also retire `refoldOnOutOfOrder`. Recorded as the direction that supersedes this invariant, not as work in scope.

4. **Refold from the event log is the exception path, not the miss path.** If it fires in steady state, that is a defect. The two analytics folds are the known exception, pending the ADR-034 follow-up.

5. **Replication consistency is established asynchronously, off the write path.** `wait_for_async_insert=1`, `insert_quorum` and `select_sequential_consistency` stay out of the fold write path — measured-bad in #2751 and #2899, and re-proposing any of them requires new measurement rather than new argument (the `experiment_runs` exception is deliberate and documented). The *same guarantee* is instead obtained by the confirmation processor, which must establish that every replica holds the row before the cache entry is released. This is the identical consistency property moved to where it is free: the fold never waits, and a slow or lagging replica merely retains a cache entry.

6. **Reactors are at-least-once and MUST be idempotent.** `007:98` ("reactors only fire on success") is retired: ADR-039's heartbeat dispatches with no triggering fold, and reactor failure re-runs a batch whose rows are already committed. Reactor idempotency remains the outbox's job (ADR-030b).

7. **Map-projection dedup is the same mechanism as fold dedup**, not a special case. `bulkAppend` makes the *persist* step atomic, not the whole job — reactor dispatch runs after the append commits (`projectionRouter.ts:670-680`). The claim at `mapProjection.types.ts:87-88` that folds are "immune (read-time dedup collapses the duplicates before re-folding)" is false and is deleted.

8. **One offload mechanism, keyed on size.** ADR-029 stated this and the count has since gone from three to six. No new offload path without retiring one. Size boundaries live in exactly one place in code; ADRs cite the constant rather than restating a number (the corpus currently states the IO preview as both 32 KB and 64 KB, and the inline ceiling as both 32 KiB and 4 KiB).

9. **Blob lifetime has one owner and one backstop TTL constant.** Every other component may extend a lifetime, never end one. Reclamation by omission — relying on a bucket lifecycle rule that does not cover the key prefix in use — is rejected, because it leaves customer trace data permanently orphaned. `030a:34` already mandates a single constant; `blobConstants.ts` has three.

10. **No ADR in this subsystem may remain `Proposed` while its decision is shipped.**

---

## Observability

The design rests on assumptions that are currently unmeasured. These metrics are part of the change, not a follow-up.

**The unknowns that would falsify the design**

- `es_fold_cache_miss_total{projection, cause}` — `confirmed` / `backstop_ttl` / `redis_error` / `unknown`. Under invariant 2, `confirmed` should dominate. Anything else appearing at volume means eviction is not durability-gated in practice.
- `es_fold_confirmation_lag_seconds` — write to confirmed-delete. Sizes `checkDelay` and exposes ClickHouse lag directly.
- `es_fold_coalesce_batch_size` histogram, by projection — whether batches fill to 500 or to 3. Currently unmeasured, and it is why the `wait_for_async_insert` argument has gone in circles.
- `es_fold_events_per_aggregate` histogram — makes the 25–40k-span traces visible rather than anecdotal.

**The processor**

- `es_fold_confirmation_pending` gauge — depth of the sorted set. Sustained growth means confirmation is not keeping up.
- `es_fold_confirmation_checks_total{result}` — `confirmed` / `not_yet` / `error`.
- `es_fold_confirmation_query_duration_seconds` and batch-size histogram.
- `es_fold_confirmation_skipped_inflight_total` — how often the liveness check saves a retry. Quantifies the retry hole.
- `es_fold_confirmation_replica_lag_seconds` — spread between the leading and lagging replica at check time. This is the number that was previously invisible and that `select_sequential_consistency` was paying 10-14s to paper over.
- `es_fold_confirmation_replicas_missing_total` — checks where fewer replicas answered than expected. Distinguishes replication lag from a node that is down or removed.

**The exception path**

- `es_fold_refold_total{projection, reason}`, `es_fold_refold_events` histogram, `es_fold_refold_duration_seconds`. Should be near-zero outside the two analytics folds; alert if not.

**Correctness proof**

- `es_fold_duplicate_events_skipped_total{projection}` — events the applied-set caught. Non-zero proves redelivery is real and the mechanism works; flat zero over a long window means it was built for nothing.

**The write path**

- `es_fold_store_duration_seconds{projection, tier}`, split Redis vs ClickHouse.
- `es_fold_cache_entry_bytes` histogram — at 40k spans the full-state GET/SET round-trip is its own O(N²) cost and is currently invisible.

PR #5909 already adds `es_fold_store_miss_refold_total` and `_events`; that work carries over.

---

## Consequences

- The `RedisCachedFoldStore` correctness comment (`:60-63`) is deleted rather than repaired. Correctness no longer rests on CH-then-Redis write ordering.
- PR #5908's both-or-neither dilemma disappears. It exists to choose between swallowing a `SET` failure and `DEL`-and-throw; under this decision neither horn is load-bearing, and the long comment explaining which poison was chosen goes away.
- No ClickHouse schema change, no projection version bump, no replay.
- Redis working set shrinks; `maxmemory-policy` becomes load-bearing for these keys.
- A new processor to own, run on the ADR-039 heartbeat.
- `traceAnalytics` and `evaluationAnalytics` are unchanged and remain the known weak point until ADR-034's lossy-row decision is revisited.

## Open questions

1. **Backstop TTL value.** Purely a leak guard now, so it can be hours. Wants a number and a rationale recorded in code, not in prose.
2. **Where the liveness check reads from.** The GroupQueue's active/staged/blocked sets are internal; this needs a narrow query surface rather than the processor reaching into queue internals.
3. **Sizing `checkDelay`** against measured `es_fold_confirmation_lag_seconds` once instrumented.
4. **Whether `evaluationRun` should be cached at all.** It is the only uncached fold (`pipelineRegistry.ts:394-396`), is fully idempotent, and uses `wait_for_async_insert: 1`. It may simply not need this machinery.
5. **How the expected replica count is determined.** Reading it from `system.clusters` per check is wasteful and racy during a rolling restart; pinning it to config drifts. A replica genuinely removed from the cluster must not strand every cache entry forever — the backstop TTL bounds that, but the behaviour should be deliberate rather than incidental.
6. **Cost of `clusterAllReplicas` at batch scale.** It fans out to every node per query. Batched and keyed on the primary key it should be cheap, but it is a fan-out on a periodic job and wants measuring before the batch size is chosen.

## Disposition of prior ADRs

No ADR in this subsystem may remain `Proposed` while shipped.

| ADR | Current | Disposition |
|---|---|---|
| 002-event-sourcing | Superseded | Keep as history. Its rule 4 ("projections are derived") is restated as invariant 1 — ADR-007 dropped it without retiring it. |
| **007-event-sourcing-architecture** | **Accepted** | **Superseded by this ADR.** Banner required. Four normative claims describe a deleted queue substrate; three more are contradicted by 021/022/034. Most-cited and least-accurate document in the corpus. Its "Decision — No Checkpoints" is retained, since this ADR reaches correctness without checkpoints. |
| 015-projection-replay-coordination | Accepted | Keep. Amend to record that rollup replay needs a truncate step (`034:34`) absent from its 7-phase protocol. |
| 021-lean-fold-cache | **Proposed** | **Retire.** Already carries a superseded banner; its mechanism (`toCacheable`, `blobref`, permanent S3, 32 KB) is dead in code. Stop citing it as normative — `034:114` does. |
| 022-event-log-source-of-truth | **Proposed** | **Promote to Accepted and renumber.** Shipped, load-bearing, cited as authority by five documents, colliding with `022-data-retention` over the same data. |
| 023 / 025 orphan sweep | Superseded / Accepted | Clean. |
| 026-groupqueue-payload-envelope | Accepted | **Renumber.** Mark its §"Blob lifecycle" superseded by 029 rather than leaving it reading as live. |
| 026-reactor-should-react-predicate | Accepted | **Renumber.** Drop `:133-137`, which extends a `toCacheable` invariant to `shouldReact` and `handle` — a larger set than ADR-021 ever mandated, and moot once `toCacheable` is gone. |
| 027-typed-dispatcherror-contract | Accepted | Clean. |
| 029-groupqueue-content-addressed-payload-store | **Proposed** | **Promote to Accepted.** Shipped. Reconcile its reinstatement of project-prefix scoping against `022:129`, which declared it structurally unnecessary. |
| 030-groupqueue-blob-handling-hardening | **Proposed** | **Promote and renumber.** Shipped. Reconcile TTL figures against `blobConstants.ts`. |
| 030-transactional-outbox | Accepted | **Renumber.** Strip the stale "Original design (pre-ADR-035)" block at `:207` reading as a second live decision, and the Phase-0 retention instruction at `:162,248` for deleted code. |
| 034-event-sourced-analytics-materialization | Accepted | Amend: its idempotency citation at `:12,114` attributes to ADR-021 a rule ADR-021 does not contain. **Its lossy-row decision is the named follow-up to this ADR.** |
| 035 / 039 | Accepted | Clean. |

**Numbering.** Renumber the later member of each colliding pair. The 022 collision is urgent — both govern ClickHouse durability of trace data, and downstream ADRs already resort to path-qualified links to disambiguate.
