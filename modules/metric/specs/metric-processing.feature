# See ../adrs/001-metric-processing-boundary.md

Feature: Canonical OTLP metric processing
  As an OpenTelemetry metric producer
  I want data points canonicalised and durably projected
  So that series and rollups remain queryable across retries

  @unit
  Scenario: Valid OTLP points become canonical durable events
    Given an OTLP metric request containing valid gauge, sum, histogram, or summary points
    When process composition prepares and records the points
    Then each accepted point has deterministic 64-hex series and point IDs
    And the pipeline emits `lw.obs.metric.data_point_received` events for the `metric` aggregate
    And metricDataPointStorage projects canonical points to `metric_data_points` and `metric_usage_estimates`

  @unit
  Scenario: Invalid metric points use partial success
    Given an OTLP metric request containing valid points and malformed or unsupported sibling points
    When the Metric service prepares the request
    Then valid points are accepted
    And invalid points are counted as permanent rejections
    And the response preserves the existing partial-success error mapping

  Scenario: Metric projections preserve the four existing tables and rollup width
    Given a canonical metric data point for a known series
    When the metric event projections process it
    Then metricDataPointStorage writes `metric_data_points` and `metric_usage_estimates`
    And metricSeriesCatalog writes `metric_series`
    And metricTimeRollup writes `metric_time_rollups`
    And rollup buckets remain 30 seconds wide

  @unit
  Scenario: Canonical metric identity and retries are stable
    Given the same tenant submits the same canonical metric point twice
    When durable metric processing is retried after a persistence failure
    Then the series ID, point ID, event version, aggregate identity, and tenant-scoped idempotency key are unchanged
    And the retry can persist the point without creating a second logical point

  @unit
  Scenario: A valid exemplar requests Trace correlation only
    Given a canonical metric point has a valid exemplar trace and span ID
    When process composition dispatches its metric correlation
    Then Trace receives only the metric-correlation contract
    And Trace owns the trace correlation fold rather than Metric owning trace persistence

  @unit
  Scenario: Missing or invalid exemplars do not call Trace
    Given a canonical metric point has no valid exemplar trace and span ID
    When the Metric pipeline processes it
    Then the point and its metric projections remain durable
    And no Trace correlation is requested
