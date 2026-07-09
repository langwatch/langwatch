# ADR-039: Storage billing derives billable bytes from a boundary-event fold, never a backlog resum

**Date:** 2026-07-09

**Status:** Proposed

**Supersedes:** [ADR-027](./027-storage-gb-billing.md)'s measurement and dispatch strategy (Phases 2, 4, 4.5). ADR-027's pricing model, 35-day billing cutoff, hourly-additive Stripe reporting protocol, and `StorageUsageHourly` contract were re-examined in this revision and **re-locked unchanged** — they are restated here as kept decisions, not silently inherited.

> One-line: bill **GiB-hours** by folding **signed partition-boundary events** (daily transit deltas at the **35-day entry** edge, query-free mirrors at the **retention exit** edge) into a per-org **Postgres gauge**, sampled hourly into `StorageUsageHourly` — **no query ever scans more than one partition**, and ClickHouse-native TTL is never hooked, delayed, or replaced.

## Context

ADR-027 Phase 2 measures each org's billable bytes by re-running, per sealed hour:

```sql
SELECT sum(_size_bytes) FROM <table>
WHERE TenantId = {tenantId} AND <age col> <= {cutoff}   -- rows aged > 35d
```

unioned across the 11 retention-managed tables (ADR-022). This resums the org's **entire historical backlog** every hour, even when nothing changed. `_size_bytes` aggregation at this shape caused **two production OOM incidents**; Phase 2/4's mitigations (`max_threads: 2`, 45s timeout, degrade paths) manage the cost but the query shape — O(org's total backlog), hourly, forever — remains the root cause. Because the resulting number is a cached snapshot that nothing structurally re-verifies, ADR-027 needed a measure-time tripwire (Phase 4.5) and a reconciliation job (Phase 7) as **load-bearing** safety nets.

Separately, ClickHouse's native TTL deletion is invisible to the application by design: no row/org-level introspection exists ([ClickHouse#10128](https://github.com/ClickHouse/ClickHouse/issues/10128)); `system.part_log`'s `TTLDeleteMerge` tag is part-level with no byte attribution. Any design requiring TTL to announce what it deleted is a dead end.

Forces, as confirmed at framing:

1. **Full redesign scope.** Everything in storage billing was on the table — pricing, reporting, measurement, dispatch, reconciliation. (Pricing and reporting were then re-locked unchanged; see Decisions 1–2.)
2. **Forcing function:** the ADR-027 stack (#4832, #5158, #5225, #5227 + merged #5228/#5246) is fully built but **zero of it is merged to main** — a strategy swap is only cheap right now.
3. **Blast radius: customer invoices.** A wrong gauge silently mis-bills real money. Full rigor: invariants with test anchors, red-team pass mandatory.
4. **Hard constraints (locked):** no cron/scheduler ever — every time-boundary action is triggered by real events through the existing event-sourcing pipeline, made safe by dedup; ClickHouse-native TTL stays untouched; the billable-events meter is out of scope.

Key structural facts the design exploits (ADR-022): retention tables are partitioned by `toYearWeek`, rows carry `_retention_days` (per-tenant, per-category), and the billing cutoff `BILLABLE_AFTER_DAYS = 35` is a clean week-partition boundary. **Retention is deterministic — every row's entry into and exit from the billable window is knowable in advance.**

## Decision

### 1. Pricing: keep ADR-027's model unchanged (re-locked)

€3/GiB-month in binary units, 35-day included window, GiB-hours integral via an hourly-additive Stripe `sum` meter. The measurement swap does not invalidate any of the research behind it (competitor matrix, Stripe meter mechanics — vault `EPIC/Q2/data-retention/reporting-stripe/`), the Stripe catalog entries, or the €0-by-construction story. Reopening pricing was considered and rejected: it multiplies blast radius for no commercial driver.

### 2. Reporting: keep the hourly-row + reporter protocol unchanged (re-locked)

The gauge is sampled once per sealed UTC hour into `StorageUsageHourly` (one row per org per hour, MiB, `reportedAt` cursor); a reporting command consumes rows exactly as ADR-027 Phase 3 specified — idempotent per-hour cursor, deterministic Stripe identifier (`storage_mb:<org>:<hourISO>`), additive delivery, circuit breaker. Downstream of the hourly row, **nothing changes**: the invoice line remains `SELECT sum(megabytes)` over the period — the per-hour audit trail every invoice traces back to.

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

  The delta vs. the previous day's measurement is emitted as one `+N` event per `(project, category, partition, sliceDate, retentionDays)`. ≤ 8 bounded queries per partition lifetime. Accuracy ~1 day (≈1.8% under vs. exact, always customer-favorable). A partition past the 35-day line is **immutable** (new writes don't land in 35-day-old data), so entry measurement can never race TTL — for every retention > 35, the exit boundary is strictly later.

  *Rejected:* whole-partition event at full crossing (simplest, but bills 21 of 28 billable days for a retention-63d org — a permanent ~25% under-bill); whole-partition at first crossing (bills rows still inside the included window — a dispute surface contradicting the €0-by-construction promise); the ingest-fold from this ADR's own first draft (folds *total* bytes, not billable bytes — it would bill data from day 0, over-billing every org's newest 35 days).

- **Exit** — rows cross their retention line and TTL becomes entitled to delete them. **No query, ever:** because in-window data is immutable, the exit deltas are exactly the recorded entry deltas for that `(partition, retentionDays)` group, negated and shifted by `(retentionDays − 35)` days. Emitting `−N` from the stored `+N` makes exit **immune to physical TTL timing** — the bill follows the customer's retention *entitlement*, not ClickHouse's merge schedule, so a TTL merge running early, late, or during an app outage cannot corrupt the gauge.

- **Manual deletion** — GDPR erasure, project deletion, and retention-policy *lowering* are all app-driven, so they emit: erasure/project-deletion paths measure the affected in-window bytes (partition-scoped queries) and emit `−N` **before** deleting; a retention change recomputes the boundary calendar and emits the difference. Deletion lowers the invoice the same hour — the customer-facing promise ADR-027 made, kept in real time rather than at the next reconciliation.

Special cases falling out of the calendar: retention < 35d (free tier) → rows die before ever billable, zero events; retention = 35d (paid default) → entry and exit coincide, net 0, both edges skipped — **€0-by-construction needs no query at all**.

### 4. Storage: Postgres, through the existing event-sourcing pipeline

Boundary events are commands through the existing ES pipeline into Postgres; the gauge is a materialized per-org row maintained by the fold. Volumes are trivial (~2 events per org-partition-week). ACID writes + the transactional-outbox posture (ADR-030) give the durability the money path needs; replay-safety comes from per-event dedup keys. *Rejected:* a ClickHouse fold projection (ADR-034 style) — it would put the billing-critical number inside the same store whose deletion behavior we're insulating against, with no transactional emit guarantee.

### 5. Dispatch: event-triggered, with a platform-wide deduped sweep (no cron)

Ingest events remain pure wake-ups. Any event from **any** org triggers a cheap, deduped, batch-bounded sweep: "which orgs have boundary crossings due or sealed hours unsampled?" — ambient platform traffic substitutes for a clock, per the locked no-cron constraint. This deliberately **widens** ADR-027's trigger (an org's own events only), because an idle org's stored data keeps accruing GiB-hours — storage cost while idle is precisely the product being billed. A fully idle platform (zero events from anyone) has no trigger; accepted, as ADR-027 already accepted for its grace period. *Rejected:* own-events-only (systematically under-bills exactly the orgs whose retained storage is their whole bill).

### 6. Seeding: retroactive entry events, never a backlog scan

At rollout (and at gauge re-seed), initialization replays the entry edge over history: enumerate each existing in-window partition, run the same bounded per-partition query, emit synthetic entry events. Same code path as steady state; the full-backlog OOM query shape is never run — not even once. Flag-gated and throttled per org. *Rejected:* one-time full-backlog seed (the OOM shape, once, needing all of ADR-027's cap machinery for a single use); forward-only from zero (permanently under-bills every existing customer's already-old data).

### 7. Safety nets demoted; drift response is manual

Reconciliation (gauge vs. bounded per-partition reference sums, and reported totals vs. Stripe) and the hour-over-hour tripwire remain as **cold-path audits**, no longer load-bearing — the gauge cannot silently diverge from a query it never re-runs. On detected drift (fold bug, missed event, late-arriving rows into an in-window partition): **alarm + operator-run re-seed** for that org via the Decision-6 path. **No automated correction** — a silent corrective event on a billing gauge is an invoice line no operator ever saw. *Rejected:* auto-correct under a threshold (the threshold becomes an untended tunable; matches nothing else on this money path).

### 8. The ADR-027 stack is closed, not salvaged

All open stack PRs (#4832, #5158, #5225, #5227; #5228/#5246 already merged into #5227's branch) are **closed and re-implemented** against this ADR. A salvage map (merge the schema + reporter PRs, rework the dispatcher in place) was evaluated and **rejected by the decision owner** in favor of clean re-implementation: no risk of superseded assumptions leaking through review-approved code. Carried forward as *specifications*, not code: the `StorageUsageHourly` + reporter contract (Decision 2), the pricing contract, the lock-fencing / orphan-heal / Sentry-escalation review findings from #5227 (they apply to any dispatcher), and the BigInt-not-Int lesson from #4832.

## Constants

| Name | Value | Purpose |
|---|---|---|
| `BILLABLE_AFTER_DAYS` | 35 | Included window; entry-edge cutoff. Clean `toYearWeek` boundary (ADR-027, kept) |
| Price | €3 / GiB-month, 30-day convention | €3 / 30 / 24 / 1024 ≈ €0.00000407 per MiB-hour (ADR-027, kept) |
| Meter event | `langwatch_storage_megabytes_hourly` | Stripe `sum` meter, additive integer MiB (ADR-027, kept) |
| Stripe identifier | `storage_mb:<orgId>:<hour ISO, hour precision>` | Deterministic per-hour idempotency (ADR-027, kept) |
| Partition grain | `toYearWeek` | The unit of boundary crossing (ADR-022, fact) |
| Slice grain | 1 day | Entry-transit delta resolution (Decision 3) |
| Entry-query caps | `max_threads: 2`, `max_execution_time: 45` | Mandatory on every `_size_bytes` query — 2-OOM history |
| `STRIPE_BACKDATE_CEILING_HOURS` | 840 | Stripe rejects older timestamps; sweep lag alarm threshold (ADR-027, kept) |
| Sample cap per run | 168 hours | Bounds one sweep's hourly-row writes per org (ADR-027, kept) |
| MiB | 1,048,576 bytes | Sampling rounds `ceil(gaugeBytes / 1_048_576)` |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| Single-partition queries only | No query in this system scans more than one partition | Entry/seed/deletion query builders take a partition key parameter — unit test asserts the generated SQL prunes |
| Each hour billed exactly once | Re-dispatch, replay, crash-resume never double-bill | `reportedAt` cursor + deterministic Stripe identifier (kept reporter contract) — replay test |
| Never bill inside the included window | No row accrues before age > 35d | Daily transit predicate; rejected first-crossing option — predicate unit test |
| €0-by-construction, query-free | Retention-35d paid org bills €0 with zero CH load | Calendar: entry = exit → both skipped — calendar unit test |
| Deletion lowers the bill same hour | Erasure/project-delete/retention-lowering reflect immediately | App paths emit `−N` before deleting — erasure-flow integration test |
| Exit never touches ClickHouse | Physical TTL timing cannot corrupt the gauge | Exit events derived from stored entry events — fold unit test, no CH client in the exit path |
| Idle orgs keep accruing | Stored bytes bill while the org does nothing | Platform-wide sweep samples all orgs — sweep unit test with idle-org fixture |
| Replay-safe fold | Re-delivering any event changes nothing | Dedup key unique per `(project, category, partition, slice, retentionDays, edge)` — idempotency test |
| Gauge never negative | A negative gauge is a fold bug, not a bill | Alarm + refuse-to-sample below zero — guard test |
| Drift detected, never silently fixed | Every correction is operator-visible | Reconciliation alarms; corrections only via re-seed runbook |

## Schema

```prisma
// Signed boundary events — the fold's source of truth. One row per
// (project, category, week-partition, day-slice, retention-group, edge).
model StorageBoundaryEvent {
  id             String   @id @default(cuid())
  organizationId String
  projectId      String
  category       String   // retention category (ADR-022 table category)
  partitionKey   String   // toYearWeek, e.g. "202625"
  sliceDate      DateTime // the day-slice this delta covers
  retentionDays  Int      // _retention_days of the rows in this delta
  edge           String   // ENTRY | EXIT | DELETION | SEED
  deltaBytes     BigInt   // signed; BigInt per the #4832 overflow lesson
  dedupKey       String   @unique // replay-safety
  occurredAt     DateTime // the boundary instant this delta takes effect
  createdAt      DateTime @default(now())

  @@index([organizationId, occurredAt])
}

// Materialized fold result — one row per org, O(1) hourly sampling.
model StorageBillableGauge {
  organizationId String   @id
  billableBytes  BigInt
  lastEventAt    DateTime
  updatedAt      DateTime @updatedAt
}

// StorageUsageHourly — UNCHANGED contract from ADR-027 (kept, Decision 2):
// (organizationId, sealedHour) PK, megabytes Int, reportedAt cursor, index on reportedAt.

// StorageBillingCheckpoint — re-implemented LEAN: (organizationId, billingMonth)
// unique, consecutiveFailures Int only. The lastReportedTotal/pendingReportedTotal
// accumulator columns from #4832 were dead code under per-hour reporting; they
// are not carried into the re-implementation.
```

## Rejected alternatives

- **Per-hour full-backlog resum, tuned harder** (ADR-027 status quo) — OOM stays a permanently managed cost; safety nets stay load-bearing.
- **Ingest-fold gauge** (this ADR's own first draft) — folds total bytes, not billable bytes; over-bills the newest 35 days of every org's data.
- **Whole-partition entry at full crossing** — ~25% systematic under-bill at retention 63d.
- **Whole-partition entry at first crossing** — bills inside the included window; dispute surface.
- **ClickHouse fold store** — billing number inside the store whose deletion semantics we're insulating against.
- **Full-backlog seed** — the OOM shape, run once; **forward-only seed** — permanent under-bill of existing data.
- **Reconciliation-only deletion tracking** — erased customers keep billing up to a week; GDPR optics.
- **Own-events-only closure** — under-bills idle orgs, contradicting the product being billed.
- **Auto-corrected drift** — invoice lines no operator saw.
- **Salvage the ADR-027 stack** — rejected by decision owner; clean re-implementation wins.
- **Direct boundary-event → Stripe reporting / monthly reporting** — breaks the GiB-hours integral / reintroduces end-of-period fragility ADR-027 rejected.
- **Reopen pricing** — no commercial driver; multiplies blast radius.

## Consequences

**Positive.** The OOM query shape is eliminated from the system (not mitigated — absent, including at seeding). Per-hour cost drops from O(org backlog) to O(1) gauge read; ClickHouse load becomes ≤ 1 bounded query per org-partition-day during transits only. Tripwire + reconciliation demote to cold-path audit. Deletion is reflected in-invoice immediately. Idle orgs bill correctly. Every invoice line traces to hourly rows, which trace to signed, replayable, individually-auditable boundary events.

**Negative.** New machinery: boundary calendar, transit-delta emitter, fold projection, sweep reactor, seeding runbook — all net-new code where ADR-027 Phase 2 was "one query." The fold is fragile-by-construction against missed events (mitigated by dedup + outbox + reconciliation, response manual by design). Late-arriving rows into an already-crossed partition slice under-bill until reconciliation notices (bounded by ingest-pipeline latency; accepted). The entire built-but-unmerged ADR-027 stack is discarded as code.

**Neutral.** ClickHouse TTL behavior, retention semantics (ADR-022), pricing, Stripe surface, and the hourly-row reporting contract are all unchanged. Billable-events is untouched.

## Open questions

| Question | Owner | Blocking? |
|---|---|---|
| Sweep batch sizes / dedup TTLs (tunables) | Implementation phase | No |
| Late-arrival drift tolerance before alarming (reconciliation threshold) | First shadow-mode rollout | No |
| Platform-outage > 840h: `meterEventAdjustments` runbook (carried from ADR-027) | Ops, at wire-up phase | No |
| Category enumeration for the boundary calendar (11 tables → category map reuse from `retentionPolicy.schema`) | Implementation phase | No |

## Revisions

- **v1 (2026-07-09).** Initial draft (as ADR-035, PR #5597): ingest-fold + expiry events, TTL-untouched, no-cron.
- **v2 (2026-07-09, this document — renumbered 039; 035 was taken).** Parc-fermé pass. Framing round: scope widened to full storage-billing redesign; blast radius locked to customer invoices; constraints re-confirmed (no-cron, TTL-untouched, billable-events-out) — pricing/reporting deliberately NOT carried over as assumptions. Fork round 1: **boundary-edge fold** replaces the v1 ingest-fold (v1 defect: it billed the not-yet-billable newest 35 days); pricing and hourly reporting **re-locked unchanged**; gauge store = Postgres/ES. Fork round 2: seeding = retroactive per-partition entry events; manual deletions emit; idle closure = platform-wide deduped sweep; **stack fate = close-all** (salvage map recommended, overruled by decision owner). Fork round 3: entry grain = **daily transit deltas** (whole-partition options rejected on ±25% revenue / dispute-surface grounds); exit = query-free mirror of entry deltas; drift response = alarm + manual re-seed.
