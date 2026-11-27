# ADR-007: A view over a retraction-pair projection keeps the rows whose signs sum above zero

**Date:** 2026-11-12

**Status:** Accepted

## Context

The stock evaluation widgets read `evaluation_metrics` and joined `trace_metrics` to keep the
traces of the dashboard's period and sources. Both sides deduplicate (ADR-005, ADR-006), and the
join holds every evaluated trace of the period. The trace module now folds each evaluation's outcome
into `trace_evaluation_analytics`: one live row per (TenantId, TraceId, EvaluationId) beside the
trace's `OccurredAt`, origin and dimensions, so a widget filters by the trace with no join.

The table is a `VersionedCollapsingMergeTree(Sign, Revision)`. A change writes the old row again,
byte for byte, with `Sign = -1`, and the new row with `Sign = +1` and the next `Revision`. Until a
merge collapses the pair, both rows are on disk. The owner's rules are that event projections are
the architecture and that the views use no `FINAL`; `LIMIT 1 BY` holds every key of the period
(ADR-006, `span_metrics`), and an in-tuple subquery holds the project's history (ADR-005).

## Decision

1. **A new dedup strategy, `settled`.** A catalog entry declares `strategy: "settled"`, its
   `signColumn` (`Sign`) and its `versionColumn` (`Revision`). The view reads its source columns,
   sign included, in a subquery (from the floor on in a twin), groups by every one of them but the
   sign, `Revision` included, and keeps a group with `HAVING sum(Sign) > 0`.
   One version of a row is one group: a retracted version sums to 0 and drops, the live one sums to
   1 and stays. A lone `-1` (its `+1` not yet visible) sums below zero and drops too.
2. **Every column is a grouping key, not `argMax` over a narrower key.** A `WHERE` on a grouping
   key is pushed below the aggregation (checked with `EXPLAIN`), so a widget's filter on `Source`,
   `TraceOccurredAt` or `EvaluatorName` prunes before the group is built. No column needs a version
   to pick its value, because a group holds one version's identical rows. The `EXPLAIN` was on the
   measured form, which computed `Source` inside the subquery and grouped by it; the provisioned
   form groups by `Origin` and computes `Source` above the group (see Consequences for the open
   check).
3. **`trace_evaluation_metrics`** is the row view: grain (TenantId, EvaluationId), `Source` over the
   evaluation's `Origin` and `TraceSource` over the trace's, each with the expression its namesake
   on `evaluation_metrics` and `trace_metrics` uses.
4. **`trace_evaluation_checks`** is the narrow view for the count widgets: an aggregating entry
   (`aggregating: true`, pinned to `settled`) grouped by (TenantId, TraceId, OccurredAt,
   TraceOccurredAt, EvaluatorName, Passed, IsGuardrail, Source, TraceSource), with
   `Evaluations = sum(Sign)` and `HAVING sum(Sign) > 0`. A retracted version's `+1` and `-1` fall in
   the same group, so on clean data the sum is the exact live count without a per-version group.
   An orphan `-1` or a doubled `+1` from a lagging replica (until the trace fold repairs it, trace
   ADR-003) makes a group's sum one off; `> 0` keeps such a group from ever reading negative.
   `Source` and `TraceSource` are grouped by their expressions, so the view holds one row per
   published value.
5. **`Sign` and `Revision` stay out of the catalogue.** Both are `omit` on the catalogue table, so no
   caller names them; the source grant includes them because the view body reads them, as it
   includes `Version` for `trace_metrics` (catalogue-grants: a structural key the view needs). A
   caller summing raw signs or picking revisions would be re-implementing this dedup, wrongly.
6. **A floored twin for both views** (`<view>__floor(lwql_floor)`, ADR-005's machinery): the source
   read inside the subquery starts at `OccurredAt >= {lwql_floor:DateTime64(3)}`. A retraction
   copies its row, `OccurredAt` included, so a version and its retraction fall on the same side of
   any floor: the twin's rows are exactly the view's rows at or after the bound, with no
   monotonicity assumption on `OccurredAt`.
7. **The catalogue rule** accepts `settled` where an entry declares a sign column and a version
   column (or aggregates), and `none` where an entry has no version column and no narrower grain
   (rows written once, `span_metrics`). Aggregating entries may pin only `settled`.
8. **Aggregate projects** time a dated member's rows on these views as they time `evaluation_metrics`:
   from the member's start, and only for a trace inside its window (ADR-177).

## Consequences

- Both views read their table with no `FINAL`, no `LIMIT 1 BY` and no history-wide subquery. Under
  ClickHouse 26.8.36.3 with compatibility 25.10, all 12 widgets moved to these views ran within
  1 GB and 60 s at 30 and 60 days on the proof data set.
- The row view's grouping holds the period's rows (one per live or retracted version), not the
  project's history; the floor rewrite keeps a widget's read to its period.
- Before a merge, a changed evaluation costs one extra group per change in the row view and none in
  the narrow view; correctness does not wait for the merge.
- A source column added to the row view widens its `GROUP BY`; that is the intended cost of
  pushing every filter below the aggregation.
- Open: the `EXPLAIN` of decision 2 has not been repeated on the provisioned form, which groups by
  `Origin` and computes `Source` above the group; whether ClickHouse pushes a `Source` filter
  down as a filter over a key is to be confirmed on the proof data set.
- A projection that ever writes a `-1` that is not byte-identical to its `+1` breaks decision 1:
  both rows would survive as separate groups. The K2 rule in the trace fold is the guarantee.
