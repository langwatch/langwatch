# ADR-003: Evaluation outcomes are recorded on the trace and folded with it

**Status:** Accepted (2026-11-12)

**Behavioural contract:** [specs/trace/trace-evaluation-analytics.feature](../../../specs/trace/trace-evaluation-analytics.feature)

## Context

The stock dashboard widgets that join an evaluation to its trace's columns (customer, topic,
labels, origin, the `metadata.*` columns) cannot afford that join at read time. They read
`trace_evaluation_analytics` instead: one live row per (tenant, trace, evaluation), carrying the
evaluation's outcome and a copy of its trace's columns, byte for byte as `trace_analytics` has
them. Both halves change after the row is first written: an evaluation is re-run or re-reported,
and a trace's columns move as late spans, topics and origins arrive. The owner's rules: event
projections are the architecture, and no read uses `FINAL`.

## Decision

1. **The outcome becomes a trace fact.** A trace peer subscriber on evaluation's
   `COMPLETED` and `REPORTED` events sends `recordEvaluationOutcome` on `trace_processing`, which
   emits `lw.obs.trace.evaluation_outcome_recorded` on the trace aggregate. `COMPLETED` carries no
   identity, so the subscriber reads it with `EvaluationApi.findRunByEvaluationId`; a run not yet
   readable throws and the delivery retries. An evaluation with no trace is skipped. One whose
   trace is not stored yet throws while its event is at most an hour old, so the delivery retries
   as a late trace arrives (main joined at read time); past that hour it is skipped. The event's
   `occurredAt` is the trace's `OccurredAt`, read from `trace_analytics` no further than 62 days
   before the evaluation, because the fold reads back in a window around the event's time. The
   idempotency key is `${tenantId}:${traceId}:evaluation-outcome:${eventId}`. The recorder and the
   backfill clamp the evaluation time to between a day before the trace (the live read's
   lookback below) and five minutes past now, and truncate the evaluator name and label to 256
   characters, which the contract schemas also bound.

   This is a deliberate exception to ARCHITECTURE.md's "a peer subscriber writes its own
   read-model row directly; it sends its own command only when the reaction is a fact others
   react to". Here the trace fold is what reacts: sending the fact onto the trace's lane orders
   it with the trace's own events, so one fold sees both halves of every row in one order.

2. **The trace analytics fold keeps the outcomes.** `TraceAnalyticsData.evaluations` maps
   evaluation id to the fresher outcome by `(evaluationOccurredAt, sourceEventId)`, a total order
   so a replay and the live fold keep the same one. It holds at most 200 evaluations, so a hostile
   run cannot grow one trace's state without bound: past that a new evaluation is refused rather
   than an older one dropped, because a dropped evaluation would strand its written row. It
   persists in `trace_analytics` as `EvaluationOutcomes` (JSON) beside `EvaluationRowsDigest`, the
   digest of the rows last written. A stored `EvaluationOutcomes` that does not decode makes the
   read-back an undecodable miss, so the fold refolds the trace from its events rather than
   storing an empty map over the outcomes.
   A separate fold was rejected: it has nowhere to keep a trace's columns for a trace with no
   evaluation yet, so its read-back would find nothing and lose them; this fold already folds and
   reads back every column the rows copy.

3. **The rows are written collapsing (K2)** in a `VersionedCollapsingMergeTree(Sign, Revision)`,
   so readers sum `Sign` and never need `FINAL`. On each store, before the `trace_analytics` upsert:
   - the wanted rows are one per evaluation, their trace columns taken from the same
     `projectAnalyticsStateToRow` output the upsert writes, `Origin` null, `TraceOrigin` and
     `TraceOccurredAt` the trace row's `Origin` and `OccurredAt`;
   - their digest covers the row content, not `UpdatedAt` or `Revision`;
   - no evaluations, or a digest equal to the state's own (decoded from the row, or carried by
     the fold cache, which holds the state the store answers with the digest it wrote), writes
     nothing;
   - otherwise one ClickHouse read per batch finds those traces' live rows (`GROUP BY` every
     column, `Revision` included, `HAVING sum(Sign) != 0`, evaluation time from the earliest trace
     less a day), and each evaluation is diffed on content: unchanged writes nothing; changed
     writes the live row again at `Sign = -1` (byte-identical, same `Revision`) and the new one at
     `Sign = +1`, `Revision + 1`; new writes `Sign = +1`, `Revision = 1`.

   The read-then-insert is safe because one trace has one writer at a time: the fold's group
   queue runs one job per trace group, and a replay pauses the lane, drains the batch's groups and
   defers live events past its cutoff before it writes. The diff reads ClickHouse, never the fold
   state, because the two writes are not atomic. Rows
   first, then `trace_analytics`: a crash between them leaves the old digest, so the next store
   reads, finds the rows already there and writes nothing but the trace row. A replay (state
   from scratch, digest '') and an older row's read-back take the same path, so neither writes a
   duplicate.

   A lagging replica on a cluster can leave an orphan -1 group (sum -1) or a doubled +1 group
   (sum 2), so the live read keeps every group whose signs do not sum to zero and returns the
   sum. The trace's next content change, or a replay, reads the live rows and repairs with
   byte-identical rows at the same revision: +1 for an orphan, -1 for each surplus of a doubled
   row, so the unchanged row nets 1 and every other group 0. A store whose digest is unchanged
   reads nothing, so it repairs nothing.

4. **History is filled by two background steps.** `trace:record-evaluation-outcomes` pages each
   project's finished evaluations of the last 62 days through `EvaluationApi.listEvaluationOutcomes`
   and sends one command each, keyed by evaluation id; the step is done once every command is
   sent, and the live trace fold writes those rows as it handles them.
   `trace:replay-trace-evaluation-analytics` then replays the trace
   analytics lane over the same 62 days, after that step and after the lane's widget-columns
   replay, with the existing replay fencing.

## Consequences

- A trace analytics store with outcomes reads `trace_evaluation_analytics` once per batch when its
  rows moved. The store answers the state stamped with the digest it wrote and the Redis fold
  cache holds that, so a cached state neither reads again nor keeps a stale digest that would
  skip a change back to earlier content.
- An orphan or doubled group from a lagging replica, or from a stalled worker whose claim the
  queue gave to another, stays until that trace's next content change or a replay.
- `TRACE_EVALUATION_ANALYTICS_QUORUM_READS` (off by default, enabled nowhere) writes these rows
  synchronously with `insert_quorum = 'auto'` and reads them with `select_sequential_consistency`,
  so the read-back sees the fold's own last write on a replica; live-row repair stays the safety
  net. That needs `insert_quorum_parallel = 0`, under which ClickHouse rejects an INSERT to the
  table while the previous quorum insert is unfinished, so concurrent writers can fail under load
  (a failed store the fold job retries). Turning it on needs a replicated cluster and a load check.
- Evaluation is reached through a channel bound to `EvaluationApi`, not a peer, since evaluation
  already depends on trace.
