Feature: Structured Logging and Alerting for ClickHouse Query Failures

  ClickHouse query failures (OOM, timeout, network, syntax) need structured
  logging with metadata so they surface proactively via dashboards and alerts,
  rather than waiting for users to report blank charts.

  Background:
    Given a resilient ClickHouse client wrapper

  # ---------------------------------------------------------------------------
  # Error classification
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: ClickHouse errors are classified into well-known categories
    When a ClickHouse error occurs
    Then the error is classified as one of: oom, timeout, network, rate_limit, unavailable, syntax, or unknown
    And the classification is based on error message content, errno code, or HTTP status

  @unit @regression
  Scenario: Transient errors are distinguished from permanent errors
    When a ClickHouse error is classified
    Then oom, timeout, network, rate_limit, and unavailable are considered transient
    And syntax and unknown errors are not transient

  # ---------------------------------------------------------------------------
  # Structured logging
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Query failures are logged with structured metadata
    When a ClickHouse query fails
    Then a structured error log is emitted with source, operation, errorType, durationMs, and error message
    And the log is tagged with source "clickhouse" to distinguish from general application errors

  @unit @regression
  Scenario: Query successes are logged at debug level
    When a ClickHouse query succeeds
    Then a structured debug log is emitted with source, operation, durationMs, and queryId

  @unit @regression
  Scenario: Sensitive data is excluded from logs
    When a ClickHouse query is logged
    Then full SQL text and query parameter values are not included
    And only safe metadata is logged: queryId, format, parameter key names, and table name

  # ---------------------------------------------------------------------------
  # Prometheus metrics
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Query outcomes increment Prometheus counters
    When a ClickHouse query completes (success or failure)
    Then a query count metric is incremented with operation type and outcome
    And a query duration metric is recorded with operation type and table name

  # ---------------------------------------------------------------------------
  # Failure rate alerting
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Alert fires when failure rate exceeds threshold
    Given a failure rate monitor with a configurable threshold and time window
    When the number of failures within the window reaches the threshold
    Then a fatal-level alert log is emitted with alert flag and recent error type

  @unit @regression
  Scenario: Alert cooldown prevents repeated alert floods
    Given a failure rate monitor that has already fired an alert
    When more failures occur within the cooldown period
    Then no additional alert is fired
    And when the cooldown period expires and threshold is breached again
    Then a new alert fires

  @unit @regression
  Scenario: Old failures outside the time window are pruned
    Given a failure rate monitor with a 60-second window
    When failures occur and then 61 seconds pass
    Then the old failures no longer count toward the threshold

  # ---------------------------------------------------------------------------
  # Retry behavior (insert only)
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Transient insert errors are retried with exponential backoff
    When an insert fails with a transient error
    Then the insert is retried up to the configured maximum
    And each retry uses jittered exponential backoff

  @unit @regression
  Scenario: Non-transient insert errors fail immediately
    When an insert fails with a non-transient error (e.g. syntax)
    Then the insert is not retried
    And a structured error log is emitted

  @unit @regression
  Scenario: Queries are not retried on failure
    When a query fails with any error type
    Then the query is not retried
    And a structured error log is emitted

  # ---------------------------------------------------------------------------
  # Proxy pass-through
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Non-query operations pass through to the underlying client
    When command, close, or other client methods are called
    Then they delegate directly to the underlying ClickHouse client without interception
