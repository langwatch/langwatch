Feature: Structured Logging for ClickHouse Queries

  ClickHouse query failures need structured logging with metadata (tracing,
  IDs, formats) so they surface in dashboards via log correlation, rather
  than waiting for users to report blank charts.

  Background:
    Given a resilient ClickHouse client wrapper

  # ---------------------------------------------------------------------------
  # Structured logging
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Query failures are logged with structured metadata
    When a ClickHouse query fails
    Then a structured error log is emitted with source, operation, durationMs, and error
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
  # Safety: logging never breaks DB operations
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Logging crashes do not affect query results
    When structured logging throws an error during a query
    Then the original ClickHouse result or error propagates normally

  # ---------------------------------------------------------------------------
  # Proxy pass-through
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Non-query operations pass through to the underlying client
    When command, close, or other client methods are called
    Then they delegate directly to the underlying ClickHouse client without interception
