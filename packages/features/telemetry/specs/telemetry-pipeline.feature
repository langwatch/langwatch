Feature: Canonical telemetry pipelines

  Scenario: Canonical log records are accepted and projected
    Given an OTLP log request with valid records
    When the Telemetry log pipeline processes the records
    Then it emits canonical log record received events
    And the canonicalLogStorage projection stores the canonical records

  Scenario: Invalid metric points do not reject valid siblings
    Given an OTLP metric request containing valid and invalid points
    When Telemetry prepares the metric data points
    Then valid points are accepted
    And invalid points are reported as permanent rejections

  Scenario: Metric rollups preserve deterministic identity and retention
    Given a canonical metric data point
    When the metric pipeline projects the point
    Then metricDataPointStorage, metricSeriesCatalog, and metricTimeRollup preserve their names
    And each write receives the configured retention policy
