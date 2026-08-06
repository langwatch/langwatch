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

  # @unimplemented: needs a dedicated test that asserts the structured log
  # objects do NOT contain raw `query` text or `query_params` values — the
  # current resilient-client tests only assert the presence of source/operation/
  # durationMs fields, not the absence of sensitive fields. Cheap to add when
  # someone touches this path.
  @unit @regression @unimplemented
  Scenario: Sensitive data is excluded from logs
    When a ClickHouse query is logged
    Then full SQL text and query parameter values are not included
    And only safe metadata is logged: queryId, format, parameter key names, and table name

  # ---------------------------------------------------------------------------
  # Retry behavior
  #
  # Reads retry transient ClickHouse failures (overload, connection,
  # cluster-recovery); that behaviour lives in
  # clickhouse-concurrency-resilience.feature. Inserts do not retry here, and
  # the scenarios for that stay in this file next to the logging they emit.
  #
  # Inserts are only ever issued from a queued job, which retries the whole job
  # on its own backoff, so retrying again at the client multiplies attempts
  # rather than adding resilience. It is also the unsafe half: these are async
  # inserts with deduplication left at ClickHouse's default of off, so a failure
  # raised after the server has buffered the batch can still flush, and a retry
  # writes the rows twice.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Insert failures are not retried by the client
    Given every insert is issued from a job the queue will retry
    When an insert fails with a transient error
    Then the insert is attempted exactly once
    And the failure is raised to the caller for the queue to retry

  @unit @regression
  Scenario: Non-transient insert errors fail immediately
    When an insert fails with a non-transient error (e.g. syntax)
    Then the insert is not retried
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
