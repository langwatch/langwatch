# ADR-027: Per-organization stored-GiB-hours billing to Stripe via global event-sourced projection

**Date:** 2026-06-11

**Status:** Proposed

> One-line: bill **GiB-hours of stored bytes aged beyond the 35-day included window** (5 weeks — see "Billing cutoff" below), sampled per **sealed UTC hour** by a **global event-sourced projection**, reported additively to a **`sum`-formula Stripe meter**. Ingestion (flow) billing is explicitly rejected. No "current DB" snapshots — each sealed-window ClickHouse query is anchored to a past hour, not `now()`.

## Context

[ADR-022](./022-data-retention.md) enforces per-tenant retention with `_retention_days` and `_size_bytes` stamped at ingest and ClickHouse-native TTL doing deletion. That decides *what we delete and when*. It does not decide *what we charge for keeping data alive*. This ADR decides the billing axis.

The commercial model being encoded: **every paid plan includes 35 days of retention for free; keeping data longer (42/49/63/90/custom) is the paid feature, billed at €3/GiB-month for the bytes that live beyond 35 days.** A paid customer on the default keep deletes at 35 days and pays nothing; only retention raised above 35 accrues. The allowance is time-based (a byte's first 35 days are free), never volume-based — there is no "first N GiB free".

> **Billing cutoff (decision 2026-06-26).** `BILLABLE_AFTER_DAYS = 35` (5 weeks). 35 is a clean `toYearWeek` partition boundary, so the cutoff prunes cleanly and a default-keep org's data is deleted right at the boundary → €0 *by construction*. **Coupled change:** this requires the **paid minimum retention to drop from 49 → 35 days** (`MIN_RETENTION_DAYS`); the billing model is only €0-by-default if a paid customer *can* select 35. That retention-floor change ships with this billing work, not separately. The free tier is unaffected — it keeps its own 14-day window (held + recoverable to 21d, the #4745 flow), and is never metered.

Forces shaping the design:

1. **Deletion must lower the bill by construction.** If we report X GB and retention later deletes Y, the invoice cannot leave the customer wondering whether they paid for X or X−Y. The model has to answer that with no rebate logic and no dispute surface. Industry converged on time-weighted GiB-hours for exactly this reason (AWS S3, GCS, R2, Snowflake, OpenObserve).

2. **Incremental reporting, not end-of-period.** A single monthly report is fragile: it can fail, and data arriving (or deleted) one minute before period close distorts it. Continuous hourly accrual makes every hour independently correct and independently retryable. All billing logic lives on our side; Stripe only ever receives "org X, hour H, N MiB".

3. **We already run a meter → Stripe pipeline.** `langwatch_billable_events` ships today: event-sourced `billing-reporting` pipeline (`src/server/event-sourcing/pipelines/billing-reporting/`), two-phase checkpoint with circuit-breaker, idempotent identifiers, SaaS gate. `StripeUsageReportingService` (`ee/billing/services/usageReportingService.ts`) speaks the modern `stripe.billing.meterEvents.create` API. Building parallel infrastructure would be wasted.

4. **We already measure stored bytes.** `StorageMeterService` (`src/server/data-retention/metering/storageMeter.service.ts`) returns `sum(_size_bytes)` across the 11 retention-managed tables per `TenantId`. The `_size_bytes` MATERIALIZED column landed in migration 00032.

5. **Multi-instance + zero customer disruption.** LangWatch runs N k8s replicas; the dispatcher must be single-processing across pods (inherited from the event-sourcing dispatch model, [ADR-007](./007-event-sourcing-architecture.md)). Rollout must not require re-checkout, change the `subscription_id`, or alter the billing cycle.

6. **Real customer base at go-live.** ~100 existing customers carry retention policies of 45/90/180 days — i.e. real beyond-35-day data exists the moment metering starts. Enterprises may run different retention policies per project within one organization (e.g. 4 months / 1 year / 5 years).

## Decision

We will bill **per-organization stored-bytes-aged-beyond-30-days, integrated over hourly sealed windows, summed across the billing period, in binary GiB at €3/GiB-month using a 30-day-month convention**. One Stripe meter event per organization per sealed UTC hour, value sent additively (`reportUsageDelta`) into a new `STORAGE_GB` meter with `default_aggregation.formula = "sum"`.

The hourly cadence + sum aggregation produces a true GiB-hours integral: period total ÷ 24 = GiB-days, ÷ 720 = GiB-months. The Stripe Price encodes the conversion at €3 / 30 / 24 / 1024 per MiB-hour.

Six load-bearing choices:

### 1. Measurement: sealed-window ClickHouse query, anchored to the sealed hour

For sealed hour H, the projection queries per managed table:

```sql
SELECT sum(_size_bytes)
FROM <managed_table>
WHERE TenantId IN (<projects of org>)
  AND <retentionCol> <= dateSub(HOUR, BILLABLE_AFTER_DAYS * 24, toDateTime(H))   -- 35 days (5 weeks)
```

The cutoff is anchored to **H**, not `now()`. For a same-hour sample the two are equivalent; for a catch-up sample of a past hour they differ by the gap, and the H-anchor makes the measurement consistent with what a same-hour sampler would have captured (modulo TTL-eviction of far-edge rows in large gaps).

`_retention_days` plays **no role in the predicate** — we measure row age, not the customer's configured TTL. A custom-retention customer's billable surface is exactly "rows still present that are older than the billing cutoff (35d)". This also handles per-project retention diversity within one org for free: the org bill is the sum across its projects, and a 5-year-retention project simply contributes more old rows than a 4-month one. One meter, one invoice line, naturally weighted.

### 2. Granularity: sealed UTC hour

`H = floor(eventTimestamp, HOUR)` in UTC. The projection's per-org cursor advances when an incoming event's hour crosses the stored boundary; a gap-fill loop emits one measurement per missing sealed hour, bounded by `STORAGE_BACKFILL_MAX_HOURS = 840` (35 days, Stripe's `timestamp` ceiling).

Hourly (vs daily) costs 24× the meter-event volume — negligible against Stripe's 1,000 events/sec limit — and ~720 audit rows/org/month in Postgres. It buys within-day fidelity: a write-then-delete inside one day still accrues the hours it lived, where daily sampling would miss it entirely.

### 3. Dispatcher: global event-sourced projection — no cron, no leader lock

Clone-pattern of `billingMeterDispatch.reactor.ts`. State: in-memory `Map<orgId, lastSealedHour>`, rehydrated from `StorageUsageHourly` on projection start. On every event with an orgId attribution:

```
eventHour = floor(event.timestamp, HOUR)  // UTC
last = state[orgId] ?? earliest unreported hour from StorageUsageHourly
if eventHour > last:
   for h in (last+1 .. eventHour-1):           // inclusive of gaps
      bytes_h = getBillableStorageBytesForOrgAt(orgId, sealedHour=h)
      megabytes = ceil(bytes_h / 1_048_576)
      INSERT StorageUsageHourly(orgId, sealedHour=h, megabytes)
         ON CONFLICT (orgId, sealedHour) DO NOTHING
      enqueue ReportStorageForHourCommand(orgId, h, megabytes)
   state[orgId] = eventHour
```

Cross-pod single-processing is inherited from the event-sourcing **GroupQueue** dispatch — a custom Redis-primitive queue (**not** BullMQ; the queue's ARCHITECTURE.md was corrected in PR #4999). Three Redis mechanisms deliver it, no separate leader lock and no interval constants: (1) a per-group FIFO list + atomic `DISPATCH_LUA LPOP` dispatches each staged job to exactly one worker; (2) a `{queue}:active:{groupId}` TTL marker admits one worker per group at a time and self-heals on crash when the TTL expires; (3) **process roles** — `web` pods stage but never process, `worker` pods stage and process. Reactor-level dedup is `makeJobId` + TTL; the command pipeline's `deduplication.makeId = ${orgId}:${sealedHour}` (`ttlMs > delay`) is the job-level idempotency layer. A `runIn:["worker"]` global reactor registered in the `EventSourcing` constructor auto-runs on the GroupQueue worker — no `workers.ts` wiring. One operational model for the billable-events and storage meters.

The projection short-circuits for orgs that are not SaaS-billable (no `stripeCustomerId` / no active subscription / no `STORAGE_GB` SubscriptionItem) — those orgs generate zero queries, zero rows, zero Stripe calls.

**Payload contract (PR #4999):** the enqueued `ReportStorageForHourCommand` payload uses plain keys only (`organizationId`, `sealedHour`, `megabytes`) — the `__*` namespace is reserved for queue machinery and the send boundary throws on it.

**Operability — kill switch + flag.** The measure+enqueue is gated behind a registered `release_storage_billing_metering` PRODUCT feature flag (default OFF), and a registered reactor additionally gets a cluster-wide `es-…-killswitch` for free. Either lets an operator stop the hourly `sum(_size_bytes)` sweep without a deploy or a Stripe change — a deliberate guardrail given that `_size_bytes` aggregation has caused prod OOM outages.

### 4. Reporting command: `ReportStorageForHourCommand` (two-phase, idempotent)

Clones `reportUsageForMonth.command.ts`:

```
1. Mark in-flight on StorageBillingCheckpoint(orgId, billingMonth=monthOf(h)) via StorageBillingCheckpointService
2. usageReportingService.reportUsageDelta({ events: [{
     eventName: "langwatch_storage_megabytes_hourly",
     value: row.megabytes,                       // additive, integer MiB
     timestamp: utcStartOf(row.sealedHour),
     identifier: `storage_mb:${orgId}:${isoHour(row.sealedHour)}`,
   }] })
3. UPDATE StorageUsageHourly SET reportedAt = now() WHERE orgId AND sealedHour
4. Confirm checkpoint
```

Period total on the Stripe side = Σ `megabytes` = MiB-hours. The additive-delta shape is load-bearing: `reportUsageSet` (current − previously-reported) telescopes to the *final* value on a `sum` meter — a last-value gauge in disguise, gameable by deleting on day 29. The raw hourly value sent additively is the integral; deletion lowers the *next* hour's contribution, never an already-billed one.

### 5. Customer matrix

| Customer | Custom retention | Retention reality | SubscriptionItem | Bill |
|---|---|---|---|---|
| **SaaS Free** | ✗ | 14-day window; data held then blurred + recoverable to 21d (upgrade-to-recover, #4745) | **None — not attached** | €0; projection skips entirely |
| **SaaS Paid** | ✓ (35d included; opt into 42/49/63/90/…) | Retention setting controls deletion | `STORAGE_GB` Price for plan × currency | €3/GiB-month × bytes aged > 35d. Orgs on the default 35d keep bill €0 *by construction* — TTL deletes every row at day 35. Only retention raised above 35 accrues. (Requires paid `MIN_RETENTION_DAYS` = 35.) |
| **SaaS Enterprise** | ✓ custom, per-project policies allowed | Custom | Custom Price on the same `STORAGE_GB` meter | Negotiated rate; same projection, same pipeline |
| **Self-hosted licensed** | ✓ **unlocked by the license** | Their infra, their disk | **None — never metered** | €0 — we do not host their data; the license gates the *feature*, not billing |
| **Self-hosted unlicensed** | ✗ | Platform default only | None | €0 |

**License = feature gate, not billing.** License holders get retention feature parity with Paid but are never attached to the storage meter. The entire pipeline (projection, command, audit table, catalog) is EE-only; OSS keeps only the existing `StorageMeterService` for the retention UI.

**Go-live is forward-only.** Metering starts at the projection's first sealed hour; no backbilling of past months. Existing customers holding beyond-35-day data start accruing from go-live — the customer notice must state this explicitly, and the SubscriptionItem backfill runs only after the notice, on the announced date.

### 6. Pricing: €3/GiB-month, binary, 30-day convention, single flat rate

```
unit_amount_decimal = €3 / 30 days / 24 hours / 1024 MiB-per-GiB
                    ≈ €0.00000407 per MiB-hour
                    = €0.10 per GiB-day
```

**Unit vocabulary:** all quantities are binary — values are MiB (`bytes / 1_048_576`), prices are per GiB (1024 MiB). Identifier names (`STORAGE_GB` meter, `storage_mb:` prefix, `megabytes` columns) use GB/MB as opaque labels only — renaming Stripe meters later is painful, so the labels stay and this line is the contract. Marketing copy must say GiB or accept the ~2.4% decimal-GB gap.

Stripe Price `unit_amount_decimal` is static — one fixed number applied to the period's summed MiB-hours. Holding 1 GiB all month therefore bills €3.10 in 31-day months, €2.80 in February, €3.00 in 30-day months (the AWS S3 / R2 convention; marketing copy must say so or switch to a flat per-day headline). Partial periods bill proportionally by construction.

The retention length chosen (60 vs 90) does **not** change the unit price — longer retention costs more naturally because more bytes live longer (more GiB-hours). One meter, one rate per plan; Enterprise rates are separate Prices on the same meter.

**Logical bytes, not compressed disk (deliberate).** `_size_bytes` is `byteSize()` of the payload columns — the **uncompressed logical** size of the data, not its ZSTD-compressed on-disk footprint (typically 5–10× smaller). We bill the **logical/real value** the customer's data represents, not what it costs us to store after compression. The €3/GiB-month is therefore calibrated against logical GiB; this is the priced unit and the contract. (Ingestion cost we incur — and any 1 TB-then-deleted gaming surface — is covered separately by the `billable_events` meter; stored-GiB billing is strictly about retained logical volume.)

## Schema

One **purely additive** Prisma migration, two new tables. The billable-events
checkpoint (`BillingMeterCheckpoint`) is left untouched — storage billing owns
its own persistence rather than mutating a live billing table:

```prisma
// (1) Durable per-hour measurement. The reporter drains reportedAt IS NULL
// and stamps on success. Per-hour audit trail + cursor for catch-up.
model StorageUsageHourly {
  organizationId String
  sealedHour     DateTime  // UTC, truncated to hour
  megabytes      Int       // ceil(bytes / 1_048_576), measured at sample time
  reportedAt     DateTime?
  createdAt      DateTime  @default(now())
  @@id([organizationId, sealedHour])
  @@index([reportedAt])
}

// (2) Dedicated two-phase reporting checkpoint for the STORAGE_GB meter — a
// sibling of BillingMeterCheckpoint, owned by StorageBillingCheckpointService.
model StorageBillingCheckpoint {
  id                   String   @id @default(cuid())
  organizationId       String
  billingMonth         String   // "2026-02"
  lastReportedTotal    Int      @default(0)
  pendingReportedTotal Int?     // non-null = in-flight Stripe call
  consecutiveFailures  Int      @default(0)
  updatedAt            DateTime @updatedAt
  @@unique([organizationId, billingMonth])
}
```

**Separate checkpoint table, not a `meterName` discriminator.** An earlier draft
discriminated `BillingMeterCheckpoint` by meter and swapped its unique index.
Rejected: that drops a unique index on a *live* billing table and forces the
billable-events command + tests to change to make room for a sibling meter. A
dedicated `StorageBillingCheckpoint` + `StorageBillingCheckpointService` makes
the migration purely additive (no `DROP INDEX`, no `ALTER` on existing tables),
keeps the billable-events path byte-for-byte unchanged, and gives each meter
clear ownership of its own persistence. The minor cost — a second near-identical
checkpoint table/service — is accepted; the two meters evolve independently.

The audit table is the load-bearing fix for catch-up correctness: `StorageMeterService` is a stock read with no time-travel, so persisting each measured value per hour decouples *measurement* from *Stripe availability* — the reporter can stall and resume without re-measuring (and without re-billing).

No ClickHouse migration; `_size_bytes` exists.

`stripeCatalog.json` gains a `STORAGE_GB` meter entry plus one metered Price per (plan × currency × interval); `STRIPE_METER_NAMES` / `STRIPE_PRICE_NAMES` in `stripePrices.types.ts` get the new entries.

## Invariants

| Invariant | Meaning | How satisfied |
|---|---|---|
| **Idempotent** | Replays don't change totals | Deterministic `identifier = storage_mb:${orgId}:${isoHour}` (Stripe dedups ~24h) + `StorageUsageHourly.reportedAt` cursor for cross-day dedup. Same hour sent twice = one billed event. |
| **Deterministic (as-of sealed hour)** | Same source state → same answer | Rows are measured once; the reporter never re-measures. The CH predicate anchors to the sealed hour, not `now()`. Holds modulo TTL-eviction of far-edge rows in >35-day gaps. |
| **Explainable** | Invoice traces to raw measurements | `SELECT sealedHour, megabytes, reportedAt FROM "StorageUsageHourly" WHERE organizationId = $1 AND sealedHour BETWEEN $a AND $b` — the invoice line is the sum of that column. |
| **Drift-guarded** | The measured value can't silently diverge | Two guards, mirroring the ADR-034 analytics pattern (PR #5012): a **parity test** ("default-retention org reports 0"; "measured GiB-hours == reference `SUM` over the source") as a build-time check, and an optional **measure-time tripwire** that shadow-compares `measured` vs a reference query behind a flag and logs drift *before* the value is billed (the early, stronger form of the deferred reconciliation job). |

## Rationale / Trade-offs

**Stored (stock integral), not ingested (flow).** Helicone/Sentry bill ingest bytes; AWS S3/OpenObserve bill stored GiB-hours. Stored wins here because (a) the measurement already exists, (b) deletion lowering the bill is the customer-facing answer to the "report X then delete Y" question, (c) it makes retention a visible cost lever rather than a hidden internal optimization. Trade-off accepted: a customer who ingests 1 TB and deletes it within the hour pays ~€0 for it (S3 has the same property); ingestion cost we incur is unpriced. If that becomes an acquisition vector, an ingest fee is a *separate additional* line, never a replacement.

**Hourly additive accrual, not end-of-period reporting.** Each hour is independently correct, independently retryable (35-day backdate window), and immune to period-edge timing games. Data arriving one minute before month-end contributes one hour-sample (~0.001 GiB-month) — negligible and exactly fair. The failure mode of a monthly job (one failed run = one wrong invoice) becomes "some hours retry later".

**Predicate-encoded 35-day inclusion, not Stripe-side allowance.** The free window is `row_age > 35d` in the source query — one source of truth, provable with a test ("default-keep org reports 0"). A Stripe-side graduated tier-0 or credit grant would put the allowance in dashboard config that can drift from marketing copy. Trade-off: changing the window requires a deploy, not a config click. Accepted — the window is product policy, not a pricing knob.

**Time-based allowance, not volume-based.** "First 35 days free" rather than "first N GiB free". This is the commercial offer verbatim; no per-plan GB allowance state exists anywhere.

**Event-driven projection, not a cron.** A cron would be simpler in isolation but introduces a second operational model (leader lock, interval config, separate alerting) for the same shape of work `billingMeterDispatch` already does. Trade-off: idle orgs (no events) have their cursor frozen until the next event lands, then back-fill at catch-up time. Accepted — idle orgs' billable storage is by definition near-zero or being retention-deleted, and the 35-day ceiling bounds staleness.

**Rejected: mid-period snapshot of current GB.** Timing-dependent, non-reproducible, bills X regardless of deletions. Not one of the 11 competitors researched ships it.

**Rejected: `reportUsageSet` / `last`-formula meter.** Both telescope to the final value — gameable by deleting just before period close.

**Rejected: ingested-GB priced by retention tier (SigNoz model).** Most sophisticated, but blocks shipping and double-charges the retention lever (more hours *and* a higher rate).

**Rejected: usage-billing middleware (Metronome, Orb, Lago).** Would erase the GiB-hours integration work, but adds a third party in the billing critical path and net-new operational surface while we already run the meter→Stripe pipeline. Reconsider if billing complexity grows (commitments, credits, multi-currency tiers).

## Consequences

**Positive.**
- The bill is the time-integral of stored bytes at hour resolution: "pay for what you held, for how long". Deletion lowers the bill by construction — no rebate, no adjustment, no dispute surface.
- Reuse: one Prisma migration + one audit table + one projection + one command + catalog entries. Idempotency, circuit breaker, SaaS gate, observability — inherited.
- Zero rollout disruption: same subscription, same cycle; the storage line appears on the next invoice after notice + backfill.
- Free and self-hosted orgs generate zero pipeline activity.
- Per-project retention diversity inside an org needs no special handling.

**Negative.**
- Cancel/downgrade becomes a billing-correctness path: Stripe discards accrued metered usage on cancel unless `cancel_at_period_end` (default) or `prorate=true` + `invoice_now=true` (immediate). Existing cancel paths in `subscription.service.ts` must be audited; each flow gets an integration test asserting the final invoice line.
- The schema migration is purely additive (two `CREATE TABLE`s) — no locks on existing tables, no change to the billable-events checkpoint.
- Stripe's 35-day timestamp ceiling caps catch-up; longer projection outages need the `meterEventAdjustments.create` runbook path.
- Hourly catch-up means hourly CH queries per org per gap — bounded with the same memory-budget pattern as the existing storage-meter query (per-table-then-sum, no UNION ALL).

**Neutral.**
- 30-day-month convention → ±3% monthly variance vs a flat €3; pricing copy must specify GiB and the convention.
- 24× meter-event volume vs daily — negligible under Stripe's 1k events/sec.
- Cold/hot tiering (ADR-024) is internal cost optimization — one price regardless of where bytes physically live.

## Open questions (deferred, not blocking)

1. €3/GiB-month price point — confirm with pricing copy owner.
2. Customer notice copy + go-live date — gates the SubscriptionItem backfill.
3. Free plan's 14-day visibility / 45-day blurred recovery window — read-path concern, sibling spec (#4745), not billing.
4. `LimitType.storage` (soft notify vs hard cap) — follow-up PR (final phase).
5. Idle-org heartbeat (per-org synthetic event so cursors never freeze) — only if real orgs surface the gap.
6. **Reconciliation job** — periodically compare `Σ StorageUsageHourly.megabytes (reportedAt not null)` against Stripe's `meter_event_summaries` per org/period to detect drift. Finance-side safety net, not on the billing critical path; address in the final phase.
7. **TTL-eviction undercount on late catch-up** — a sealed hour H caught up after some of its >30-day rows have already TTL-deleted will undercount (acknowledged in Invariants). Bounded by the 35-day gap ceiling + live dispatch; real only during long outages. Address in the final phase if it surfaces.

## References

- Related ADRs: [ADR-007](./007-event-sourcing-architecture.md) (event-sourcing), [ADR-022](./022-data-retention.md) (`_retention_days`, `_size_bytes`, TTL), [ADR-024](./024-cold-path-tiered-storage.md) (cold tier), [ADR-019](./019-repository-service-layering.md) (layering)
- Existing code generalized: `ee/billing/services/usageReportingService.ts`, `ee/billing/services/subscription.service.ts`, `ee/billing/services/subscriptionItemCalculator.ts`, `ee/billing/services/seatEventSubscription.ts`, `ee/billing/utils/growthSeatEvent.ts`, `ee/billing/stripe/{stripeCatalog.json, stripePrices.types.ts}`, `src/server/data-retention/metering/storageMeter.service.ts`, `src/server/event-sourcing/pipelines/billing-reporting/`, `src/server/event-sourcing/projections/global/billingMeterDispatch.reactor.ts`
- Stripe: [Billing Meters](https://docs.stripe.com/api/billing/meter) · [Meter Events](https://docs.stripe.com/api/billing/meter_event) · [Meter Event Adjustments](https://docs.stripe.com/api/billing/meter-event-adjustment) · [Usage-based billing guide](https://docs.stripe.com/billing/subscriptions/usage-based/implementation-guide) · [Cancellation & metered usage](https://docs.stripe.com/billing/subscriptions/cancel)
- Industry: AWS S3 GB-month (byte-hours ÷ hours-in-month), Cloudflare R2, OpenObserve `mb_hours`, SigNoz retention-dimensioned meters
- Research trail (Obsidian, `EPIC/Q2/data-retention/reporting-stripe/`): competitor matrix (11 repos), Stripe meter mechanics, industry best practices, current-state-and-gap analysis
