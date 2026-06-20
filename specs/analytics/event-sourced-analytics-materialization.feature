# See dev/docs/adr/034-event-sourced-analytics-materialization.md for the architectural rationale.
Feature: Event-sourced analytics materialization

  Custom graphs and threshold triggers read analytics by aggregating over time.
  Today that re-scans the wide, point-lookup-sorted trace_summaries on every render.
  This materializes two derived ClickHouse projections off the event log:
    - trace_analytics: one slim, time-sorted row per trace (latest value) — holds
      every dimension (including late ones like topic and origin), and serves
      percentiles, min/max, dim-grouped, and arbitrary-filter reads.
    - trace_analytics_rollup: additive metrics pre-summed per time bucket, fed by
      immutable per-span increments — counts, sums, averages and distinct-counts over
      dimensions that are final at span-write time (model, span type).

  Background:
    Given delivery of events to projections is at-least-once

  Rule: The slim table reflects the latest value per trace under mutation

    Scenario: A mutated trace reads back its final values
      Given a trace whose cost grows and whose origin flips as its spans arrive
      When trace_analytics is read for that trace
      Then it returns the latest version — the final cost and the final origin
      And the trace's earlier versions are not double-counted

  Rule: The rollup sums additive metrics correctly from per-span increments

    Scenario: Total cost is the sum of the trace's span costs
      Given a trace with three spans costing 0.01, 0.04, and 0.05
      When each span contributes its own cost
      Then the bucket's summed cost for that trace is 0.10

    Scenario: Trace count is the distinct count of trace ids
      Given a trace whose spans all share the same trace id
      When the spans contribute to the rollup
      Then the trace is counted exactly once, as a distinct trace id
      And counting raw spans would have over-counted it

    Scenario: Trace-level duration is carried by the root span
      Given a trace with several spans
      Then the root span carries the trace's wall-clock duration and the others carry zero
      And summed duration over the distinct trace count yields the average trace duration

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
