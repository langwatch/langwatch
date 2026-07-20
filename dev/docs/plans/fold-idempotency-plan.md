# Fold projection idempotency — constraints and plan

**Branch:** `feat/event-sourcing-consolidation`, rebased on `origin/feat/automations-process-manager` (PR #5911, ADR-052 process-manager substrate).
**Status:** plan agreed; execution not started beyond what is listed under "Already committed".
**Written:** 2026-07-18. Supersedes the durability-gated design in `dev/docs/adr/056-event-sourcing-consolidated-invariants.md` — see §3.

---

## 1. The actual problem

Four of seven fold projections have non-idempotent `apply` handlers. Queue delivery is at-least-once, so a job that fails **after** its state was stored is redelivered and the same events are applied twice.

Affected: `traceSummary`, `traceAnalytics`, `experimentRunState`, `suiteRunState`.
Not affected: `evaluationRun`, `evaluationAnalytics`, `simulationRunState` (all idempotent by construction).

### How the failure window actually opens

The store write happens inside `executeBatch`; the ack is `groupQueue.ts:1044`. Everything between throws into redelivery:

- `projectionRouter.ts:1570-1581` — reactor queue `send()` threw. **Dominant path**: it is a Redis write plus, past the inline ceiling, a blob-store write.
- `projectionRouter.ts:1593-1630`, `:1635-1668` — inline reactor `handle()` threw. The log at `:1666` already says "fold state persisted in CH but reactor side-effect was lost".
- `groupQueue.ts:1044` — the ack itself failed.
- `groupQueue.ts:1045-1051` — blob release threw **after `complete()` already succeeded**, so the catch re-stages a job whose slot was completed. Separate double-delivery bug.

**Amplification.** `groupQueue.ts:1082-1085` claims "the batch stores its fold state only once, at the very end, so a failure means nothing was persisted for the drained siblings." **This comment is false for every throw site above.** The catch then re-stages up to 499 drained siblings (`:1086-1088`) whose events were already folded in. One reactor-send failure on a hot trace redelivers the entire coalesced batch.

---

## 2. Constraints established (verified in code)

### Topology
- ClickHouse is **one shard, N replicas — never sharded** (`charts/clickhouse-serverless/templates/statefulset.yaml:114-115` hardcodes `CH_SHARD: "shard_01"`).
- Chart **default is `replicas: 1`**, i.e. non-replicated standalone `ReplacingMergeTree` (`charts/langwatch/values.yaml:1498-1499`). `CLICKHOUSE_CLUSTER` is only set when `replicas > 1` (`_helpers.tpl:505-508`).
- **UNKNOWN — needs production data:** what the SaaS actually runs. No IaC in this repo.

### Redis
- **One instance, one DB, shared by queues, sessions, rate limiting, TTL cache and the fold cache.** No cache/queue separation exists (`src/server/redis.ts:71,88`).
- `maxmemory-policy` is **inconsistent across the three shipping configurations**: helm `noeviction` (`charts/langwatch/templates/redis/statefulset.yaml:44,46`), npx installer **`allkeys-lru`** (`packages/server/src/services/redis.ts:67`), compose unset.
- **Nothing asserts it at boot.** `assertRedisReady()` only pings.

### Measurability
- **The bug is sizeable in production today**: `gq_jobs_retried_total` (`groupQueue/metrics.ts:95`) on the fold queue, cross-referenced with `es_reactor_total{status="failed"}` (`metrics.ts:494`). Caveat: the dominant throw site (`projectionRouter.ts:1570`) increments neither — it shows only as a retry bump plus a log line.
- **Spans-per-trace is queryable today**: quantiles over `trace_summaries.SpanCount`, which keeps counting past the cap.
- **Batch fill is NOT measurable.** No metric anywhere carries batch size. `queue.coalesced_batch_size` is an OTel attribute set only when siblings were drained, so a batch of 1 is indistinguishable from no coalescing. Real gap.

### Decomposition blast radius
- **`suiteRunState` has essentially zero read consumers.** Its entire read surface (`suite-run.service.ts:180-193`) is called only by its own tests; the router computes pass/fail from `simulations.runs.getInternalSuiteSummaries` and the UI recomputes client-side.
- **`experimentRunState`: only `Progress` and `Total` are ever read out** (`mappers.ts:147-166`). `CompletedCount`, `FailedCount`, `TotalCost`, `TotalDurationMs`, `TotalScoreSum`, `ScoreCount`, `PassedCount`, `GradedCount`, `AvgScoreBps`, `PassRateBps` are `SELECT *`'d and dropped. Pass-rate/avg-score in the UI come from a separate `experiment_run_items` query.
- The cost is concentrated in `traceSummary`/`traceAnalytics`, and within those in `spanCount` and `totalCost`.

### Two hard blockers on the "make it read-time" idea
- **`spanCount` cannot become a read-time `count()`.** It is a **monotonic fold watermark** used as a cache-invalidation memo key (`trace-read-derivation.service.ts:34,113`, fed from `confirmSettledMatch.ts:57,78` and `computeRunMetrics.command.ts:128`). A non-monotonic value serves stale derived events. The past-cap increments (`traceSummary.foldProjection.ts:373`) exist precisely to preserve monotonicity. It is also the exact-equality latch at `evaluationTrigger.reactor.ts:95`.
- **ADR-034's rollup is itself non-idempotent by design** — it explicitly accepts double-counting on retry as negligible (`034:34,95`). Moving sums there trades one accumulation problem for another. Only the eval rollup has `dedupeByIdempotencyKey`.

### Precedent that this migration works
`traceSummary.foldProjection.ts:350-357` records that `events`, `spanCosts` and `scenarioRoleCosts/Latencies` were **already** moved out of fold state to read-time derivation from `stored_spans`, explicitly because they made folding O(n²). Landing sites: `trace-events.derivation.ts`, `scenario-role-metrics.derivation.ts`, `span-cost.derivation.ts`. Per-span `Cost` is already materialised by the **same `SpanCostService` the fold uses**, specifically so it reconciles with the fold total.

---

## 2b. Measurements (real Redis, `foldCacheSize.integration.test.ts`)

Absolute latencies drifted run-to-run on a loaded laptop (6.3 → 15.5 ms/batch for the same case), so treat timings as indicative and ratios as solid.

### The applied-event-id set is a flat ~29 KiB, and that is the wrong shape

| state | state bytes | + applied-set | set as share of entry |
|---|---|---|---|
| small trace (10 spans, 1 KiB IO) | 2.7 KiB | 29.3 KiB | **91.5%** |
| medium (500 spans, 16 KiB IO) | 43.3 KiB | 29.3 KiB | 40.3% |
| large (40k spans, 64 KiB IO) | 139.3 KiB | 29.3 KiB | 17.4% |

The set is constant regardless of state size, so it is **11× the state on a small trace** — negligible on the traces we worried about, dominant on the traces there are most of. If typical traces are small this multiplies the fold cache's Redis footprint roughly 12×, on an instance shared with the queues.

**Cause:** `MAX_APPLIED_EVENT_IDS = 1000`, chosen from the 500 coalesce ceiling plus headroom, never measured. A redelivery re-sends at most one batch; the retry chain needs a little more than one. **The right cap is a function of real batch fill, which is unmeasured — so the batch-fill histogram is a blocker for sizing it, not a nice-to-have.**

### The O(N²) round-trip is smaller than previously claimed

~5-16 ms per batch, flat, and 13.2 MiB moved through Redis across a whole 40k-span trace. Earlier drafts of this plan called the full-state GET/SET a major untouched problem. At these numbers it is not, and the claim is withdrawn.

**It is flat only because `MAX_PROCESSED_SPANS` freezes derivation at 512 spans**, so state plateaus. The two findings are the same finding seen from opposite ends.

### Removing `MAX_PROCESSED_SPANS` costs 18× entry size

| spans | capped | uncapped | ratio | one write |
|---|---|---|---|---|
| 512 | 139.3 KiB | 157.0 KiB | 1.1× | 2.6 ms |
| 5,000 | 139.3 KiB | 419.0 KiB | 3.0× | 7.9 ms |
| 40,000 | 139.3 KiB | **2528.4 KiB** | **18.1×** | **83.3 ms** |

At 40k spans an uncapped entry is 2.5 MiB and each write takes 83 ms; ~80 batches is ~6.6 s of Redis write time for one trace, plus a 2.5 MiB `JSON.stringify` on the event loop per batch.

**The cap is a symptom-suppressor for unbounded fold state, not the disease.** It cannot be removed until state stops growing with span count.


---

## 3. Decision: cut the durability-gated confirmation machinery

ADR-056's central claim is that a cache miss proves the durable store is authoritative. Against the constraints above that claim does not survive:

- The npx installer ships **`allkeys-lru`**, so fold cache entries are evicted under memory pressure, and nothing detects it. The invariant is fiction in one of three shipping configurations.
- Redis is a **single shared instance**, so queue traffic can evict cache entries.
- The chart default is **replicas: 1**, where the replica probe — the most complex piece — is answering a question nobody asked.
- It is scaffolding around accumulators that Phase 2 removes anyway.

The probe as written also **never confirmed anything** (`UpdatedAt` is `DateTime64(3)`; raw `max()` serialises as a datetime string, `Number()` → `NaN` → every aggregate dropped). Fixed on the branch, but it shipped with a unit test that fed numbers and therefore passed regardless.

**Keep** the applied-event-id set and the executor dedup: ~100 lines, no probe, no processor, no liveness check, no topology assumptions. It closes the dominant warm-retry path.
**Cut** `confirmationProcessor.ts`, `durabilityProbe.ts`, `clickhouseDurabilityProbe.ts`, `groupQueueLivenessCheck.ts`, `pendingConfirmations.ts`, the confirmation metrics, and the backstop-TTL change. Record in ADR-056 as considered-and-deferred, with the constraints above as the reason.

**Known limitation of the narrow fix:** the applied-set lives in the cache entry, so if Redis evicts or fails, dedup is lost. That degrades to *today's* behaviour rather than to something worse, which is the bar for this PR.

---

## 4. Plan

### Phase 0 — Measure (no code)
1. Query production: `gq_jobs_retried_total` on the fold queue, `es_reactor_total{status="failed"}`, `gq_jobs_exhausted_total`, `gq_blocked_groups`. **Sizes the bug.**
2. Query ClickHouse: quantiles of `trace_summaries.SpanCount` (p50/p90/p99/max). **Confirms or corrects the 25-40k figure.**
3. Check the production Redis `maxmemory-policy` and replica count. Decides whether §3's reasoning holds for the SaaS.

### Phase 1 — Land the narrow fix + verified bugs
1. Cut the confirmation machinery per §3; restore the 300s TTL; revert the backstop-TTL env var.
2. Keep: `foldCacheEntry.ts`, the applied-set on the cache entry, `dropAlreadyApplied` in the executor, `es_fold_duplicate_events_skipped_total`.
3. Fix the **false comment and the re-stage amplification** at `groupQueue.ts:1082-1088` — siblings whose events were already folded in must not be blindly re-staged.
4. Fix **blob release throwing after `complete()` succeeded** (`groupQueue.ts:1045-1051`) — a separate double-delivery path.
5. Fix `__attempt` not surviving sibling restaging (`groupQueue.ts:1318-1325`), which silently resets the 25-attempt budget.
6. Add the **batch-fill histogram** — currently unmeasurable. It now BLOCKS sizing `MAX_APPLIED_EVENT_IDS`, which at 1000 makes the applied-set 91.5% of a small trace's cache entry (§2b).
7. **Re-cap the applied-set** from measured fill once (6) has data. Until then, lower it to a defensible figure rather than leaving 1000 in place.
8. Boot-time assertion (or loud warning) on Redis `maxmemory-policy`, since the fold cache is now explicitly a correctness-relevant cache.
9. Tests: executor-level redelivery-not-applied-twice (the spec scenario with no automated counterpart today), and a real-GroupQueue integration test for the liveness/key derivation if any of it survives.

### Phase 2 — Make the two cheap folds idempotent
Near-zero blast radius, so this is the highest value-per-risk work in the plan.

1. **`suiteRunState`** — zero production readers. Convert counters to derived-from-a-keyed-map, or delete the unread fields outright.
2. **`experimentRunState`** — only `Progress`/`Total` are read. The **idempotent keyed-delta pattern already exists in this very file** for `TotalCost` (`:269-281`); apply it to the rest, or delete the ten unread accumulators.

Each fold that becomes idempotent needs no cache guarantees at all.

### Phase 3 — `traceSummary` / `traceAnalytics`, data-driven
Only after Phase 0's numbers.

- `totalCost` and the token sums **can** move to read-time: `stored_spans.Cost`/`NonBilledCost` already exist, computed by the same service to reconcile.
- `spanCount` **must stay a monotonic fold counter** — it is a watermark, not a statistic. Do not convert it.
- `annotationIds` is already idempotent. `models` is membership-idempotent but order-dependent on replay.
- **Removing `MAX_PROCESSED_SPANS` is part of this phase, not separate.** It is wanted — past 512 spans derivation freezes, so a 40k-span trace reports attributes, models and IO from its first 512 spans while `spanCount` says 40000, i.e. quietly wrong rather than merely truncated. But removing it before state is bounded costs 18× entry size (§2b). Order: identify what actually grows (the merged attribute map is the main suspect; `events`, `spanCosts` and `scenarioRoleCosts` were already moved out for exactly this reason — `traceSummary.foldProjection.ts:350-357`), move or bound it, then drop the cap. At that point state is O(1) in span count and the cap protects nothing.
- Removing the cap also removes the evaluation-dispatch suppression at `evaluationTrigger.reactor.ts:91`, which exists for cost control on runaway traces. That needs a replacement guard that is not a fold-state counter.
- Reconcile the **three existing dual-source-of-truth pairs** first (`trace_summaries.SpanCount` vs `count()` over `stored_spans`; `TotalCost` vs `sum(Cost)`; token counts vs read-time attribute extraction) — they already disagree past the 512-span cap.

### Phase 4 — Documentation sweep (independent of the above)
- Delete/rewrite ADR-007 (describes BullMQ and a `SimpleQueue` that do not exist), retire ADR-021, promote 022/029/030a from `Proposed` despite being shipped, renumber the duplicate ADR numbers, regenerate the index (the index now covers all of them).
- Sweep dead references: BullMQ/`SimpleQueue` comments, `groupQueue/ARCHITECTURE.md`'s Redis key table (all seven rows wrong), `sqrt` weighting that does not exist, TTL constants that disagree with `blobConstants.ts`.
- ADR-052/PR #5911 already drops `ReactorOutbox`; do not duplicate.

---

## 5. Already committed on this branch

Commit `7aefec27da`, 22 files. Contains both what to keep and what §3 cuts:

**Keep:** `foldCacheEntry.ts`; applied-set plumbing in `redisCachedFoldStore.ts`; `appliedEventIds` on `ProjectionStoreContext`; `dropAlreadyApplied`/`loadWithApplied` in `foldProjectionExecutor.ts`; `services/queues/groupKey.ts` (extracted so the queue's key format has one definition); `es_fold_duplicate_events_skipped_total`; `es_fold_cache_entry_bytes`; removal of dead `toCacheable`.

**Cut:** `foldCache/{confirmationProcessor,durabilityProbe,clickhouseDurabilityProbe,groupQueueLivenessCheck,pendingConfirmations}.ts` + their tests; the confirmation metrics; the backstop-TTL change and `LANGWATCH_FOLD_CACHE_BACKSTOP_TTL_SECONDS`.

**Note:** `LANGWATCH_FOLD_CACHE_TTL_SECONDS` was silently removed and must be restored — operators with it set would otherwise get a silent change.

---

## 6. Principle

Every mechanism added here carries a **named retirement condition**. ADR-056's best quality is that it audits its predecessors honestly; its successor should be able to do the same to it without finding that a temporary mechanism quietly became permanent.
