# ADR-006: The views the stock widgets read keep each row's latest version without FINAL, over columns the projections write

**Date:** 2026-11-11

**Status:** Accepted. The owner ruled out `FINAL` on the views the stock widgets read
(2026-11-12), so decision 1 keeps `LIMIT 1 BY` on the eight views pinned to `latest-in-order`.
It goes against `.claude/rules/database.md`, which asks for IN-tuple dedup (`GROUP BY key` +
`max(UpdatedAt)`) rather than `LIMIT 1 BY` on tables with heavy columns, because `LIMIT 1 BY`
materialises whole granules. Here the subquery reads only the view's columns, in sort-key order.
Its measured cost: the four example queries peak at 1.4 to 3.4 times before's memory (below).
The IN-tuple form was not measured for these views.

## Context

ADR-004 moved the stock widget queries off the attribute maps. Two costs were left. Every
LangWatchQL view still read its table with `FINAL`, which merges every column a query reads across
every part of the range. And the typed columns came from MATERIALIZED expressions: a background
mutation per table had to rewrite old parts (all of `stored_spans` for the five span columns), and
an expression on a table is not the event-sourced fold the owner's rule asks for. The rule: widget
data comes from fold or map projections, the views the stock widgets read use no `FINAL`, and no
new MATERIALIZED column.

## Decision

1. **Latest-in-order dedup.** A view may pin `dedup.strategy: "latest-in-order"`. It reads its
   table through a subquery
   `ORDER BY <full sort key, stableColumns>, <version> DESC, <tieBreakColumns> DESC LIMIT 1 BY <full sort key, stableColumns>`:
   whole rows, newest version first, one per key. The order matches the table's, so `optimize_read_in_order` merges the parts
   as a stream with no hash state. A caller's filter on a key column does not reach the primary
   key or the partitions through `LIMIT 1 BY`; only a floored twin's bound, read inside the
   subquery, prunes (amended 2026-11-16). An earlier form, `GROUP BY` the key with `argMax` per column under
   `optimize_aggregation_in_order`, measured far worse (below) and was replaced; the profile pins
   no `optimize_aggregation_in_order`, so it stays the server default. Eight views pin the strategy:
   `trace_metrics`, `traces`, `evaluations`, `simulations`, `experiment_run_results`, `experiment_items`,
   `simulation_trace_metrics` and `gateway_request_spend`. `span_metrics` takes none (decision 5).
   Every other view keeps the shipped `FINAL`.
2. **Version ties.** Where a replay can rewrite a row with the same `UpdatedAt`, the view breaks
   the tie by `Version` (`trace_metrics`, `traces`, `evaluations`, `simulations`,
   `experiment_run_results`, `gateway_request_spend`), as `FINAL` does by keeping the later insert.
3. **Trace columns from the fold.** The `trace_analytics` fold writes the three ADR-004 columns
   (goose 00128 adds them as plain `String DEFAULT ''`) from the trimmed attribute map it stores.
   `metadata.environment` falls back to `metadata.env`. The projection version is bumped. The
   nine goose 00126 columns are computed by the database from `Attributes` (amended 2026-11-13).
4. **The MATERIALIZED handover (expand/contract).** The nine 00126 columns stay MATERIALIZED, so
   every writer, old or new, gets them. The contract step is
   `MODIFY COLUMN ... REMOVE MATERIALIZED`: metadata only, and safe only once every part holds the
   values (the 00126 step stored them) and every writer writes them. It must not run until the
   fold writes the nine again (amended 2026-11-13). New column names instead would leave rows
   older than the replay without values and nine duplicate columns.
5. **Span columns from a map projection.** A new map projection, `spanAnalytics`, beside
   `spanStorage`, writes `span_analytics` (ReplacingMergeTree(ProjectedAt), partitioned by
   `toYearWeek(StartTime)`, ordered by `(TenantId, TraceId, SpanId)`, no maps), and the
   `span_metrics` view exposes it, all but `InputHash`: the analytics views expose no captured
   content, not even a hash of it (#6856). `ErrorType` falls back from `exception.type` to
   `error.type`; `InputHash` is the first 8 bytes of the input's SHA-256, and 0 for a span with no
   input. The stock span widgets read `span_metrics`. Their presence checks still read `spans`,
   since they look back 90 days, and so do the loop widgets, which compare `CapturedInput`.
   `span_metrics` reads `span_analytics` with no dedup (`strategy: "none"`): the map projection
   writes each span once and keeps a span's first copy. Duplicates are rare (the ADR-034
   amendment residuals), and a read counts them. Under the production pin (compatibility 25.10,
   which turns `optimize_limit_by_in_order` off) a `LIMIT 1 BY` here held every span key of the
   period and ran 11 stock widgets out of memory in under 3 seconds.
6. **History by replay, not by mutation.** The `spanAnalytics` replay fills spans that are
   missing; it goes through first-write-wins, so it cannot correct a stored span. Two
   `defineProjectionReplayStep` steps, one per lane (`traceAnalytics`, `spanAnalytics`), replay
   the last 62 days (the longest stock period plus two) after old writers are gone. No goose
   file starts a mutation; the 00128 fill steps are gone.
7. **The span floor.** The replay step's report keeps the instant its lane was first replayed
   from (`replayedSince`). The trace module reads it from the upgrade ledger
   (`TraceApi.getSpanAnalyticsFloor`); analytics serves it (`analytics.lwql.spanDataFloor`). A
   widget that reads `span_metrics` over a period starting before the floor shows "Span data from
   <date>". While the step runs, the floor is the instant it started. Before it starts (no
   ledger row yet, or one not started) every span widget shows "Span history is still being
   rebuilt", whatever its period, rather than undercount silently. A fresh install records the
   step as not needed and shows nothing.

## Consequences

- **Version ties without a tie-break.** On an exact tie of the version column with no tie-break
  (`experiment_items`, `simulation_trace_metrics` on `OccurredAt`), `LIMIT 1 BY` keeps whichever row the sort meets first and `FINAL` the last
  inserted. The two differ only if one event was folded twice in the same millisecond with
  different values.
- **A span written twice.** `span_metrics` counts a second copy of a span until a merge removes it:
  an insert retried after it landed, or the replay of decision 6 reaching a span the live writer
  already wrote. A span re-sent with a different start time is two rows, where `FINAL` on
  `stored_spans` keeps one.
- **Time pruning.** `span_metrics`, which takes no dedup, prunes by time through the caller's
  filter. On the eight `latest-in-order` views a time filter applies after the dedup: their cost
  grows with the project's history, not the period. `trace_metrics` prunes only through its
  floored twin's bound (amended 2026-11-16). Measured below (for the argMax form).
- **Rollout and rollback.** A row an old writer writes during the rollout, or after a rollback,
  holds '' in the three 00128 columns and has no `span_analytics` row until a replay reaches it.
  `span_metrics` is empty before its replay runs, and holds nothing older than the floor.
- **`InputHash`** is computed in the projection, not by ClickHouse, and no view exposes it.

## Measurements

All on ClickHouse 26.8.36.3, restricted profile (1 GB, 10 s, no spill), 2M traces and about
40M spans a month over 60 days (4.4M `trace_analytics`, 85M `span_analytics` rows), one shared
host with a load average of 25. Failures are out of all 210 stock queries and out of the 145 that
read one of the nine views. The other 65 read no pinned view; they fail 0 (30 days) and 2 (60
days, two `evaluation_metrics` coverage queries that also fail on main) in every configuration.

| Configuration (CH 26.8.36.3)             | 30 days: all / affected | 60 days: all / affected |
| ---------------------------------------- | ----------------------- | ----------------------- |
| Before: main's SQL, FINAL views          | 39/210, 39/145          | 47/210, 45/145          |
| New SQL, `argMax` + aggregation in order | 76/210, 76/145          | 104/210, 102/145        |
| New SQL, `LIMIT 1 BY` (shipped)          | 42/210, 42/145          | 60/210, 58/145          |
| New SQL, nine views on FINAL             | 38/210, 38/145          | 55/210, 53/145          |

- **Against before.** `argMax`: 37 newly fail at 30 days and 57 at 60, none fixed. `LIMIT 1 BY`:
  11 newly fail and 8 pass that failed (30 days); 14 and 1 (60 days). New SQL on FINAL: 9 and 10;
  13 and 5. A first run of before and `argMax` on the same data gave 34/75 (30 days) and 45/103
  (60 days), so run-to-run noise on this host is several queries; the `argMax` gap is not noise,
  the gap between `LIMIT 1 BY` and new SQL on FINAL is near it.
- **New SQL on FINAL, the 18 labels that differ from before at 60 days**, rerun three times each
  without `optimize_aggregation_in_order`. 6 pass all three runs on both; 4 time out on main in
  1 or 2 of 3 runs only (noise); 3 fail every main run and pass on the new SQL, which dropped
  their `traces` read (999 vs 788 MB); one fails on both (`ext-field-accuracy/wrong`, 997 MB). One is a proof-data artefact: `up-step-latency/operations`
  reads `span_metrics` (85M rows over 60 days) where main read `spans` (42M rows, 30 days
  seeded); FINAL on either table reads every part, since `StartTime` is not in the sort key.
  Three were real regressions in the ADR-004 rewrite (`att-change/change`,
  `ck-trend/changes`, `ext-cost-per-doc/changes`, 0 of 3, out of memory): their anti-join held
  3.5M trace id strings. They now hold `cityHash64` of the id and pass 5 of 5 at 595 to 780 MB
  (main 635 to 745 MB). Two of them take about 7.5 s against main's 4 to 5 s.
- **Example peaks, 30 / 60 days, MB** (before, `argMax`, `LIMIT 1 BY`, FINAL + new SQL):
  `traffic/main` 91/157, 586/952, 163/293, 87/159. `error-rate/main` 48/85, 656/out of memory,
  149/286, 47/95. `scenarios/trend` 29/30, 453/457, 40/44, 30/33. `fd-gateway/main` 66/62,
  639/624, 134/131, 66/72. `LIMIT 1 BY` costs about twice FINAL: it carries every column the view
  exposes through the ordered merge, where FINAL carries only the columns the query reads.
- **Why `argMax` was worse.** The in-order plan runs one aggregation stream per part read (16 on
  30 days of `trace_analytics`, 36 on `trace_summaries`), each buffering up to
  `aggregation_in_order_max_block_bytes` (50 MB). At 1 MB `traffic/main` still took 217 MB; hash
  aggregation took 461 MB.
- **Pruning.** `traffic/main` on `trace_metrics` reads 2.2M rows for 30 days and 4.4M for 60
  under `LIMIT 1 BY`. For the `argMax` form, `traces`, `evaluations`, `simulations` and
  `gateway_request_spend` read every part; with 10 months of history and no cap those widgets
  needed 1.0 to 3.5 GB and 15 to 73 s. Not yet measured for `LIMIT 1 BY`; the same cause applies.
- **A global `optimize_aggregation_in_order = 1`**, which only the `argMax` form needed, was
  measured and is not pinned. It leaves most
  `spans` queries unchanged; a `GROUP BY TraceId` over 30 days of `spans` drops from 450 to 291 MB
  but takes 5 to 7 s instead of 3; `spans` joined to `trace_metrics` uses 34% more memory (322 to
  432 MB); a raw `evaluation_metrics` query without the floor rewrite goes from 943 MB to out of
  memory (unchanged as the executor sends it, floor-rewritten). The `LIMIT 1 BY` row above ran
  with it on; `LIMIT 1 BY` does not aggregate, so it does not depend on it.
- **Row equality.** On seeded versions, duplicates, a replay tie and a moved anchor, with merges
  stopped, each of the nine views returns exactly its FINAL twin's rows (EXCEPT empty both ways),
  for both the `argMax` and the `LIMIT 1 BY` forms.

## Amendment 2026-11-13: the fold does not write the nine MATERIALIZED columns

The fold first wrote the nine 00126 columns with `insert_allow_materialized_columns = 1` and a
named column list. In production that insert failed with `ILLEGAL_COLUMN` despite the setting;
the cause is not yet known (async inserts are a candidate). The fold now writes only the three
plain columns, and the database computes the nine from `Attributes` with the 00126 expressions.
The contract step (`REMOVE MATERIALIZED`) must not run until the fold writes the nine again and
that write is proven against ClickHouse with production settings: run now, it would leave the
nine empty on new rows.

## Amendment: retraction-pair projections settle instead (ADR-007)

The stock evaluation widgets read `trace_evaluation_metrics` and `trace_evaluation_checks`, over
`trace_evaluation_analytics`, a `VersionedCollapsingMergeTree` the trace fold writes with a
retraction for every change. Those views take neither `FINAL` nor `LIMIT 1 BY` but the `settled`
strategy: `GROUP BY` every column read, `HAVING sum(Sign) > 0` (ADR-007).

## Amendment 2026-11-16: a floored twin for trace_metrics, none for evaluations

`LIMIT 1 BY` stops the caller's `WHERE` from reaching the table: a local `EXPLAIN indexes = 1`
of the changes and capability-gap stock queries shows `MinMax Condition: true` on every
`trace_summaries` and `trace_analytics` read, so each widget reads the tenant's whole history
(87 production queries hit the 1 GB cap in seven days). ADR-005's floored twin now covers
`latest-in-order`: the twin's subquery reads `WHERE <floor column> >= {lwql_floor}` before its
`ORDER BY ... LIMIT 1 BY`, and the executor's rewrite is unchanged. The bound may also call
`least` and `greatest`, which the sources lookup bound uses (ADR-003). `trace_summaries` reads keep
`MinMax Condition: true`: `traces` takes no floor (below).

A twin returns exactly the view's rows at or after the bound when no newer version of a row has
an earlier floor column than an older one (ADR-005, decision 2). Per view:

- **`trace_metrics`, `OccurredAt`: exact by construction.** `OccurredAt` is in the `LIMIT 1 BY`
  key, so the floor keeps or drops a key's versions together. A trace whose anchor moved keeps its
  two rows in both.
- **`traces`, `OccurredAt`: unsafe, not floored.** `trace_summaries.OccurredAt` is the ADR-087
  storage anchor, frozen once `storageAnchorMs > 0`. But the trace-summary projection sets
  `trustAbsentMiss: true` and starts each fold from `storageAnchorMs: 0`, so a fold that misses the
  stored row (outside the ±7-day read window) starts fresh and `anchorStorageTime` freezes the
  `OccurredAt` of the span it meets first, which can be earlier than the stored anchor. That newer
  version sits before the floor while the older one sits after it: the twin would drop the newer
  version and return the stale row, where the view returns none. `traces` keeps reading its whole
  history until the anchor cannot fall.
- **`evaluations`, `ScheduledAt`: not monotone, not floored.** The row writes
  `scheduledAt ?? createdAt` (`evaluation-run-write.repository.ts`), and only the scheduled event
  sets `scheduledAt`. No producer of that event was found after #2248 replaced the two-step
  evaluation events with one `reportEvaluation`, so `ScheduledAt` is likely the wall clock of the
  fold that first built the run's state. No cache sits in front of the run store
  (`evaluation-processing-stores.pipeline.ts`), so a fold whose read misses or returns a stale
  version can write a later version with an earlier `ScheduledAt` than the one before it. The twin
  would then return that stale earlier version where the view returns no row. `evaluations` keeps
  reading its whole history; its stock reads bounded on `ScheduledAt` are sent as written.

Not floored: `simulations` (its row is stamped `StartedAt ?? CreatedAt`, the fold's clock, until
the started event brings an earlier time; a snapshot before the started event does the same) and
`coding_sessions` (`StartedAt` is the minimum of the session's signals, ADR-071). `spans` keeps
`FINAL`, through which the caller's bound already reaches the read (`MinMax` on `StartTime`).
`lwql-dedup-floor.rules.unit.test.ts` lists every deduplicated view without a floor and the reason,
so a new one cannot ship reading its whole history unremarked.
