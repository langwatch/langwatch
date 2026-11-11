# ADR-005: A read bounded below on evaluation_metrics.OccurredAt deduplicates only from that bound

**Date:** 2026-11-11

**Status:** Accepted

## Context

`evaluation_metrics` reads `evaluation_analytics`, whose sort key is
`(TenantId, OccurredAt, EvaluationId)`. `OccurredAt` changes between versions of one evaluation,
so `FINAL` keeps several rows per evaluation, and the view keeps the latest with an in-tuple dedup:
`(TenantId, EvaluationId, UpdatedAt) IN (SELECT TenantId, EvaluationId, max(UpdatedAt) ... GROUP BY
...)`. That subquery has no time bound: it groups and holds every evaluation the project ever ran.
The attribution widgets (`att-table/passRates`, `att-change/units`) ran out of memory (code 241)
on a large project even with spill on (ADR-004).

A ClickHouse view cannot see its caller's `WHERE`, so the bound cannot reach the subquery through
the view alone. Pushing both bounds would also be wrong: a version inside the window whose newer
version moved past the window's end would become the latest.

## Decision

1. The fold writes `OccurredAt` as the running max of an evaluation's event times
   (`AbstractFoldProjection.apply`, `LastEventOccurredAt`), and `UpdatedAt` strictly increases.
   So the latest version's `OccurredAt` is at or after every older version's. A catalog entry
   declares such a column as `dedup.floorColumn`; `evaluation_metrics` declares `OccurredAt`.
2. For each such view, provisioning creates a parameterised twin, `<view>__floor`, granted beside
   the view. Its dedup reads only versions at or after `{lwql_floor}` and its rows are those at or
   after it. With 1., the twin returns exactly the view's rows with `OccurredAt >= lwql_floor`: an
   evaluation whose latest version is at or after the bound keeps that version in the set, and one
   whose latest is before it has no version there.
3. The twin keys its set by `sipHash128(TenantId, EvaluationId)`, 16 bytes a row. Two evaluations
   of one project would have to collide in 128 bits to merge; that is not a practical risk.
4. The executor (`floorLangWatchQLDedup`, after the member-window scope) sends a reference to the
   twin only when the same SELECT has a top-level `AND` conjunct `OccurredAt >= x` (or `>`, either
   way round) on that reference, where `x` reads no column, no subquery and no NULL, and calls only
   query-constant functions from an allow-list (`now`, `today`, `toDateTime`/`toDateTime64`,
   `toDate`, `CAST`, `plus`/`minus`, `dateDiff`, `add*`/`subtract*`, `toInterval*`, `toStartOf*`):
   each is one value for the whole query, so the twin's argument and the `WHERE` agree. The column
   is qualified by the reference's alias, or bare when the view is the only table and no alias
   shadows it; a qualifier that is also a SELECT alias is not taken. The reference must not be on
   the outer side of a join. Anything else (an upper bound only, a bound on another column, no
   window, an `OR`, a `LEFT JOIN`'s right side, a `WITH` of the same name, a database-qualified
   name without an alias) keeps the whole-history dedup.
5. The twin's parameter is `DateTime64(3)` with no zone, which ClickHouse reads as server-local
   time. A bound in another zone (`toDateTime('...', 'Asia/Tokyo')`) would be read as a different
   instant and drop rows, so the argument is `toTimeZone(toDateTime64((x), 3), timezone())`: the
   same instant in the server's zone, under `session_timezone` too.
6. **Assumption: a newer version of an evaluation never has an earlier `OccurredAt`.** Decision 2
   holds only while it does. If a refold ever wrote a newer version with a lower `OccurredAt`, that
   fold change would have to drop `floorColumn` from the catalog in the same change.
7. If the twin is absent (a rolling deploy, before provisioning creates it), ClickHouse refuses the
   floored statement as unknown; the executor then sends the statement as written once, so the read
   answers from the whole-history view. A missing view still refuses as unavailable. The same
   holds when the twin exists but its grant has not landed yet: ClickHouse refuses it for access
   (ACCESS_DENIED, provisioning incomplete), and the executor sends the statement as written once,
   with a warning. A view the member is denied still refuses as provisioning incomplete.

## Risks

- **Projection replay.** `UpdatedAt` is the replay's clock, so every replayed version is newer than
  every stored one. A replay whose final `OccurredAt` is lower than the stored maximum (events lost
  to retention, a reordered stream, or a partial replay stopped mid-way) breaks 6.: for a bound
  between the two, the twin keeps the stale stored version while the whole-history view drops the
  evaluation. A replay of `evaluation_analytics` must either reach every event or drop
  `floorColumn` until the table is settled.
- **A late event outside the fold's read window.** Once the Redis fold cache no longer holds an
  evaluation, the fold reads its stored row back within `occurredAt ± 7 days` of the incoming
  event, filtered on the row's `OccurredAt`, and trusts an absent read (`trustAbsentMiss`, no
  retry). An event that occurred more than seven days before the stored `OccurredAt` misses the
  row, folds from `init()`, and writes a newer version at its own earlier time. That breaks 6. as
  replay does. Not fixed here; the fold is evaluation's.
- The running max is written by `AbstractFoldProjection.apply`
  (`packages/eventing/src/projections/abstractFoldProjection.ts`). Given the stored state, it holds
  for events accepted out of order and across a read-back:
  `modules/evaluation/process/src/__tests__/evaluation-analytics.occurred-at-running-max.unit.test.ts`.

## Consequences

- The attribution widgets' evaluation read holds the window's evaluations, not the project's
  history. On ClickHouse 25.10, 1 GB cap, no spill, 4 threads, 2M traces and 4M evaluations over
  60 days: `att-table/passRates` 464 MB (main's form: out of memory), `att-change/units` 644 MB
  (main's: 840 MB to out of memory). At 4M traces and 8M evaluations `att-change/units` still
  reaches the cap.
- A user's LangWatchQL that bounds `evaluation_metrics` below on `OccurredAt` gets the same benefit
  with no change to its SQL; its rows are unchanged.
- The twin is an app-owned relation: drift checks recreate it when it is missing or lacks a column
  of its view. ClickHouse lists no columns for a parameterised view, so the twin is judged by its
  view's and drifts with it. The restricted identity may read it.
- It is not in the catalogue, so the validator's table allow-list refuses every caller reference to
  it (by name, quoted, qualified, aliased, nested, joined, in a union); a call with arguments is
  refused as a table function. Only the executor's rewrite reaches it.
