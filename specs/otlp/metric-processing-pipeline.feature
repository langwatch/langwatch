Feature: Metric-processing pipeline (event-sourcing rewrite)

  `platform/app/src/server/event-sourcing/metric-processing/` canonicalises OTLP
  metric data points into one immutable, content-addressed event per point,
  and mounts three `map` projections on it — never a `fold`, because a point
  has no lifetime to accumulate (ADR-098, ADR-105).

  See `specs/otlp/canonical-metric-ingestion.feature` for the
  ingestion-boundary contract this pipeline layer implements. This file
  covers what the pipeline itself is responsible for: canonicalisation, the
  rollup recompute, and the ADR-100/ADR-106 mount and group-key mechanics.

  Rule: A zero value is a real observation, never an absent one

    @unit
    Scenario: A gauge reading of zero survives canonicalisation
      When the project sends a gauge data point whose value is 0
      Then the canonical point reports a double value of 0
      And the value is not reported as absent

    @unit
    Scenario: A zero value survives into the map projection's written row
      When a data point whose value is 0 is received as an event
      Then the metricDataPointStorage projection writes a row whose value is 0

    @unit
    Scenario: A zero-valued point contributes to its rollup bucket
      When a bucket of points includes one whose value is 0
      Then the rollup bucket's count includes that point
      And the rollup bucket's sum reflects the zero contribution

  Rule: Observed data survives ingestion

    @unit
    Scenario: A histogram keeps its bucket layout
      When the project sends a histogram data point with explicit bounds and bucket counts
      Then the stored point still reports those bounds and counts
      And its sum, min and max are preserved

    @unit
    Scenario: A typed value keeps its type
      When the project sends an integer data point
      Then the stored point reports an integer value
      And it is not reported as a floating point value

    @unit
    Scenario: Metric identity does not depend on the machine that received it
      Given two receivers process the same data point
      Then both derive the same identity for it
      And the point is stored once

  Rule: Invalid points are rejected, and say so

    @unit
    Scenario: A non-finite value is refused rather than stored as nothing
      When the project sends a data point whose value is not a finite number
      Then the preparation result reports that point as rejected
      And no point is accepted for it

    @unit
    Scenario: A malformed batch is counted, not crashed on
      When the project sends a request whose metric container is malformed
      Then the preparation result reports the affected points as rejected
      And the remaining well-formed points are still accepted

  Rule: A point that cannot be correlated to a span is still accepted

    @unit
    Scenario: An exemplar that cannot be correlated does not block acceptance
      Given a data point carries an exemplar that cannot be correlated to a span
      When it is canonicalised
      Then the point is accepted
      And it carries no correlation record for that exemplar

  Rule: Rolled-up metrics can always be rebuilt

    @unit
    Scenario: A late point corrects the summaries around it
      Given a series already has points either side of a rollup window
      When a point arrives late for that window
      Then the summaries covering it reflect the late point
      And summaries for untouched windows are unchanged

    @unit
    Scenario: Reprocessing a point does not change the result
      Given a data point has already been processed
      When the same point is processed again
      Then the stored point and its summaries are unchanged

  Rule: Every mount declares a legal combination (ADR-106)

    @unit
    Scenario: None of this pipeline's projections mount on a merge store
      Then metricDataPointStorage, metricSeriesCatalog and metricTimeRollup each declare a store that is not merge

    @unit
    Scenario: A fold is never mounted on this aggregate
      Then every projection this pipeline mounts is a map

  Rule: Group keys route work deterministically (ADR-100)

    @unit
    Scenario: The same series always lands in the same shard
      When two points of the same series are keyed for the same projection
      Then they resolve to the same group key

    @unit
    Scenario: A point's storage lane is independent of its series' rollup lane
      When a point is keyed for storage and its series is keyed for the rollup
      Then the two group keys name different lanes
