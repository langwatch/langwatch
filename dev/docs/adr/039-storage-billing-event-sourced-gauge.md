# ADR-039: Storage billing derives billable bytes from a boundary-event fold, never a backlog resum

**Date:** 2026-07-09

**Status:** Accepted (locked 2026-07-10)

**Supersedes:** [ADR-027](./027-storage-gb-billing.md) — its measurement and dispatch strategy is replaced; its pricing model, 35-day billing cutoff, hourly-additive Stripe reporting protocol, and `StorageUsageHourly` contract were re-examined in this revision and **re-locked unchanged**. They are restated below as kept decisions, not silently inherited. This document stands alone; the predecessor is referenced only here.

> One-line: bill **GiB-hours** by folding **signed partition-boundary events** (daily transit deltas at the **35-day entry** edge; query-free exit mirrors for **every** billable table) into a per-org **Postgres gauge**, sampled hourly into `StorageUsageHourly` — **no query ever scans more than one partition**, and ClickHouse-native TTL is never hooked, delayed, or replaced.

## Context

The superseded design measures each org's billable bytes by re-running, per sealed hour:

```sql
SELECT sum(_size_bytes) FROM <table>
WHERE TenantId = {tenantId} AND <age col> <= {cutoff}   -- rows aged > 35d
```

unioned across the 11 retention-managed ClickHouse tables. This resums the org's **entire historical backlog** every hour, even when nothing changed. `_size_bytes` aggregation at this shape caused **two production OOM incidents**; the mitigations (`max_threads: 2`, 45s timeout, degrade paths) manage the cost, but the query shape — O(org's total backlog), hourly, forever — remains the root cause. Because the resulting number is a cached snapshot that nothing structurally re-verifies, the old design needed a measure-time tripwire and a reconciliation job as **load-bearing** safety nets.

Separately, ClickHouse's native TTL deletion is invisible to the application by design: no row/org-level introspection exists ([ClickHouse#10128](https://github.com/ClickHouse/ClickHouse/issues/10128)); `system.part_log`'s `TTLDeleteMerge` tag is part-level with no byte attribution. Any design requiring TTL to announce what it deleted is a dead end.

Forces, as confirmed at framing:

1. **Full redesign scope.** Everything in storage billing was on the table — pricing, reporting, measurement, dispatch, reconciliation. (Pricing and reporting were then re-locked unchanged; see Decisions 1–2.)
2. **Forcing function:** the predecessor's implementation stack (PRs #4832, #5158, #5225, #5227 + merged #5228/#5246) is fully built but **zero of it is merged to main** — a strategy swap is only cheap right now.
3. **Blast radius: customer invoices.** A wrong gauge silently mis-bills real money. Full rigor: invariants with test anchors, red-team pass mandatory.
4. **Hard constraints (locked):** no cron/scheduler ever — every time-boundary action is triggered by real events through the existing event-sourcing pipeline, made safe by dedup; ClickHouse-native TTL stays untouched; the billable-events meter is out of scope.

Key structural facts of the retention system the design exploits (counts corrected in v5): the **13** retention-managed tables map to **3 retention categories** (traces = 9 tables, scenarios = 2, experiments = 2 — `retentionPolicy.schema.ts`), are partitioned by `toYearWeek`, and rows carry `_retention_days` (per-tenant, per-category). Of those 13, **10 are billable** (v5): the two derived analytics tables (`trace_analytics`, `trace_analytics_rollup`) carry no `_size_bytes` column and are excluded — they are system-derived projections of already-billed trace data, so billing them would double-charge the same information; and `evaluation_runs` is excluded because its billing-age axis is mutable and decoupled from its partition axis (see Decision 3). The billable set is therefore an **explicit constant** (each entry verified to carry `_size_bytes` by a startup/test assertion), never derived from the retention map — deriving it is how a schema addition silently changes invoices. The billing cutoff `BILLABLE_AFTER_DAYS = 35` is a clean week-partition boundary. **For every billable table, retention is deterministic — every row's entry into and exit from the billable window is knowable in advance.**

Two scope facts every budget below depends on (perf red-team F0):

- **The 35-day paid retention floor has shipped (gate closed in v5).** At v4 this was flagged as a coupled product change; verified on `main` as of v5: `MIN_RETENTION_DAYS = 35`, paid presets `[35, 63]` (plan-gated retention menu). Existing orgs still *default* to 49d (platform default) or 308d (migration grandfather) until they opt down, so seeding and steady-state budgets for grandfathered orgs are unchanged — but a customer **can** select 35 today, so the €0-by-construction state is reachable and metering GA is no longer blocked on a floor change.
- **Everything in this design is gated to SaaS-billable orgs** (Stripe customer + active subscription), checked before any calendar, query, or event: ~200 orgs, not the ~2,000 total. An ungated rollout would silently 10× every number in this document.

## Decision

### 1. Pricing: kept unchanged (re-locked)

€3/GiB-month in binary units, 35-day included window, GiB-hours integral via an hourly-additive Stripe `sum` meter. The measurement swap does not invalidate any of the research behind it (competitor matrix, Stripe meter mechanics — vault `EPIC/Q2/data-retention/reporting-stripe/`), the Stripe catalog entries, or the €0-by-construction story. Reopening pricing was considered and rejected: it multiplies blast radius for no commercial driver.

### 2. Reporting: hourly-row + reporter protocol kept unchanged (re-locked)

The gauge is sampled once per sealed UTC hour into `StorageUsageHourly` (one row per org per hour, MiB, `reportedAt` cursor); a reporting command consumes rows with an idempotent per-hour cursor, a deterministic Stripe identifier (`storage_mb:<org>:<hourISO>`), additive delivery, and a circuit breaker. Downstream of the hourly row, **nothing changes**: the invoice line remains `SELECT sum(megabytes)` over the period — the per-hour audit trail every invoice traces back to.

### 3. Measurement: a per-org billable-bytes gauge folded from signed boundary events

The billable quantity ("bytes aged > 35d, still under retention") changes at exactly three kinds of moments, all app-observable:

- **Entry** — rows age past the 35-day line. **Daily transit deltas:** a week-partition's rows cross the line over ~7 days, so while a partition is in transit, one **partition-scoped** query per day computes the newly-billable slice, grouped by `_retention_days` (rows in one partition can carry heterogeneous retention after policy changes):

  ```sql
  SELECT _retention_days, sum(_size_bytes)
  FROM <table>
  WHERE TenantId = {tenantId}
    AND <partition key> = {week}          -- single partition, pruned
    AND <age col> <= {35d cutoff at H}
  GROUP BY _retention_days
  ```

  The delta vs. the previous day's measurement is emitted as one `+N` event per `(project, category, partition, sliceDate, retentionDays)`. ≤ 8 bounded queries per partition lifetime. Accuracy ~1 day (≈1.8% under vs. exact, always customer-favorable). A partition past the 35-day line is **immutable for every billable table** (new writes don't land in 35-day-old occurrence-time data), so entry measurement can never race TTL — for every retention > 35, the exit boundary is strictly later.

  *Rejected:* whole-partition event at full crossing (simplest, but bills 21 of 28 billable days for a retention-63d org — a permanent ~25% under-bill); whole-partition at first crossing (bills rows still inside the included window — a dispute surface contradicting the €0-by-construction promise); the ingest-fold from this ADR's own first draft (folds *total* bytes, not billable bytes — it would bill data from day 0, over-billing every org's newest 35 days).

  **Daily deltas are signed, not monotone (red-team F4).** All billable tables are `ReplacingMergeTree` and the measurement runs without `FINAL`: between a row re-write and its background merge, both versions count, and when the merge lands the sum *drops* with no deletion having occurred — so a day's delta can be legitimately negative. The fold accepts signed deltas as-is (the noise nets out once parts settle, and occurrence-time tables settle long before day 35, so the residual is small). The conflict with the never-negative guard is resolved at the **sampling boundary, not the gauge**: the gauge itself may transiently dip below zero on a small org; the sampled hourly value is `max(0, ceil(gaugeBytes / MiB))`, and a gauge negative beyond a small tolerance raises the drift alarm rather than refusing to sample (a refused sample is a silently dropped billing hour — worse than clamping).

- **Exit** — rows cross their retention line and TTL becomes entitled to delete them. **No query, for every billable table:** their partition/age columns are immutable occurrence times, so the exit deltas are exactly the recorded entry deltas for that `(partition, retentionDays)` group, negated and shifted by `(retentionDays − 35)` days. Emitting `−N` from the stored `+N` makes exit **immune to physical TTL timing** — the bill follows the customer's retention *entitlement*, not ClickHouse's merge schedule.

  **`evaluation_runs` is excluded from storage billing (v5 — a decision flip; the v3 carve-out is withdrawn).** The v3/v4 record misstated the schema. Verified (`00002_create_schema.sql`): the table is partitioned by `toYearWeek(ScheduledAt)` — `ScheduledAt` is **non-nullable and immutable** — while its retention-TTL age column is `UpdatedAt` (`ttlReconciler.ts`), which is **mutable**: re-running or re-scoring an old eval bumps `UpdatedAt` and resets the row's billing age *without moving it between partitions*. That decouples the billing-age axis from the partition axis, which breaks **both** edges of the boundary model for this table — not just the exit mirror (the v3 finding) but the daily-transit entry model too (rows in an old partition cross the 35-day line at arbitrary times). The v3 fix (measured exits) was therefore insufficient; the honest alternative was measured entry *and* exit queries on the `UpdatedAt` axis — a standing pile of special-case machinery for one table. The decision owner flipped to **exclusion**: evaluation bytes are stored but never billed. The asymmetry (free eval bytes vs. paid trace bytes, rejected in v3) is accepted with eyes open — eval data is small relative to traces, and the trade buys the deletion of the design's most fragile component. **Revisit condition:** if the table's schema is reworked so its partition and retention-age axes are unified and immutable (schema-drift issue #5209 is being resolved separately by the decision owner), inclusion can be re-proposed as a new revision — it would then need no carve-out at all. Also rejected for this table: emit-on-touch (every eval write path becomes billing-critical; one missed emitter drifts silently forever).

- **Manual deletion** — GDPR erasure, project deletion, and retention-policy *lowering* are all app-driven, so they emit: erasure/project-deletion paths measure the affected in-window bytes (partition-scoped queries) and emit `−N` **before** deleting. Deletion lowers the invoice the same hour — the customer-facing promise the pricing model makes, kept in real time rather than at the next reconciliation. The `−N` (Postgres) and the physical delete (ClickHouse) cannot share a transaction — they are different stores — so the ordering is deliberate: emit-then-delete means a delete that fails after the `−N` leaves an *under*-bill (customer-favorable, bytes still present but not charged), which the reference audit (Decision 7) re-measures and corrects; the reverse order could over-bill a deleted customer.

- **Retention-policy change (red-team F2 — the precise protocol, not "recompute"):** a retention change is handled as **reverse-then-emit**, wired into the retroactive-update path: for every affected `(partition, retentionDays=R_old)` entry group, emit the exact negation of its recorded events (cancelling the old exit schedule), then re-emit the group under `R_new` with exits shifted by `(R_new − 35)`. A naive "recompute the calendar" would double-count, because the dedup grain includes `retentionDays` — old-group and new-group events would both survive. If the underlying `ALTER TABLE … UPDATE _retention_days` mutation wedges partway (this has happened in production), the org is flagged: its reconciliation stays in the hot tier (Decision 7) until the mutation is confirmed complete, because the fold's assumption of full application no longer holds.

Special cases falling out of the calendar: retention < 35d (free tier) → rows die before ever billable, zero events; retention = 35d (the paid default **once the coupled 49→35 floor change ships** — see Context) → entry and exit coincide, net 0, both edges skipped — **€0-by-construction needs no query at all**.

**Query unit vs. emit unit (perf red-team F7):** the measurement queries run per physical **table** (the 10 billable tables — each `FROM <table>`, no cross-table scan possible); events are emitted per **category** (3) — the per-table results for one `(project, category, partition, slice, retentionDays)` are **summed before emit**, so the dedup key stays category-grained without collisions. CH query budgets scale with 10; PG row budgets scale with 3.

### 4. Storage: Postgres, through the existing event-sourcing pipeline

Boundary events are commands through the existing event-sourcing pipeline into Postgres; the gauge is a materialized per-org row maintained by the fold. ACID writes plus the transactional-outbox pattern already used platform-wide for stake-sensitive dispatch give the durability the money path needs; replay-safety comes from per-event dedup keys. *Rejected:* a ClickHouse fold projection (the pattern the analytics materialization uses) — it would put the billing-critical number inside the same store whose deletion behavior we're insulating against, with no transactional emit guarantee.

**Volume (corrected per red-team F5):** the event grain is `(project × category × partition × sliceDate × retentionDays × edge)` — for a 10-project org that is on the order of **hundreds of events per partition-week**, not the single digits a naive per-org count suggests; platform-wide, low millions of immutable rows per year. Fine for Postgres, but the events table is the billing audit trail and needs a lifecycle plan (see Open questions).

**Catch-up sampling (red-team F3; wording hardened per perf F5):** the materialized gauge row is O(1) for the **current** hour only. Missed past hours (deploy gap, outage) cannot be stamped with today's value — they are reconstructed by **one ordered forward replay** of events, emitting a snapshot at each hour boundary: O(events + hours) total, never a per-hour re-fold (which would be O(events × hours) — 336M applies for a week-long gap at platform scale). The sampler and the re-seed runbook both use this replay; stamping a past hour from the live gauge row is a correctness bug, not an optimization.

**Gauge updates are atomic increments (perf F6):** the gauge is one hot row per org, written from per-project events. Applies use `SET billableBytes = billableBytes + delta` (never read-modify-write), and the event pipeline already orders events per aggregate — the aggregate id is the **organization** — so concurrent-project lost updates cannot occur.

### 5. Dispatch: event-triggered, with a platform-wide deduped sweep (no cron)

Ingest events remain pure wake-ups. Any event from **any** org triggers a cheap, deduped, batch-bounded sweep: "which orgs have boundary crossings due or sealed hours unsampled?" — ambient platform traffic substitutes for a clock, per the locked no-cron constraint. This deliberately **widens** the predecessor's trigger (an org's own events only), because an idle org's stored data keeps accruing GiB-hours — storage cost while idle is precisely the product being billed. A fully idle platform (zero events from anyone) has no trigger; accepted, the same trade-off the platform's existing billing grace-period mechanism already makes. *Rejected:* own-events-only (systematically under-bills exactly the orgs whose retained storage is their whole bill).

Four sweep properties are **invariants, not tunables** (red-team F7; the once-per-hour mechanism corrected by perf F2/F3 — queue dedup alone cannot deliver it):
- **Durable once-per-hour cursor:** queue dedup only squashes re-enqueues while a job is *staged* — once dispatched, the next event stages a fresh sweep, so with continuous ingest, sweeps would run back-to-back (~360/hour at a 10s sweep). The real guarantee is a **durable `lastSweptSealedHour` check at the top of the handler**: a redundant sweep no-ops in O(1). Queue dedup remains as churn reduction, not the guarantee.
- **Process-local short-circuit:** every ingest event otherwise pays a full staging round-trip (~15 Redis ops on one hot slot; ~15k ops/sec at burst). A per-process "already staged for hour H" guard collapses millions of daily wake-up evaluations to ~one per process per hour before Redis is touched.
- **Per-org error isolation:** one org's failing boundary computation (poison org) is caught, alarmed, and skipped — it never fails the sweep batch for every other org.
- **Queue separation:** the sweep runs worker-side at lower priority than ingest; billing scans never contend with the hot path.

### 6. Seeding: retroactive entry events, never a backlog scan

At rollout (and at gauge re-seed), initialization replays the entry edge over history: enumerate each existing in-window partition, run the same bounded per-partition query, emit synthetic entry events. Same code path as steady state; the full-backlog OOM query shape is never run — not even once. Flag-gated and throttled per org. *Rejected:* one-time full-backlog seed (the OOM shape, once, needing dedicated cap machinery for a single use); forward-only from zero (permanently under-bills every existing customer's already-old data).

**Dedup identity: edge-class, not raw edge (red-team F6; corrected in v4.1 — the v3 wording was defective).** The v3 fix removed `edge` from the dedup key entirely to stop seed/live double-counting — but exits *mirror* entries with identical `(project, category, partition, sliceDate, retentionDays)` values, so a fully edge-free key would dedup every EXIT away as a replay of its own ENTRY, and every retention-change reversal likewise: the gauge could only ever go up. The correct identity is `(project, category, partition, sliceDate, retentionDays, edgeClass)` where:
- `ENTRY` and `SEED` share one edge-class (seed is an emitter context — this is what kills the cutover double-count),
- `EXIT` is its own class,
- corrections (`DELETION`, retention-change reversals/re-emits) carry a `causeId` (erasure-request id / retention-change id) in the key — without it, changing retention 63→90→63 would collapse the second reversal into the first and silently drop it.

Per-partition cutover remains hard: a partition is either seeded or live-tracked, never both mid-transit.

**Seeding budget (perf F4):** at current scale (~200 billable orgs × ~5 projects × 10 billable tables × up to ~39 in-window partitions for grandfathered 308d orgs) seeding is on the order of **400k one-time bounded queries** — roughly 60 hours at 2 qps, days at lower throttles. Two preconditions before it runs: `ALTER TABLE … MATERIALIZE COLUMN _size_bytes` on parts predating the column (so the seed never hits the lazy-recompute path — the actual expensive shape), and a **shared CH rate budget** across seeding + reconciliation + steady-state transit queries, so their sum stays inside a stated ceiling instead of stacking.

### 7. Reconciliation earns its demotion; drift response is manual

**Amended after red-team (v3):** a delta-fold *accumulates* error where the old re-sum self-corrected it — every leak in the immutability premise (retroactive retention ALTERs, un-merged `ReplacingMergeTree` versions, late arrivals; mutable `evaluation_runs` was the fourth class until its v5 exclusion) becomes permanent silent drift unless something recounts. So reconciliation starts **load-bearing: daily, per-org, alarmed** — through shadow mode and the first full billing cycle. It demotes to weekly cold-path **only after one full cycle with zero discrepancies**, with two exceptions: orgs with a retention-policy change in flight or wedged stay in the daily tier **until the change is confirmed fully applied** (Decision 3), and any org that has ever tripped a drift alarm stays in the daily tier **permanently**. The hour-over-hour tripwire remains a cheap always-on sanity check on gauge samples.

**Coverage mechanics (perf F1 — a naive "daily full reference check" would re-create the hazard):** checking every in-window partition of every org daily is ~430k bounded CH queries/day (~5 qps sustained; the worst single org alone is ~26k/day) — the full-backlog scan reborn at 1/24th frequency, and partition-chunking bounds *per-query memory*, not aggregate throughput. The daily tier is therefore **two-layered**:
- **Daily fold audit — Postgres only, no ClickHouse.** Recompute the gauge from the immutable event log and compare to the materialized row, plus compare reported hourly totals vs. Stripe. Catches fold bugs, missed events, and reporting drift **next-day**, at zero CH cost.
- **Rotating reference audit — ClickHouse, capped.** Re-measure at most **N partitions per org per day**, with N sized so full coverage completes within **7 days** — the natural rhythm for week-grained partitions, and it means measurement-side drift (the late-arrival and retroactive-ALTER classes) is caught at worst as fast as the end-state weekly audit, while fold/reporting drift stays next-day. Cost at 7-day rotation is ~0.7 qps average platform-wide — negligible vs. the ~5 qps a daily full check would sustain. The cap is an **invariant, not a tunable**.

On detected drift (fold bug, missed event, late-arriving rows into an in-window partition): **alarm + operator-run re-seed** for that org via the Decision-6 path, reconstructing via fold-to-H (Decision 4). **No automated correction** — a silent corrective event on a billing gauge is an invoice line no operator ever saw. *Rejected:* auto-correct under a threshold (the threshold becomes an untended tunable); cold-path-from-day-1 (the originally locked posture — re-opened and re-decided after the red-team showed the residual leak classes compound silently between weekly runs exactly when the code is newest).

### 8. The predecessor's PR stack is closed, not salvaged

All open stack PRs (#4832, #5158, #5225, #5227; #5228/#5246 already merged into #5227's branch) are **closed and re-implemented** against this document. A salvage map (merge the schema + reporter PRs, rework the dispatcher in place) was evaluated and **rejected by the decision owner** in favor of clean re-implementation: no risk of superseded assumptions leaking through review-approved code. Carried forward as *specifications*, not code: the `StorageUsageHourly` + reporter contract (Decision 2), the pricing contract (Decision 1), the lock-fencing / orphan-heal / Sentry-escalation review findings from #5227 (they apply to any dispatcher), and the BigInt-not-Int lesson from #4832.

## Constants

| Name | Value | Purpose |
|---|---|---|
| `BILLABLE_AFTER_DAYS` | 35 | Included window; entry-edge cutoff. Clean `toYearWeek` boundary (kept) |
| Price | €3 / GiB-month, 30-day convention | €3 / 30 / 24 / 1024 ≈ €0.00000407 per MiB-hour (kept) |
| Meter event | `langwatch_storage_megabytes_hourly` | Stripe `sum` meter, additive integer MiB (kept) |
| Stripe identifier | `storage_mb:<orgId>:<hour ISO, hour precision>` | Deterministic per-hour idempotency (kept) |
| Billable-table set | 10 explicit tables (13 retention-managed minus `trace_analytics`, `trace_analytics_rollup`, `evaluation_runs`) | Explicit constant, never derived from the retention map; every entry assertion-checked for `_size_bytes` (v5) |
| Partition grain | `toYearWeek` | The unit of boundary crossing (retention-system fact) |
| Slice grain | 1 day | Entry-transit delta resolution (Decision 3) |
| Entry-query caps | `max_threads: 2`, `max_execution_time: 45` | Mandatory on every `_size_bytes` query — 2-OOM history |
| `STRIPE_BACKDATE_CEILING_HOURS` | 840 | Stripe rejects older timestamps; sweep lag alarm threshold (kept) |
| Sample cap per run | 168 hours | Bounds one sweep's hourly-row writes per org (kept) |
| MiB | 1,048,576 bytes | Sampling rounds `ceil(gaugeBytes / 1_048_576)` |

## Budgets

Stated at current scale (~200 billable orgs, avg 5 projects, retention mix incl. grandfathered 308d; worst-case org = 50 projects × 365d retention). These are **ceilings the implementation must stay inside**, not observations:

| Component | Budget | Notes |
|---|---|---|
| Entry transit queries (steady state) | ~10k/day ≈ 0.12 qps | orgs × projects × 10 billable tables × partitions-in-transit × 1/day |
| Daily fold audit | 0 CH queries | Postgres event-log recompute + Stripe totals comparison |
| Rotating reference audit | ≤ N partitions/org/day, full coverage ≤ 7 days (~0.7 qps platform avg) | Invariant, not tunable (perf F1; 7-day bound set by decision owner) |
| Seeding (one-time) | ~400k bounded queries, throttled over days | After `MATERIALIZE COLUMN _size_bytes`; inside the shared CH rate budget (perf F4) |
| Sweep | 1 effective/sealed hour; redundant = O(1) no-op | Durable cursor (perf F2); process-local guard keeps wake-up Redis cost ~1 staging/process/hour (perf F3) |
| PG event rows | Low millions/year at category grain (3, not 11) | Audit-trail lifecycle in Open questions |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| Single-partition queries only | No query in this system scans more than one partition | Query builders take a partition key parameter — unit test asserts the partition predicate is present in generated SQL; an `EXPLAIN`-based integration test against real CH confirms pruning (a string test alone cannot — red-team F8) |
| Each hour billed exactly once | Re-dispatch, replay, crash-resume never double-bill | `reportedAt` cursor + deterministic Stripe identifier (kept reporter contract) — replay test |
| Never bill inside the included window | No row accrues before age > 35d | Daily transit predicate; rejected first-crossing option — predicate unit test |
| €0-by-construction, query-free | Retention-35d paid org bills €0 with zero CH load | Calendar: entry = exit → both skipped — calendar unit test |
| Deletion lowers the bill same hour | Erasure/project-delete/retention-lowering reflect immediately | App paths emit `−N` before deleting — erasure-flow integration test |
| Scheduled retention exits never query ClickHouse | Physical TTL timing cannot corrupt the gauge; exits are mirrors of recorded entries. (Manual-deletion paths legitimately measure before deleting — Decision 3 — and are outside this invariant) | Scheduled-exit path has no CH client — fold unit test (red-team F1; scoped v4.1; carve-out dissolved by the v5 `evaluation_runs` exclusion) |
| Idle orgs keep accruing | Stored bytes bill while the org does nothing | Platform-wide sweep samples all orgs — sweep unit test with idle-org fixture |
| One effective sweep per sealed hour, isolated per org | Redundant sweeps are O(1) no-ops; no poison org fails the batch | Durable `lastSweptSealedHour` cursor (queue dedup is churn reduction only — perf F2); per-org try/catch — sweep unit tests |
| Reconciliation CH cost is capped | The audit can never re-create the backlog-scan load | Daily tier = PG-only fold audit; CH reference audit rotates ≤ N partitions/org/day — budget test (perf F1) |
| Replay-safe fold | Re-delivering any event changes nothing; exits and corrections are never deduped into their entries | Dedup key unique per `(project, category, partition, slice, retentionDays, edgeClass [+causeId])`; ENTRY/SEED share a class, EXIT distinct — idempotency test incl. an exit-after-entry case (red-team F6, corrected v4.1) |
| Sampled value never negative; negative gauge alarms | Signed deltas are legitimate (un-merged `ReplacingMergeTree` versions); a dropped billing hour is worse than a clamped one | Sample = `max(0, ceil(gauge / MiB))`; gauge below tolerance → drift alarm, never refuse-to-sample — guard test (red-team F4) |
| Past hours reconstructed by fold-to-H | A missed hour is stamped with its true historical value, never today's | Catch-up sampler folds `occurredAt ≤ H`; test: gap replay reproduces pre-gap values (red-team F3) |
| Drift detected, never silently fixed | Every correction is operator-visible | Reconciliation (daily tier at rollout) alarms; test: corrective gauge writes outside the re-seed path are rejected (red-team F8) |
| Billable-table set is explicit and column-verified | A retention-map addition can never silently change invoices; a billable table without `_size_bytes` fails loudly, never bills €0 | Explicit constant + assertion (startup or test) that every billable table has `_size_bytes` — set-verification test (v5) |

## Schema

```prisma
// Signed boundary events — the fold's source of truth. One row per
// (project, category, week-partition, day-slice, retention-group, edge).
model StorageBoundaryEvent {
  id             String   @id @default(cuid())
  organizationId String
  projectId      String
  category       String   // retention category of the source table
  partitionKey   String   // toYearWeek, e.g. "202625"
  sliceDate      DateTime // the day-slice this delta covers
  retentionDays  Int      // _retention_days of the rows in this delta
  edge           String   // ENTRY | EXIT | DELETION | SEED
  deltaBytes     BigInt   // signed; BigInt per the #4832 overflow lesson
  // Identity = (project, category, partition, slice, retentionDays, edgeClass
  // [+ causeId for corrections]). ENTRY and SEED share one edge-class; EXIT is
  // its own; DELETION/reversals include their cause id. See Decision 6.
  dedupKey       String   @unique
  occurredAt     DateTime // the boundary instant this delta takes effect
  createdAt      DateTime @default(now())

  @@index([organizationId, occurredAt])
}

// Materialized fold result — one row per org. O(1) for sampling the CURRENT
// hour only; missed past hours are reconstructed by folding events with
// occurredAt <= H (never stamped from this row — Decision 4).
model StorageBillableGauge {
  organizationId String   @id
  billableBytes  BigInt
  lastEventAt    DateTime
  updatedAt      DateTime @updatedAt
}

// Durable home for the once-per-hour sweep guarantee (Decision 5 invariant —
// queue dedup is churn reduction only; this cursor is the guarantee, and it
// must survive redeploys/restarts, which the process-local guard cannot).
// Added in v5: the invariant existed since v4 but had no schema home.
model StorageSweepCursor {
  id                  String   @id // singleton row
  lastSweptSealedHour DateTime
  updatedAt           DateTime @updatedAt
}

// StorageUsageHourly — UNCHANGED contract (kept, Decision 2):
// (organizationId, sealedHour) PK, megabytes Int, reportedAt cursor, index on reportedAt.

// StorageBillingCheckpoint — re-implemented LEAN: (organizationId, billingMonth)
// unique, consecutiveFailures Int only. The accumulator columns from the
// predecessor's schema were dead code under per-hour reporting; not carried over.
```

## Rejected alternatives

- **Per-hour full-backlog resum, tuned harder** (the superseded status quo) — OOM stays a permanently managed cost; safety nets stay load-bearing.
- **Ingest-fold gauge** (this ADR's own first draft) — folds total bytes, not billable bytes; over-bills the newest 35 days of every org's data.
- **Whole-partition entry at full crossing** — ~25% systematic under-bill at retention 63d.
- **Whole-partition entry at first crossing** — bills inside the included window; dispute surface.
- **ClickHouse fold store** — billing number inside the store whose deletion semantics we're insulating against.
- **Full-backlog seed** — the OOM shape, run once; **forward-only seed** — permanent under-bill of existing data.
- **Emit-on-touch for `evaluation_runs` exits** — every eval write path becomes billing-critical; one missed emitter drifts silently forever.
- **Measured-edges carve-out for `evaluation_runs`** — the v3 choice (measured exits), widened to both edges once v5 showed the mutable `UpdatedAt` age axis breaks entry transit too; rejected as a standing pile of special-case machinery for one small table. Flipped to exclusion by the decision owner (v5); revisit if the table's axes are unified (issue #5209 rework).
- **Billing the derived analytics tables** (`trace_analytics`, `trace_analytics_rollup`) — system-derived projections of already-billed trace data; billing them double-charges the same information, and they carry no `_size_bytes` to measure. Excluded by decision owner (v5).
- **Reconciliation-only deletion tracking** — erased customers keep billing up to a week; GDPR optics.
- **Own-events-only closure** — under-bills idle orgs, contradicting the product being billed.
- **Auto-corrected drift** — invoice lines no operator saw.
- **Cold-path reconciliation from day 1** — residual leak classes compound silently between weekly runs exactly when the code is newest.
- **Salvage the predecessor's PR stack** — rejected by decision owner; clean re-implementation wins.
- **Direct boundary-event → Stripe reporting / monthly reporting** — breaks the GiB-hours integral / reintroduces the end-of-period fragility the pricing model was designed to avoid.
- **Reopen pricing** — no commercial driver; multiplies blast radius.

## Consequences

**Positive.** The OOM query shape is eliminated from the system (not mitigated — absent, including at seeding). Per-hour cost drops from O(org backlog) to O(1) gauge read; ClickHouse load becomes ≤ 1 bounded query per org-partition-day during transits; scheduled exits cost zero queries. Deletion is reflected in-invoice immediately. Idle orgs bill correctly. Every invoice line traces to hourly rows, which trace to signed, replayable, individually-auditable boundary events.

**Negative.** New machinery: boundary calendar, transit-delta emitter, fold projection, sweep reactor, seeding runbook — all net-new code where the old design was "one query." The fold is fragile-by-construction against missed events; reconciliation therefore starts load-bearing (daily, per-org) and only earns its demotion after a clean billing cycle. Late-arriving rows into an already-crossed partition slice under-bill until reconciliation notices (bounded by ingest-pipeline latency; accepted). Evaluation-run bytes are stored free (v5 exclusion) — unbilled revenue accepted as the price of deleting the design's most fragile component. The events table is a growing audit trail needing a lifecycle plan. The entire built-but-unmerged predecessor stack is discarded as code.

**Neutral.** ClickHouse TTL behavior, retention semantics, pricing, the Stripe surface, and the hourly-row reporting contract are all unchanged. The billable-events meter is untouched.

## Open questions

| Question | Owner | Blocking? |
|---|---|---|
| ~~`evaluation_runs` carve-out re-review~~ — **gate dissolved (v5):** the table is excluded from billing, so there is no carve-out to review. Successor question: revisit inclusion if/when the partition/age-axis rework (issue #5209, owned separately by the decision owner) unifies its axes | Decision owner, post-#5209 | No |
| ~~49→35 paid-retention-floor change~~ — **gate closed (v5):** verified shipped on `main` (`MIN_RETENTION_DAYS = 35`, paid presets `[35, 63]`); existing-org defaults (49/308) unchanged, budgets unaffected | Closed | No |
| Metering/billing flag identifiers must not reuse the closed predecessor stack's flag names (residual flags may linger in config/PostHog; a stale flag flipped on must not un-dark the new engine) | Implementation phase 2/4 | No |
| `MATERIALIZE COLUMN _size_bytes` backfill on pre-column parts — operational plan + timing before seeding | Ops, pre-seed | No |
| Events-table lifecycle (archival/partitioning for the low-millions-rows/year audit trail) | Implementation phase | No |
| Sweep batch sizes / dedup TTLs (tunables within the Decision-5 invariants) | Implementation phase | No |
| Late-arrival drift tolerance before alarming (reconciliation threshold) | First shadow-mode rollout | No |
| Platform-outage > 840h: Stripe `meterEventAdjustments` runbook (carried from the predecessor) | Ops, at wire-up phase | No |
| Category enumeration for the boundary calendar (11 tables → category map reuse from `retentionPolicy.schema`) | Implementation phase | No |

## Revisions

- **v1 (2026-07-09).** Initial draft (as ADR-035, PR #5597): ingest-fold + expiry events, TTL-untouched, no-cron.
- **v2 (2026-07-09, renumbered 039; 035 was taken).** Parc-fermé pass. Framing round: scope widened to full storage-billing redesign; blast radius locked to customer invoices; constraints re-confirmed (no-cron, TTL-untouched, billable-events-out) — pricing/reporting deliberately NOT carried over as assumptions. Fork round 1: **boundary-edge fold** replaces the v1 ingest-fold (v1 defect: it billed the not-yet-billable newest 35 days); pricing and hourly reporting **re-locked unchanged**; gauge store = Postgres/ES. Fork round 2: seeding = retroactive per-partition entry events; manual deletions emit; idle closure = platform-wide deduped sweep; **stack fate = close-all** (salvage map recommended, overruled by decision owner). Fork round 3: entry grain = **daily transit deltas** (whole-partition options rejected on ±25% revenue / dispute-surface grounds); exit = query-free mirror of entry deltas; drift response = alarm + manual re-seed.
- **v3 (2026-07-10).** Red-team pass (8 findings, 2 reopened locked forks — both re-asked, not silently re-decided). F1 (verified in code): `evaluation_runs` partitions on mutable `UpdatedAt` → exit-mirror premise false for it → **measured-exit carve-out**, locked with a decision-owner **review-before-merge gate**. Reconciliation posture re-decided: **load-bearing daily until one clean billing cycle**, retention-changed and previously-drifted orgs stay daily permanently (was: cold-path from day 1). Folded as specification: F2 reverse-then-emit retention-change protocol + wedged-mutation flagging; F3 fold-to-H catch-up sampling; F4 signed deltas + clamp-at-sampling (never refuse); F5 event-volume correction (~100× the naive estimate) + lifecycle open question; F6 SEED/ENTRY shared dedup key space + hard per-partition cutover; F7 sweep debounce/isolation/priority promoted from tunables to invariants; F8 test anchors made actually testable. Also this revision: all cross-ADR references removed so the document stands alone (predecessor cited only in the Supersedes line).
- **v4 (2026-07-10).** Quantitative red-team pass (performance / query budgets / job fan-out; 9 findings, none reopening correctness). **F0:** the 35d paid retention floor is a coupled product change, not current code (today's floor is 49d) — restored to the document as a **GA gate**, with explicit SaaS-billable gating on every component (ungated = silent 10×). **F1 (biggest):** a naive daily full reference audit ≈ 430k CH queries/day (~5 qps; worst org 26k/day) — the backlog scan reborn; the daily tier is now two-layered (PG-only fold audit daily + CH reference audit rotating ≤ N partitions/org/day), preserving next-day detection for fold/reporting drift while capping CH cost as an invariant. Rotation bound tightened 12 → **7 days** by the decision owner: week-grained partitions make weekly the natural full-coverage rhythm, the cost delta is negligible (~0.7 vs ~0.4 qps), and it keeps worst-case measurement-drift detection no slower than the originally-locked weekly audit. **F2:** queue dedup only squashes while staged — the once-per-hour sweep guarantee moved to a durable `lastSweptSealedHour` cursor; dedup demoted to churn reduction. **F3:** process-local wake-up guard (staging round-trip ~15 Redis ops on a hot slot at every ingest event otherwise). **F4:** seeding budget stated (~400k queries, days at safe throttle) + `MATERIALIZE COLUMN` precondition + shared CH rate budget. **F5:** catch-up = one ordered replay (O(events+hours)), never per-hour re-folds. **F6:** gauge writes = atomic increments; org-level event ordering. **F7:** query unit (11 tables) vs emit unit (3 categories) disambiguated — per-table results pre-summed before emit. **F8:** eval-runs exit query must carry the partition-key literal to prune. New Budgets section: all numbers are ceilings the implementation must stay inside.
- **v4.1 (2026-07-10).** Decision-owner-requested self-audit for internal inconsistency; three defects found and fixed. (1) **The v3 dedup fix was itself wrong:** removing `edge` from the event identity entirely would have deduped every EXIT away as a replay of its own ENTRY (identical key values) and collapsed repeated retention-change reversals — the gauge could only ever go up. Identity corrected to include an **edge-class** (ENTRY/SEED shared, EXIT distinct, corrections keyed by cause id); schema comment de-contradicted. (2) Decision 7 said retention-changed orgs stay daily "permanently" while Decision 3 said "until the mutation completes" — resolved: daily while in flight/wedged; only alarm-tripped orgs are permanent. (3) The exit invariant overclaimed — manual-deletion paths legitimately query CH before deleting; invariant scoped to *scheduled retention exits*.
- **Locked (2026-07-10).** Status → Accepted by the decision owner. From here, any change to a Decision is a new revision entry with what changed and why — never a quiet edit. Standing gates: `evaluation_runs` carve-out re-review before implementation merges; 49→35 retention floor before metering GA.
- **v5 (2026-07-10).** Pre-implementation adversarial review (5 findings verified against the live schema) — two stale factual premises corrected, and one locked fork reopened and **re-decided by the decision owner** (re-asked with the new facts, per protocol; not silently re-decided). **B1 — `evaluation_runs` facts corrected, decision flipped to exclusion:** the table partitions on immutable `ScheduledAt` (non-nullable), not on `UpdatedAt` as v3 recorded; `UpdatedAt` is the (mutable) retention-age axis, **decoupled** from the partition axis — so the daily-transit *entry* model was invalid for this table too, not just the exit mirror. That made the honest carve-out "measured entry + exit" — standing special-case machinery for one small table. Presented back to the decision owner, who flipped the v3 choice: **`evaluation_runs` is excluded from storage billing** (the asymmetry v3 rejected is now accepted with eyes open; eval bytes are small vs. traces). The carve-out and its review-before-merge gate dissolve; every billable table now has query-free exit mirrors. Revisit inclusion after the partition/age-axis rework (issue #5209, owned separately by the decision owner). **B2 — billable-table set made explicit:** the retention map has 13 tables (not 11 — stale since the analytics tables landed); `trace_analytics` + `trace_analytics_rollup` carry no `_size_bytes` and are **excluded by decision owner** (derived projections of already-billed trace data — billing them double-charges). Billable set = **10 explicit tables**, column-verified, never derived from the retention map (new constant + invariant). **N1 — 49→35 floor gate closed:** verified shipped on `main` (`MIN_RETENTION_DAYS = 35`, presets `[35, 63]`); the v4 F0 premise was stale; GA no longer blocked on it. **S4 — durable sweep cursor given a schema home** (`StorageSweepCursor`): the Decision-5 invariant required it since v4 but the schema block omitted it. **S3 — flag-identifier hygiene** added as an open question (predecessor stack's residual flags must not un-dark the new engine). Companion spec fixes in the same commit: superseded billing scenarios removed from the legacy metering spec; scenarios added/updated (billable-set exclusions, drift alarm, wedged-mutation daily tier, GDPR erasure, catch-up historical values, cursor persistence across restart).
- **v6 (2026-07-17).** PR-review clarification (no decision changed): made explicit that the manual-deletion `−N` (Postgres) and physical delete (ClickHouse) cannot share a transaction, so the emit-then-delete ordering is deliberate — a failed delete leaves a customer-favorable under-bill that the reference audit (Decision 7) corrects, whereas the reverse order could over-bill a deleted customer. Documentation only.
