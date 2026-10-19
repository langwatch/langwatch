Feature: Private Dataplane Data Isolation

  When a customer has a private ClickHouse instance, ALL data flowing
  through the event-sourcing pipeline must land in the private instance.
  No data should leak to the shared instance or vice versa.

  This covers the full write path: trace ingestion → event store →
  projections (spans, logs, metrics, evaluations).

  Background:
    Given a shared ClickHouse instance (container A)
    And a private ClickHouse instance (container B)
    And org "private-org" is configured with the private instance via env var
    And org "shared-org" uses the shared instance (no private env var)

  # ---------------------------------------------------------------------------
  # Event-sourcing write path isolation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Spans for a private-CH org go to the private instance only
    Given a project under org "private-org"
    When a span is ingested through the event-sourcing pipeline
    Then the span data exists in container B (private)
    And the span data does NOT exist in container A (shared)

  @integration
  Scenario: Spans for a shared-CH org go to the shared instance only
    Given a project under org "shared-org"
    When a span is ingested through the event-sourcing pipeline
    Then the span data exists in container A (shared)
    And the span data does NOT exist in container B (private)

  @integration
  Scenario: Events for a private-CH org are stored in the private instance
    Given a project under org "private-org"
    When events are stored via the EventStore
    Then the event_log rows exist in container B (private)
    And the event_log rows do NOT exist in container A (shared)

  @integration
  Scenario: Concurrent writes for different orgs route correctly
    Given a project under org "private-org" and a project under org "shared-org"
    When spans are ingested concurrently for both projects
    Then private-org spans are in container B only
    And shared-org spans are in container A only

  # ---------------------------------------------------------------------------
  # Hybrid signals: logs, metrics and coding-agent rows
  # Hybrid means a private ClickHouse only; Postgres and object storage stay
  # shared, so these scenarios cover ClickHouse-held signals only.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Log records for a private-CH org land in the private instance only
    Given a project under org "private-org"
    When a log record is written through the routed ClickHouse member
    Then the log_records and log_usage_estimates rows exist in container B (private)
    And no log row for that project exists in container A (shared)

  @integration
  Scenario: Log reads for a private-CH org come from the private instance only
    Given a log record for a project under org "private-org" exists in container B (private)
    When that project's log records are read through the routed ClickHouse member
    Then the record is returned
    And the read never consults container A (shared)

  @integration
  Scenario: Another org's log reads never see a private-CH org's records
    Given a log record for a project under org "private-org" exists in container B (private)
    When a project under org "shared-org" reads log records by that record id
    Then nothing is returned

  @integration
  Scenario: Log writes for a private-CH org fail retryably while its private instance is down
    Given the private instance for org "private-org" is unreachable
    When a log record is written for a project under org "private-org"
    Then the write fails with a transient storage error, which the OTLP door answers as a retryable 503
    And no log row for that project exists in container A (shared)
    And a log record written for a project under org "shared-org" still lands in container A (shared)

  @integration
  Scenario: Metric points for a private-CH org land in the private instance only
    Given a project under org "private-org"
    When a metric data point is written through the routed ClickHouse member
    Then the metric_data_points and metric_usage_estimates rows exist in container B (private)
    And no metric row for that project exists in container A (shared)

  @integration
  Scenario: Metric reads for a private-CH org come from the private instance only
    Given a metric data point for a project under org "private-org" exists in container B (private)
    When that project's data points are read through the routed ClickHouse member
    Then the point is returned
    And the read never consults container A (shared)

  @integration
  Scenario: Another org's metric reads never see a private-CH org's points
    Given a metric data point for a project under org "private-org" exists in container B (private)
    When a project under org "shared-org" reads data points by that point id
    Then nothing is returned

  @integration
  Scenario: Metric writes for a private-CH org fail retryably while its private instance is down
    Given the private instance for org "private-org" is unreachable
    When a metric data point is written for a project under org "private-org"
    Then the write fails with a transient storage error, which the OTLP door answers as a retryable 503
    And no metric row for that project exists in container A (shared)
    And a metric data point written for a project under org "shared-org" still lands in container A (shared)

  @integration
  Scenario: Coding-agent sessions for a private-CH org land in the private instance only
    Given a project under org "private-org"
    When a coding-agent session row is projected through the routed ClickHouse member
    Then the coding_agent_sessions row exists in container B (private)
    And no coding-agent session row for that project exists in container A (shared)

  @integration
  Scenario: Coding-agent session reads for a private-CH org come from the private instance only
    Given a coding-agent session for a project under org "private-org" exists in container B (private)
    When the session is read by id through the coding-agent repository
    Then the session is returned

  @integration
  Scenario: Another org's coding-agent reads never see a private-CH org's sessions
    Given a coding-agent session for a project under org "private-org" exists in container B (private)
    When a project under org "shared-org" reads that session id
    Then nothing is returned

  @integration
  Scenario: Coding-agent projection writes for a private-CH org fail retryably while its private instance is down
    Given the private instance for org "private-org" is unreachable
    When a coding-agent session row is projected for a project under org "private-org"
    Then the write fails with a transient storage error, so the worker retries it
    And no coding-agent session row for that project exists in container A (shared)
    And a session projected for a project under org "shared-org" still lands in container A (shared)
