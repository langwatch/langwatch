# Companion to the strip's last-200-jobs tiles (specs/ops/dashboard-latency
# .feature): real TIME windows need time-bucketed data, so completions also
# feed minute/hour/all-time histograms that the elected snapshot writer
# merges on its detail cycle.

Feature: Windowed processing-time percentiles
  As an operator judging whether latency changed
  I want P50 and P99 over the last hour, day, week, and all time
  So that a sample of recent jobs cannot masquerade as history

  Context: the live tiles are computed over each queue's last 200 completed
  jobs — a sample size, not a time window. At high throughput that is
  seconds of history; a regression that started an hour ago is invisible in
  it by design.

  @unit
  Scenario: Completion durations land in the shared bucket grammar
    Given the log-spaced histogram bounds
    When a duration is bucketed
    Then it lands in the smallest bucket that holds it
    And a duration past the largest bound lands in the overflow bucket

  @unit
  Scenario: A quantile reads from bucketed counts as a slight overestimate
    Given bucketed completion counts
    When a percentile is computed
    Then it reports the upper bound of the bucket the rank falls in

  @unit
  Scenario: A quiet window reports nothing rather than zero
    Given a window holding no completions
    When its percentiles are computed
    Then the window reports null
    And the dashboard renders it as a dash

  @integration
  Scenario: Windowed percentiles ride the detail artifact
    Given completions recorded into the minute, hour, and all-time histograms
    When the writer's detail cycle runs
    Then the artifact carries hour, day, week, and all-time percentiles
    And a reader pod serves them on the dashboard payload
