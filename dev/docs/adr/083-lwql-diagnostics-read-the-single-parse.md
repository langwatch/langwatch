# ADR-083: LangWatchQL diagnostics read the validator's single parse, never a second one

**Date:** 2026-08-04

**Status:** Accepted

## Context

The LangWatchQL analytics SQL API ([#6480](https://github.com/langwatch/langwatch/issues/6480))
returns **diagnostics** alongside every result: advisory notes about an answer
that is correct but easy to misread — a measure counted once per joined row, a
chart with a hole in it, a period that has not finished filling. They never
reject a query; rejection belongs to the AST validator
(`validation/validate.ts`) and to the database's own ceilings.

Two of the four rules the issue scopes are questions about the **shape of the
submitted SQL**, not about the rows that came back:

- `POSSIBLE_FANOUT` — does a join repeat one dataset's rows once per row of
  another?
- and, added here because the partition-pruning measurement in `views.ts` puts
  an eight-fold read cost on it, `UNBOUNDED_TIME_RANGE` — was a dataset read
  with no predicate on the column that prunes its partitions?

Answering either means knowing what the statement's `SELECT` blocks contain.
The obvious implementation is to parse the SQL again in the diagnostics layer.
That is the decision this record refuses.

## Decision

**The validator's walk is the only pass that ever reads the SQL tree, and it
records the facts a diagnostic needs on its way through.** The diagnostics
module (`diagnostics.ts`) is a pure function of the validator's accept shape
(`AcceptedLangWatchQL`), the executor's typed result, and an injected clock. It
imports no parser.

`LangWatchQLQueryBlock` therefore carries, per `SELECT` block, the facts no
consumer could recover afterwards:

| field                   | what it answers                                                    |
| ----------------------- | ------------------------------------------------------------------ |
| `tables`                | which LangWatchQL datasets this block reads, and under which alias |
| `joins`                 | which column equalities the join was written on                    |
| `filteredColumns`       | which columns appear in `WHERE` / `PREWHERE` / `QUALIFY`           |
| `groupByColumns`        | which _names_ the block groups by                                  |
| `groupBy`, `aggregated` | whether the block collapses rows                                   |

Grain comes from the catalog, not from the SQL: a dataset's `dedup.keyColumns`
**is** its grain, so "the join did not match every one of the finer dataset's
key columns" is the whole fanout rule, and it needs no schema knowledge the
catalog does not already publish.

Three consequences are deliberate:

1. **Under-report, never over-report.** A join written in `WHERE` instead of
   `ON` is invisible to the walk and earns no fanout diagnostic. A filter
   written against a projection alias is not recognised as a filter on the
   column behind it. Both are misses. An advisory that fires on healthy queries
   is one people learn to ignore, and then it is not an advisory at all.
2. **`groupByColumns` is what keeps the result rules honest.** The time-bucket
   rules only treat a temporal result column as a _series_ when the query
   grouped by that column's name. Without it, "first failure per trace" — which
   groups by trace and returns a timestamp _aggregate_ — reads as a series, and
   the ordinary spacing between two unrelated traces gets reported as missing
   buckets.
3. **The clock is a dependency.** "Has this period finished yet" is asked
   against an injected instant (`LangWatchQLServiceDependencies.now`), so the
   diagnostics a result earns are a function of the result and the instant
   rather than of when the suite happened to run.

## Consequences

A new shape rule is a new field on the block plus a rule in `diagnostics.ts` —
two small edits at one seam, rather than a parser dependency in a second module.

The cost is that `validation/` now records facts it does not itself use, which
is a real coupling: the walk carries a little weight for a downstream reader.
That is the trade taken, and the alternative is worse — see below.

Every diagnostic is data in the response with a stable machine-readable `code`,
enumerated in the published OpenAPI spec. An empty list is documented, in one
place reused by the endpoint's own description
(`LWQL_CLEAN_DIAGNOSTICS_MEANING`), as _no known issue was detected_ and
explicitly not as proof the answer is the one the caller meant.

## Alternatives considered

**Re-parse the SQL in the diagnostics layer.** Rejected. A second parse is a
second answer waiting to disagree with the first: the two passes would drift on
any grammar or version change, and the disagreement would surface as a
diagnostic that contradicts the gate that let the query through. It also doubles
the parser's exposure to attacker-controlled text for a non-security feature.

**Derive fanout from the result instead of the query.** Rejected: the row counts
of a fanned-out join and a legitimately large one are indistinguishable without
knowing the grain each side was matched on, which is a fact about the statement.

**Record column references per block so "affected columns" means "columns this
query referenced".** Not taken in this slice. `meta.affectedColumns` names the
repeated dataset's _measures_ (the catalog columns declaring a `unit`) — the
ones where repetition changes the number rather than only the row count. That is
true whether or not the query selects them, and it needs no further accept-shape
growth. Revisit if a consumer needs the intersection.

## References

- `platform/app/src/server/analytics/lwql/diagnostics.ts` — the rules
- `platform/app/src/server/analytics/lwql/validation/validate.ts` — the
  walk and the accept shape it records
- `platform/app/src/server/analytics/lwql/__tests__/lwqlDiagnostics.unit.test.ts`
- `platform/app/src/app/api/analytics-sql/__tests__/lwqlAnswerableQuestions.integration.test.ts`
  — every rule triggered through the public endpoint against a seeded fixture
- `specs/analytics/lwql-api.feature`
- ADR-082 — the LangWatchQL views whose `dedup.keyColumns` the fanout rule reads as
  grain
