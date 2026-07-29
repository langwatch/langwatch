# See dev/docs/adr/034-event-sourced-analytics-materialization.md for the architectural rationale.
Feature: Event-sourced analytics materialization

  Custom graphs and threshold triggers read analytics by aggregating over time.
  Today that re-scans the wide, point-lookup-sorted trace_summaries on every render.
  This materializes two derived ClickHouse projections off the event log:
    - trace_analytics: one slim, time-sorted row per trace (latest value) — holds
      every dimension (including late ones like topic and origin), and serves
      percentiles, min/max, dim-grouped, and arbitrary-filter reads.
    - trace_analytics_rollup: additive metrics pre-summed per time bucket, fed by
      immutable per-span increments — counts, sums and per-trace averages over
      dimensions that are final at span-write time (model, span type).
      Distinct-counts over arbitrary dimensions live on the slim table.

  Background:
    Given delivery of events to projections is at-least-once

  Rule: The slim table reflects the latest value per trace under mutation

    Scenario: A mutated trace reads back its final values
      Given a trace whose cost grows and whose origin flips as its spans arrive
      When trace_analytics is read for that trace
      Then it returns the latest version — the final cost and the final origin
      And the trace's earlier versions are not double-counted

    Scenario: A late topic classification lands on the slim row without losing the metrics
      Given a trace whose spans were folded some time ago
      And the projection's warm state has since been evicted
      When the topic classification event arrives on its own
      Then the slim row is rebuilt from the trace's full event history
      And it carries the topic AND the trace's original cost and tokens

  # The anchor rule below is ADR-071 (dev/docs/adr/071-coding-agent-session-immutable-storage-anchor.md):
  # the time a slim row is stored and expired under is a storage decision, held
  # separately from any time the trace itself reports.
  Rule: A slim row is anchored on a real time it was observed at, and stays there

    @unit
    Scenario: A trace whose only signal is a log record is anchored in real time
      Given a trace that emits log records and never emits a span
      When its slim row is written
      Then the row is anchored at the time its first signal was observed
      And it is not filed under a time so old that retention would already have discarded it

    @unit
    Scenario: A trace with spans is anchored at its first span's start
      Given a trace whose spans arrive in the order they started
      When its slim row is written
      Then the row is anchored at the first span's start

    @unit
    Scenario: A trace recorded before the upgrade keeps its place in the timeline
      Given a trace that was recorded before storage time was held separately
      When it is read back after the upgrade
      Then it still appears at the same point in analytics as it did before
      And its duration is still measured from the earliest span it reported

    @unit
    Scenario: A trace that reports a start time years ahead is not filed under it
      Given a trace whose reported start time is years in the future
      When it is recorded
      Then it does not appear years ahead in analytics
      And it is discarded on the normal retention schedule rather than outliving it

    @unit
    Scenario: A late earlier-starting span moves the trace's timing, not its anchor
      Given a trace already anchored by its first span
      When a span that started earlier arrives late
      Then the trace's measured start moves back to the earlier span
      But the row stays anchored where it was first stored

    @unit
    Scenario: A trace's duration is measured from its spans, never from a log record
      Given a trace whose log record is accepted after its span has finished
      When both signals have been folded
      Then the trace's duration is the span's own, not the wait until the log arrived
      And it is the same duration whichever of the two arrived first

    @unit
    Scenario: A log-led trace resumed from its committed row keeps its anchor and its timing
      Given a log-led trace whose committed state is recovered after its cache expired
      When its remaining signals are folded onto the recovered state
      Then it is anchored exactly where the uninterrupted fold anchors it
      And its measured start and duration match the uninterrupted fold's

  Rule: The rollup sums additive metrics correctly from per-span increments

    Scenario: Total cost is the sum of the trace's span costs
      Given a trace with three spans costing 0.01, 0.04, and 0.05
      When each span contributes its own cost
      Then the bucket's summed cost for that trace is 0.10

    Scenario: Trace count is carried by the root span
      Given a trace with several spans
      When the spans contribute to the rollup
      Then the trace is counted exactly once, by its root span's increment
      And counting raw spans would have over-counted it

    Scenario: Trace-level duration is carried by the root span
      Given a trace with several spans
      Then the root span carries the trace's wall-clock duration and the others carry zero
      And summed duration over the trace count yields the average trace duration

  Rule: A re-delivered span is tolerated, not corrected

    Scenario: Processing the same span twice slightly over-counts, acceptably
      Given a span re-delivered after a transient failure
      When its increment is applied a second time
      Then the affected bucket is over-counted by that one span's contribution
      And the system does not back it out — the error is negligible and non-systematic

  Rule: Replay rebuilds the rollup rather than incrementing it

    Scenario: Reconstructing analytics from the event log
      Given the materialization must be rebuilt from history
      When the events are replayed
      Then the rollup is truncated first and rebuilt
      And the slim table re-folds idempotently, needing no truncation

  Rule: Late-resolved dimensions are served from the slim table, never the rollup

    Scenario: A topic-grouped chart reads the slim table
      Given a graph for total cost grouped by topic
      And topic is a classified id that resolves after the spans
      When getTimeseries serves it
      Then it reads trace_analytics, where each trace's cost sits under its final topic
      And it does not read the rollup, which never had topic as a key

    Scenario: An origin-grouped chart reads the slim table
      Given a graph grouped by origin
      And origin can flip from a provisional value to its final value as spans arrive
      When getTimeseries serves it
      Then it reads the slim table, which holds the trace's final origin

  Rule: Reads route by aggregation type

    Scenario: An additive metric over bounded dimensions reads the rollup
      Given a graph for total cost grouped by model
      When getTimeseries serves it
      Then it reads the pre-summed trace_analytics_rollup, not trace_summaries

    Scenario: A percentile reads the slim table, not the rollup
      Given a graph for p95 latency
      When getTimeseries serves it
      Then it reads trace_analytics, because percentiles cannot be summed from increments

    Scenario: An arbitrary filter the rollup is not keyed by falls back to the slim table
      Given a graph filtered on a custom metadata value
      When getTimeseries serves it
      Then it reads the slim table rather than the rollup
