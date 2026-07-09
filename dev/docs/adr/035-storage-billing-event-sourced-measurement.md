# ADR-035: Storage billing — event-sourced measurement, no periodic full resum

**Date:** 2026-07-09

**Status:** Proposed

**Supersedes:** the measurement/deletion-tracking strategy in [ADR-027](./027-storage-gb-billing.md) (Phases 2–4.5). ADR-027's pricing model, billing cutoff (35d), reporting protocol (Phase 3), and Stripe meter contract (Phase 5) are unchanged and still apply. Only *how the billable byte total is derived each sealed hour* changes.

## Context

ADR-027 Phase 2's measurement re-runs, per org, per sealed hour:

```sql
SELECT sum(_size_bytes) FROM <table>
WHERE TenantId = {tenantId} AND <age col> <= {cutoff}
```

unioned across 11 retention-managed tables. This resums an org's **entire historical backlog** older than 35 days from scratch, every hour, even when nothing changed since the last hour. `_size_bytes` aggregation at this shape has already caused two production OOM incidents — Phase 2/4's mitigations (per-table pre-aggregation, query timeouts, degrade-to-0) reduce blast radius but don't remove the repeated-full-resum cost.

Separately, ClickHouse's native TTL deletion (which ages out the >35-day data this whole model bills for) is invisible to the application by design — confirmed via ClickHouse's own maintainer-filed roadmap (no `system.mutations`-equivalent introspection for TTL deletes/moves exists). `system.part_log`'s `TTLDeleteMerge` tag is part-level, not row/org-level, and carries no before/after byte count. This is why ADR-027 needed a tripwire (Phase 4.5) and reconciliation (Phase 7) as bolt-on safety nets: the cached per-hour measurement can silently diverge from reality with no structural way to notice.

Forces shaping this revision:

1. **The repeated full resum is the actual OOM root cause**, not a measurement-frequency problem. Reducing query cost (timeouts, degrade-to-0) treats the symptom; the query shape itself — O(org's total historical backlog), run hourly — is what needs to change.
2. **TTL cannot be hooked or replaced without giving up its efficiency.** Native TTL deletion is cheap, background, and battle-tested. Any design that requires TTL to emit something it structurally can't is a dead end (confirmed by research, not assumption).
3. **No cron, no scheduler, ever.** Any time-boundary check must be triggered by a real event through the existing event-sourcing pipeline, made safe to repeat via dedup — consistent with how `orgBillableEventsMeter`-driven dispatch already works platform-wide. This is a hard constraint, not a preference.
4. **Scope is storage-billing only.** The billable-events pipeline (`ee/billing/services/billableEventsQuery.ts`, `reportUsageForMonth.command.ts`) is unaffected — its live-resum-then-diff strategy is cheap (a `COUNT DISTINCT`, not a `_size_bytes` aggregate) and has no OOM history. It is explicitly out of scope for this ADR.

## Decision

We will replace the per-hour full-backlog resum with an **event-sourced running gauge per org**, updated by two kinds of events instead of one recurring query:

1. **Ingest events** — every write already flows through the event pipeline. Each ingest event increments the org's running billable-bytes gauge by its own size. No new infrastructure; this reuses the existing fold/projection machinery (`orgBillableEventsMeter`'s pattern, generalized).

2. **Partition-expiry events** — retention is deterministic (`toYearWeek` partitioning + `_retention_days`), so the exact hour a given week's data crosses the 35-day cutoff is known in advance. Immediately before that boundary, run **one bounded query scoped to that single partition** (not the org's full history) to get its byte total, and emit a `"partition expired: −N bytes"` event. This event must be durably confirmed **before** ClickHouse's background TTL merge physically drops that partition (`merge_with_ttl_timeout`, default ~4h) — once TTL deletes the rows, the byte count is unrecoverable. This ordering guarantee is the load-bearing correctness property of the whole design; it is not a performance nicety.

3. **Guaranteed period closure without a scheduler** — an org that goes idle must still get its final hour/month closed out. Instead of only reacting to that org's own events (today's design, which leaves idle orgs uncorrected), any event from **any** org on the platform triggers a cheap, deduped sweep: "does any org have an unclosed period past its boundary?" Real platform-wide traffic substitutes for a clock. A fully idle platform (zero events from anyone) has no trigger — accepted, matching the trade-off ADR-027's own billable-events grace period already makes.

ClickHouse's native TTL deletion is **unchanged** — it keeps doing exactly what it does today, on its own schedule. We stand next to it with a bounded query timed to run first, not replace it.

## Rationale / Trade-offs

The alternative considered and rejected was tuning the existing query (more aggressive timeouts, wider degrade-to-0, smarter caching) — this was ADR-027 Phase 4's actual approach and it works, but it treats the OOM risk as a cost-management problem forever, not a solved problem. It also requires the tripwire and reconciliation to stay permanently load-bearing, since the underlying number can always silently drift.

This design costs more upfront: a new deletion-event pipeline (nothing today emits anything when data ages out), a one-time historical-backlog query per org to seed the initial gauge (unavoidable — the expensive query doesn't disappear, it happens once instead of every hour), and a rebuild-by-replay story if the fold logic ever needs a bug fix. In exchange: the per-hour cost drops from O(org's total historical backlog) to O(one partition, once, at expiry) plus O(1) per ingest event, permanently, at any data scale. Reconciliation and the tripwire demote from structural necessity to a periodic sanity check, because the measurement can no longer silently diverge from a query it never re-runs.

## Consequences

- Phases 2 and 4's measurement code (`billableStorageQuery.ts`, `storageMeterDispatch.service.ts`'s per-hour `measureBytesAt` call) is replaced, not extended. The `StorageUsageHourly` table's role changes from "one measured row per hour" to "one gauge-sample row per hour," fed by the new fold instead of a live query.
- Phase 3 (`ReportStorageForHourCommand`) and Phase 5 (pricing) are unaffected — they consume `StorageUsageHourly` rows regardless of how those rows get populated.
- The Phase 4.5 tripwire and Phase 7 reconciliation services remain, with reduced criticality (cold-path audit instead of load-bearing).
- The orphan-hour heal, lock-fencing, and Sentry-escalation fixes already landed on the current stack (PR #5227) are measurement-strategy-agnostic — they apply to the dispatch/reporting layer, not the resum query, and carry forward regardless of which measurement strategy underneath them wins.
- The current PR stack (#4832, #5158, #5225, #5227 and its merged children #5228/#5246) implements the superseded strategy. Once this ADR is accepted, that stack should be closed rather than merged, and re-implemented against this design.

## References

- Related ADRs: [ADR-027](./027-storage-gb-billing.md) (pricing/reporting/cutoff — unchanged), [ADR-022](./022-data-retention.md) (retention + native TTL, unchanged)
- ClickHouse TTL introspection gap: [ClickHouse/ClickHouse#10128](https://github.com/ClickHouse/ClickHouse/issues/10128) (roadmap — no `system.mutations`-equivalent for TTL deletes exists)
- Superseded PR stack: #4832, #5158, #5225, #5227 (+ merged #5228, #5246)
