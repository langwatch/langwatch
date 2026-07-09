# ADR-039: Storage billing derives billable bytes from a boundary-event fold, never a backlog resum

**Date:** 2026-07-09

**Status:** Proposed

**Supersedes:** [ADR-027](./027-storage-gb-billing.md) — its measurement and dispatch strategy is replaced; its pricing model, 35-day billing cutoff, hourly-additive Stripe reporting protocol, and `StorageUsageHourly` contract were re-examined in this revision and **re-locked unchanged**. They are restated below as kept decisions, not silently inherited. This document stands alone; the predecessor is referenced only here.

> One-line: bill **GiB-hours** by folding **signed partition-boundary events** (daily transit deltas at the **35-day entry** edge; query-free exit mirrors for 10 of 11 tables, measured exits for the one mutable-age table) into a per-org **Postgres gauge**, sampled hourly into `StorageUsageHourly` — **no query ever scans more than one partition**, and ClickHouse-native TTL is never hooked, delayed, or replaced.

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

Key structural facts of the retention system the design exploits: the retention-managed tables are partitioned by `toYearWeek`, rows carry `_retention_days` (per-tenant, per-category), and the billing cutoff `BILLABLE_AFTER_DAYS = 35` is a clean week-partition boundary. **Retention is deterministic — every row's entry into and exit from the billable window is knowable in advance.**

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

  The delta vs. the previous day's measurement is emitted as one `+N` event per `(project, category, partition, sliceDate, retentionDays)`. ≤ 8 bounded queries per partition lifetime. Accuracy ~1 day (≈1.8% under vs. exact, always customer-favorable). A partition past the 35-day line is **immutable for 10 of the 11 tables** (new writes don't land in 35-day-old occurrence-time data), so entry measurement can never race TTL — for every retention > 35, the exit boundary is strictly later.

  *Rejected:* whole-partition event at full crossing (simplest, but bills 21 of 28 billable days for a retention-63d org — a permanent ~25% under-bill); whole-partition at first crossing (bills rows still inside the included window — a dispute surface contradicting the €0-by-construction promise); the ingest-fold from this ADR's own first draft (folds *total* bytes, not billable bytes — it would bill data from day 0, over-billing every org's newest 35 days).

  **Daily deltas are signed, not monotone (red-team F4).** All 11 tables are `ReplacingMergeTree` and the measurement runs without `FINAL`: between a row re-write and its background merge, both versions count, and when the merge lands the sum *drops* with no deletion having occurred — so a day's delta can be legitimately negative. The fold accepts signed deltas as-is (the noise nets out once parts settle, and occurrence-time tables settle long before day 35, so the residual is small). The conflict with the never-negative guard is resolved at the **sampling boundary, not the gauge**: the gauge itself may transiently dip below zero on a small org; the sampled hourly value is `max(0, ceil(gaugeBytes / MiB))`, and a gauge negative beyond a small tolerance raises the drift alarm rather than refusing to sample (a refused sample is a silently dropped billing hour — worse than clamping).

- **Exit** — rows cross their retention line and TTL becomes entitled to delete them. **No query for 10 of the 11 tables:** their partition/age columns are immutable occurrence times, so the exit deltas are exactly the recorded entry deltas for that `(partition, retentionDays)` group, negated and shifted by `(retentionDays − 35)` days. Emitting `−N` from the stored `+N` makes exit **immune to physical TTL timing** — the bill follows the customer's retention *entitlement*, not ClickHouse's merge schedule.

  **Carve-out (red-team F1): `evaluation_runs` gets measured exits.** Its TTL/partition column is `UpdatedAt` (`ttlReconciler.ts` — chosen because the occurrence columns are Nullable), which is **mutable**: re-running or re-scoring an old eval resets the row's billing age and physically moves it out of its partition, so a pre-recorded mirror would keep billing bytes that already left the window (up to `retention − 35` days of phantom charge per touched row). For this table only, the exit event's value comes from a fresh bounded partition-scoped query at exit time — same shape and caps as the entry query, ~1 extra query per org-week. Rejected for it: emit-on-touch (every eval write path becomes billing-critical; one missed emitter drifts silently forever) and exclusion from billing (free eval bytes vs. paid trace bytes is an unjustifiable asymmetry). ⚠️ **REVIEW-BEFORE-MERGE flag (decision owner):** this carve-out must be re-reviewed against the then-current `evaluation_runs` schema before the implementation merges.

- **Manual deletion** — GDPR erasure, project deletion, and retention-policy *lowering* are all app-driven, so they emit: erasure/project-deletion paths measure the affected in-window bytes (partition-scoped queries) and emit `−N` **before** deleting. Deletion lowers the invoice the same hour — the customer-facing promise the pricing model makes, kept in real time rather than at the next reconciliation.

- **Retention-policy change (red-team F2 — the precise protocol, not "recompute"):** a retention change is handled as **reverse-then-emit**, wired into the retroactive-update path: for every affected `(partition, retentionDays=R_old)` entry group, emit the exact negation of its recorded events (cancelling the old exit schedule), then re-emit the group under `R_new` with exits shifted by `(R_new − 35)`. A naive "recompute the calendar" would double-count, because the dedup grain includes `retentionDays` — old-group and new-group events would both survive. If the underlying `ALTER TABLE … UPDATE _retention_days` mutation wedges partway (this has happened in production), the org is flagged: its reconciliation stays in the hot tier (Decision 7) until the mutation is confirmed complete, because the fold's assumption of full application no longer holds.

Special cases falling out of the calendar: retention < 35d (free tier) → rows die before ever billable, zero events; retention = 35d (paid default) → entry and exit coincide, net 0, both edges skipped — **€0-by-construction needs no query at all**.

### 4. Storage: Postgres, through the existing event-sourcing pipeline

Boundary events are commands through the existing event-sourcing pipeline into Postgres; the gauge is a materialized per-org row maintained by the fold. ACID writes plus the transactional-outbox pattern already used platform-wide for stake-sensitive dispatch give the durability the money path needs; replay-safety comes from per-event dedup keys. *Rejected:* a ClickHouse fold projection (the pattern the analytics materialization uses) — it would put the billing-critical number inside the same store whose deletion behavior we're insulating against, with no transactional emit guarantee.

**Volume (corrected per red-team F5):** the event grain is `(project × category × partition × sliceDate × retentionDays × edge)` — for a 10-project org that is on the order of **hundreds of events per partition-week**, not the single digits a naive per-org count suggests; platform-wide, low millions of immutable rows per year. Fine for Postgres, but the events table is the billing audit trail and needs a lifecycle plan (see Open questions).

**Catch-up sampling (red-team F3):** the materialized gauge row is O(1) for the **current** hour only. A missed past hour `H` (deploy gap, outage) cannot be stamped with today's value — it must be reconstructed by **folding events with `occurredAt ≤ H`** (the events are immutable and timestamped, so every historical hour is exactly reconstructable; cost O(events), acceptable because catch-up is rare). The sampler and the re-seed runbook both use fold-to-H; stamping a past hour from the live gauge row is a correctness bug, not an optimization.

### 5. Dispatch: event-triggered, with a platform-wide deduped sweep (no cron)

Ingest events remain pure wake-ups. Any event from **any** org triggers a cheap, deduped, batch-bounded sweep: "which orgs have boundary crossings due or sealed hours unsampled?" — ambient platform traffic substitutes for a clock, per the locked no-cron constraint. This deliberately **widens** the predecessor's trigger (an org's own events only), because an idle org's stored data keeps accruing GiB-hours — storage cost while idle is precisely the product being billed. A fully idle platform (zero events from anyone) has no trigger; accepted, the same trade-off the platform's existing billing grace-period mechanism already makes. *Rejected:* own-events-only (systematically under-bills exactly the orgs whose retained storage is their whole bill).

Three sweep properties are **invariants, not tunables** (red-team F7 — a mis-keyed debounce is the difference between one sweep per hour and a thundering herd on the ingest path):
- **Global debounce:** the sweep's dedup key is global per sealed hour (`storage_sweep:<sealedHourISO>`) — at most one sweep runs per sealed hour platform-wide, regardless of event volume.
- **Per-org error isolation:** one org's failing boundary computation (poison org) is caught, alarmed, and skipped — it never fails the sweep batch for every other org.
- **Queue separation:** the sweep runs worker-side at lower priority than ingest; billing scans never contend with the hot path.

### 6. Seeding: retroactive entry events, never a backlog scan

At rollout (and at gauge re-seed), initialization replays the entry edge over history: enumerate each existing in-window partition, run the same bounded per-partition query, emit synthetic entry events. Same code path as steady state; the full-backlog OOM query shape is never run — not even once. Flag-gated and throttled per org. *Rejected:* one-time full-backlog seed (the OOM shape, once, needing dedicated cap machinery for a single use); forward-only from zero (permanently under-bills every existing customer's already-old data).

**Seed/live dedup share one key space (red-team F6).** `SEED` is an emitter context, not a distinct dedup identity: the dedup key covers `(project, category, partition, sliceDate, retentionDays)` with SEED and ENTRY in the **same** key space (`edge` remains a column for audit only), so a slice measured by the seeder and again by the live emitter at cutover collapses to one event instead of double-counting. Per-partition cutover is hard: a partition is either seeded or live-tracked, never both mid-transit.

### 7. Reconciliation earns its demotion; drift response is manual

**Amended after red-team (v3):** a delta-fold *accumulates* error where the old re-sum self-corrected it — every leak in the immutability premise (mutable `evaluation_runs`, retroactive retention ALTERs, un-merged `ReplacingMergeTree` versions, late arrivals) becomes permanent silent drift unless something recounts. So reconciliation (gauge vs. bounded per-partition reference sums, and reported totals vs. Stripe) starts **load-bearing: daily, per-org, alarmed** — through shadow mode and the first full billing cycle. It demotes to weekly cold-path **only after one full cycle with zero discrepancies**, and two org classes stay in the daily tier permanently: orgs with a retention-policy change in flight or wedged (Decision 3), and any org that has ever tripped a drift alarm. The hour-over-hour tripwire remains a cheap always-on sanity check on gauge samples.

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
| Partition grain | `toYearWeek` | The unit of boundary crossing (retention-system fact) |
| Slice grain | 1 day | Entry-transit delta resolution (Decision 3) |
| Entry-query caps | `max_threads: 2`, `max_execution_time: 45` | Mandatory on every `_size_bytes` query — 2-OOM history |
| `STRIPE_BACKDATE_CEILING_HOURS` | 840 | Stripe rejects older timestamps; sweep lag alarm threshold (kept) |
| Sample cap per run | 168 hours | Bounds one sweep's hourly-row writes per org (kept) |
| MiB | 1,048,576 bytes | Sampling rounds `ceil(gaugeBytes / 1_048_576)` |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| Single-partition queries only | No query in this system scans more than one partition | Query builders take a partition key parameter — unit test asserts the partition predicate is present in generated SQL; an `EXPLAIN`-based integration test against real CH confirms pruning (a string test alone cannot — red-team F8) |
| Each hour billed exactly once | Re-dispatch, replay, crash-resume never double-bill | `reportedAt` cursor + deterministic Stripe identifier (kept reporter contract) — replay test |
| Never bill inside the included window | No row accrues before age > 35d | Daily transit predicate; rejected first-crossing option — predicate unit test |
| €0-by-construction, query-free | Retention-35d paid org bills €0 with zero CH load | Calendar: entry = exit → both skipped — calendar unit test |
| Deletion lowers the bill same hour | Erasure/project-delete/retention-lowering reflect immediately | App paths emit `−N` before deleting — erasure-flow integration test |
| Exit queries CH only for `evaluation_runs` | Physical TTL timing cannot corrupt the gauge; the one mutable-age table is re-measured, never mirrored | Exit path has no CH client except the eval-runs carve-out — fold unit test + carve-out integration test (red-team F1) |
| Idle orgs keep accruing | Stored bytes bill while the org does nothing | Platform-wide sweep samples all orgs — sweep unit test with idle-org fixture |
| One sweep per sealed hour, isolated per org | No thundering herd; no poison org fails the batch | Global dedup key `storage_sweep:<hour>`; per-org try/catch — sweep unit tests (red-team F7) |
| Replay-safe fold | Re-delivering any event changes nothing | Dedup key unique per `(project, category, partition, slice, retentionDays)`; SEED and ENTRY share the key space — idempotency test (red-team F6) |
| Sampled value never negative; negative gauge alarms | Signed deltas are legitimate (un-merged `ReplacingMergeTree` versions); a dropped billing hour is worse than a clamped one | Sample = `max(0, ceil(gauge / MiB))`; gauge below tolerance → drift alarm, never refuse-to-sample — guard test (red-team F4) |
| Past hours reconstructed by fold-to-H | A missed hour is stamped with its true historical value, never today's | Catch-up sampler folds `occurredAt ≤ H`; test: gap replay reproduces pre-gap values (red-team F3) |
| Drift detected, never silently fixed | Every correction is operator-visible | Reconciliation (daily tier at rollout) alarms; test: corrective gauge writes outside the re-seed path are rejected (red-team F8) |

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
  edge           String   // ENTRY | EXIT | DELETION | SEED — audit only, NOT part of the dedup key
  deltaBytes     BigInt   // signed; BigInt per the #4832 overflow lesson
  dedupKey       String   @unique // (project, category, partition, slice, retentionDays); SEED/ENTRY share the space
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
- **Excluding `evaluation_runs` from billing** — free eval bytes vs. paid trace bytes is an unjustifiable asymmetry.
- **Reconciliation-only deletion tracking** — erased customers keep billing up to a week; GDPR optics.
- **Own-events-only closure** — under-bills idle orgs, contradicting the product being billed.
- **Auto-corrected drift** — invoice lines no operator saw.
- **Cold-path reconciliation from day 1** — residual leak classes compound silently between weekly runs exactly when the code is newest.
- **Salvage the predecessor's PR stack** — rejected by decision owner; clean re-implementation wins.
- **Direct boundary-event → Stripe reporting / monthly reporting** — breaks the GiB-hours integral / reintroduces the end-of-period fragility the pricing model was designed to avoid.
- **Reopen pricing** — no commercial driver; multiplies blast radius.

## Consequences

**Positive.** The OOM query shape is eliminated from the system (not mitigated — absent, including at seeding). Per-hour cost drops from O(org backlog) to O(1) gauge read; ClickHouse load becomes ≤ 1 bounded query per org-partition-day during transits (plus one per exiting `evaluation_runs` partition). Deletion is reflected in-invoice immediately. Idle orgs bill correctly. Every invoice line traces to hourly rows, which trace to signed, replayable, individually-auditable boundary events.

**Negative.** New machinery: boundary calendar, transit-delta emitter, fold projection, sweep reactor, seeding runbook — all net-new code where the old design was "one query." The fold is fragile-by-construction against missed events; reconciliation therefore starts load-bearing (daily, per-org) and only earns its demotion after a clean billing cycle. Late-arriving rows into an already-crossed partition slice under-bill until reconciliation notices (bounded by ingest-pipeline latency; accepted). The events table is a growing audit trail needing a lifecycle plan. The entire built-but-unmerged predecessor stack is discarded as code.

**Neutral.** ClickHouse TTL behavior, retention semantics, pricing, the Stripe surface, and the hourly-row reporting contract are all unchanged. The billable-events meter is untouched.

## Open questions

| Question | Owner | Blocking? |
|---|---|---|
| ⚠️ `evaluation_runs` measured-exit carve-out — re-review against the then-current schema **before implementation merges** (decision-owner flag) | Decision owner, at implementation review | **Yes — merge gate** |
| Events-table lifecycle (archival/partitioning for the low-millions-rows/year audit trail) | Implementation phase | No |
| Sweep batch sizes / dedup TTLs (tunables within the Decision-5 invariants) | Implementation phase | No |
| Late-arrival drift tolerance before alarming (reconciliation threshold) | First shadow-mode rollout | No |
| Platform-outage > 840h: Stripe `meterEventAdjustments` runbook (carried from the predecessor) | Ops, at wire-up phase | No |
| Category enumeration for the boundary calendar (11 tables → category map reuse from `retentionPolicy.schema`) | Implementation phase | No |

## Revisions

- **v1 (2026-07-09).** Initial draft (as ADR-035, PR #5597): ingest-fold + expiry events, TTL-untouched, no-cron.
- **v2 (2026-07-09, renumbered 039; 035 was taken).** Parc-fermé pass. Framing round: scope widened to full storage-billing redesign; blast radius locked to customer invoices; constraints re-confirmed (no-cron, TTL-untouched, billable-events-out) — pricing/reporting deliberately NOT carried over as assumptions. Fork round 1: **boundary-edge fold** replaces the v1 ingest-fold (v1 defect: it billed the not-yet-billable newest 35 days); pricing and hourly reporting **re-locked unchanged**; gauge store = Postgres/ES. Fork round 2: seeding = retroactive per-partition entry events; manual deletions emit; idle closure = platform-wide deduped sweep; **stack fate = close-all** (salvage map recommended, overruled by decision owner). Fork round 3: entry grain = **daily transit deltas** (whole-partition options rejected on ±25% revenue / dispute-surface grounds); exit = query-free mirror of entry deltas; drift response = alarm + manual re-seed.
- **v3 (2026-07-10).** Red-team pass (8 findings, 2 reopened locked forks — both re-asked, not silently re-decided). F1 (verified in code): `evaluation_runs` partitions on mutable `UpdatedAt` → exit-mirror premise false for it → **measured-exit carve-out**, locked with a decision-owner **review-before-merge gate**. Reconciliation posture re-decided: **load-bearing daily until one clean billing cycle**, retention-changed and previously-drifted orgs stay daily permanently (was: cold-path from day 1). Folded as specification: F2 reverse-then-emit retention-change protocol + wedged-mutation flagging; F3 fold-to-H catch-up sampling; F4 signed deltas + clamp-at-sampling (never refuse); F5 event-volume correction (~100× the naive estimate) + lifecycle open question; F6 SEED/ENTRY shared dedup key space + hard per-partition cutover; F7 sweep debounce/isolation/priority promoted from tunables to invariants; F8 test anchors made actually testable. Also this revision: all cross-ADR references removed so the document stands alone (predecessor cited only in the Supersedes line).
