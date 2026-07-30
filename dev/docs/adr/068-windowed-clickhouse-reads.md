# ADR-068: One windowed ClickHouse read with a measured fallback — `queryWindowed` on the resilient client

**Date:** 2026-07-24

**Status:** Accepted

**Shipping with this ADR:** `queryWindowed` on the resilient ClickHouse client, one shared default window, and the `clickhouse_windowed_read_total{table, outcome}` counter — with all five hand-rolled window-and-fallback sites adopting it at byte-identical semantics. The token-bucket limiter on the widen path is the sequenced follow-up (below), gated on the metric data this change produces.

**Builds on:** [ADR-066](./066-projection-clickhouse-cached-store.md) — the same amplifier class (unbounded, cold-partition-walking ClickHouse reads on the per-item hot path) that took production down on 2026-07-23. ADR-066 closed it for *fold refolds*; this ADR closes the *ad-hoc windowed-read* face of it, and puts the surface that owns cold-scan detection in charge of the fallback.

**Relates to:** [ADR-034](./034-event-sourced-analytics-materialization.md) (analytics rollup reads are windowed adopters), [ADR-024](./024-cold-path-tiered-storage.md) (why an unbounded scan on a retention-managed table walks cold S3 partitions).

**Specs:** [specs/clickhouse/windowed-read-fallback.feature](../../../specs/clickhouse/windowed-read-fallback.feature).

## Context

ADR-066 established the shape of our worst ClickHouse failure mode: a read that
*looks* bounded but is not, run on the per-item hot path, walking cold S3
partitions on a weekly-partitioned table until it pins the server at its memory
ceiling and starves the merges that keep `event_log` healthy. ADR-066 closed
that mode for one source — fold projections that refolded the whole aggregate
history. It is not the only source.

Across the platform, seven read sites hand-roll the *same* pattern by hand:
compute a partition-pruning time window (a `StartedAt` / `OccurredAt` /
`StartTime` range so ClickHouse skips cold partitions), run the read against
that window, and — if the window comes back empty — **fall back to a wider or
unbounded scan** so a straddling or clock-skewed row is still found. It is a
reasonable pattern. It is implemented seven times, and the copies have drifted:

- The default window itself — a `±2-day` constant — is **copy-pasted in five of
  them**. Change the assumption once and four sites keep the old one.
- **Three of the fallbacks are completely unmetered.** When they fire, nothing
  records it; the only evidence is the ClickHouse load they generate.
- **Two more are warn-log-only** — a line in `server.log`, not a queryable
  signal, so "how often does the wide path actually run, and on which table?"
  has no answer without grepping.
- The span-storage `withPartitionHint` helper **silently re-runs the query
  UNBOUNDED whenever the windowed read returns an empty result** — a legitimate
  "no rows in this window" is indistinguishable from "widen and scan
  everything", and the widen is invisible.

The through-line: an unbounded fallback scan on a weekly-partitioned,
retention-tiered table (ADR-024) is *exactly* the amplifier ADR-066 diagnosed —
and here it is triggered by the routine, expected event of a windowed read
missing. One miss is cheap. A storm of misses — a bad hint, a cold aggregate, a
backfill — is N concurrent unbounded scans, and we would not see it coming
because most of these fallbacks are silent.

Three more reads make the risk concrete on the horizon. The event-sourcing
latest-state point reads — `simulationRunState`, `experimentRunState`, and
`suiteRunState` `getProjection` — carry **no time predicate at all** today.
They are correct (a `LIMIT 1` on the latest version), but they prune no
partitions, so as those tables grow each point read scans wider. They are the
natural next adopters of a windowed read with a bounded fallback, and are named
as such below rather than fixed here.

Underneath all of it is the same design smell ADR-066 named: a pattern that
every caller *assembles* by hand, with a fallback knob each site sets
differently, is a pattern each site can get wrong — and several already have, in
the direction that takes ClickHouse down.

## Decision

Three points, in sequence. The first two ship together; the third is a
deliberately-separated follow-up with a data precondition.

### 1. One surface — `queryWindowed` on the resilient client

**The resilient ClickHouse client
(`platform/app/src/server/app-layer/clients/clickhouse/`) owns the windowed-read
pattern.** This is the surface that already owns retries, query-error
translation, and cold-scan detection — the fallback belongs next to the thing
that can already see a cold scan, not scattered across repositories.

The client exposes `queryWindowed`: given a query, a time hint, and a declared
fallback policy, it runs the windowed read first, and on a miss applies the
policy. There is **one shared default window constant** — the `±2-day` value
lives in exactly one place, and the five copies are deleted.

The fallback policy is an explicit choice at the call site, not an accident of
how the helper was written:

- **unbounded** — widen to a full scan (today's `withPartitionHint` behaviour,
  now explicit and measured);
- **fixed lookback** — widen to a bounded wider window, never to "everything";
- **none** — the windowed read is authoritative; a miss is a miss, no second
  read.

A caller picks its policy deliberately. Nothing widens silently, and no site
carries its own private window constant.

### 2. Metric first — every windowed read is measured, not silent

**Every `queryWindowed` call increments
`clickhouse_windowed_read_total{table, outcome}`.** The outcome names exactly
what happened:

| outcome | meaning |
|---|---|
| `hit` | the windowed read answered |
| `widened_hit` | the window missed; the wider/unbounded read answered |
| `widened_empty` | the window missed; the wider/unbounded read also found nothing |
| `unbounded_hit` | a policy-unbounded widen answered (distinguished from a bounded widen) |
| `unbounded_empty` | a policy-unbounded widen found nothing |
| `unwindowed` | the read ran with no hint at all |
| `error` | an attempt threw; the read failed rather than resolved (rethrown to the caller) |

This is the load-bearing half of the change and the reason it ships now:
**before we rate-limit the fallback, we must be able to see it.** Today three of
these paths emit nothing and two emit an un-queryable log line; after this
change every windowed read, on every table, is one queryable counter with the
fallback broken out by outcome. The fallback stops being silent.

**All five hand-rolled fallback sites adopt `queryWindowed` in this change, at
byte-identical semantics.** This is a consolidation, not a behaviour change: a
site that widened to unbounded still widens to unbounded, a site that logged a
warning still has that information (now as an `outcome` label). The only new
behaviour is that the read is counted. Semantics-preserving adoption is what
makes the metric trustworthy as the baseline for point 3.

### 3. Rate-limited fallback — planned, NOT in this change

Once real fallback rates exist, the widen path gains a **token-bucket limiter**,
so a miss-storm degrades to *bounded* reads instead of N concurrent unbounded
scans. Two properties define it, and both need the metric data this change
produces before they can be set responsibly:

- **The limit is chosen from the measured baseline, per table.** A rate pulled
  from thin air is either so loose it never protects or so tight it breaks a
  legitimate burst. The per-table `widened_*` / `unbounded_*` counts from point
  2 are the input that sets it.
- **Callers declare whether their fallback is load-bearing (`required`) or
  best-effort.** A `required` fallback must still run when a best-effort one is
  being shed under pressure — the limiter sheds the droppable widens first. That
  taxonomy only makes sense once we can see which fallbacks actually fire and
  how often.

This is **explicitly out of scope here.** It is recorded as the sequenced
follow-up precisely so the split is deliberate: measure first (this change),
limit second (next change), with the measurement as the limiter's precondition.

## Rationale / Trade-offs

- **The fallback belongs on the client, not in a per-repository helper**,
  because the client is the one component that already distinguishes a cold scan
  from a warm one. A repository-local helper can widen; only the client can
  widen *and* know it is about to walk cold partitions. Co-locating them is what
  makes point 3 implementable at all.
- **Measure before you limit.** Shipping the limiter now would mean choosing its
  per-table rate from a guess. The two-step sequence trades a short window of
  "measured but not yet capped" for a limiter whose numbers are grounded in
  observed load — the same discipline ADR-066 applied when it tuned server
  flush windows against the actual burst regime rather than a default.
- **Byte-identical adoption is a feature, not timidity.** The value of point 2
  is a trustworthy baseline; a baseline gathered while *also* changing what the
  fallbacks do would not be one. The behaviour change is deferred to point 3,
  where it is the whole point.
- **The cost we accept:** for one release, the unbounded fallbacks still exist
  and can still be triggered by a miss-storm — but now they are visible, which
  is the strictly-better position to be in before adding the cap. We are not
  leaving the ADR-066 amplifier unaddressed; we are making it observable on the
  path to bounding it.

## Alternatives considered

- **Keep per-repository helpers, fix each in place.** This is the status quo,
  and the status quo is drift: five copies of one constant, three unmetered
  fallbacks, one silent unbounded re-run. Fixing them in place leaves five
  places to regress and no single surface to add the limiter to. Rejected — the
  consolidation *is* the fix.
- **A general ClickHouse query-builder framework** that owns windowing,
  filtering, pagination, and fallback for every read. Over-reach: the vast
  majority of our reads are not windowed-with-fallback, and a framework that
  wrapped all of them would be a large, invasive abstraction to solve a
  seven-site problem. `queryWindowed` is one focused method on the client that
  already exists, next to the cold-scan detection that motivates it. Rejected as
  disproportionate.

## Consequences

- **The windowed-read pattern has one home.** New windowed reads call
  `queryWindowed`; there is no hand-rolled window-and-fallback to copy, and one
  default window constant to change.
- **The fallback is observable for the first time.** `clickhouse_windowed_read_total`
  answers "how often, and on which table, does the wide path run?" — a question
  that today requires grepping `server.log` and gets no answer for three of the
  sites.
- **The unbounded-scan amplifier is now on a leash we can tighten.** Point 3 has
  a concrete precondition (this change's metric) and a concrete mechanism
  (per-table token bucket + `required`/best-effort taxonomy). It is sequenced,
  not hand-waved.
- **The ES point reads have a named destination.** `simulationRunState`,
  `experimentRunState`, and `suiteRunState` `getProjection` become windowed-read
  adopters when their partition-pruning is worth adding — recorded here so the
  next person does not re-derive the analysis.
- **For one release, the fallbacks are measured but uncapped.** Deliberate: the
  cap waits on the measurement.

## Adopters & sequencing

1. **Now — shipped with this ADR:** `queryWindowed` + the one shared window
   constant + `clickhouse_windowed_read_total`. The five hand-rolled sites (the
   `±2-day`-copying analytics and span reads, including span-storage's
   `withPartitionHint`) adopt it at byte-identical semantics. Nothing widens
   silently; every read is counted.
2. **Next — the limiter (point 3), precondition: metric data from step 1.** A
   per-table token-bucket on the widen path, its rate chosen from the observed
   `widened_*` / `unbounded_*` baseline, plus the `required` / best-effort
   fallback declaration so droppable widens shed first under a miss-storm. A
   separate change, deliberately gated on step 1's numbers.
3. **Future adopters — the ES latest-state point reads.**
   `simulationRunState`, `experimentRunState`, and `suiteRunState`
   `getProjection` carry no time predicate today; they gain a windowed read with
   a bounded fallback (never an unbounded one — a latest-state point read has no
   reason to walk cold partitions) when their growth makes partition-pruning
   worthwhile.

## Rules

- Windowed ClickHouse reads — a partition-pruning time window with a fallback
  when the window misses — go through `queryWindowed` on the resilient client.
  No repository hand-rolls its own window-and-fallback.
- There is one default window constant. A call site does not carry its own copy.
- Every `queryWindowed` call declares its fallback policy explicitly
  (`unbounded` / fixed-lookback / `none`). Nothing widens to an unbounded scan
  as a silent side effect of an empty windowed result.
- Every windowed read is measured by `clickhouse_windowed_read_total{table, outcome}`.
  A windowed read that fires no metric is a regression — the fallback must never
  be silent again.
- An unbounded fallback is a deliberate, declared choice on a table where it is
  justified, not a default. When in doubt, prefer a bounded (fixed-lookback)
  widen or no widen at all.

## References

- **Behavioural contract:** [specs/clickhouse/windowed-read-fallback.feature](../../../specs/clickhouse/windowed-read-fallback.feature)
- [ADR-066](./066-projection-clickhouse-cached-store.md) — read-through fold store + append coalescing (the 2026-07-23 outage; this ADR closes the ad-hoc-windowed-read face of the same amplifier)
- [ADR-034](./034-event-sourced-analytics-materialization.md) — analytics materialisation (its rollup reads are windowed adopters)
- [ADR-024](./024-cold-path-tiered-storage.md) — cold-path tiered storage (why an unbounded scan walks cold S3 partitions)
- `dev/docs/best_practices/clickhouse-queries.md` — partition-pruning and heavy-column read discipline
