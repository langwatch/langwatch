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
    Then a structured log is emitted with source, operation, durationMs, and the cause
    And the log is tagged with source "clickhouse" to distinguish from general application errors

  # ---------------------------------------------------------------------------
  # Who owns the verdict
  #
  # A failed attempt is raised to a caller, and the caller is what knows how the
  # story ends: a read has its translated error surfaced at the request
  # boundary, and an insert is issued from a job the queue retries and, if it
  # finally gives up, drops loudly with its own error record and counter.
  #
  # This wrapper sees none of that. Reporting each attempt as an error made
  # recovered work indistinguishable from lost work — 17k records a day on one
  # service against zero jobs actually dropped. So the attempt is reported, and
  # the verdict is left to whoever has it.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A failed attempt raised to the caller is not itself an error
    When a ClickHouse query fails and the error is raised to the caller
    Then the attempt is logged at warning level
    And the failure is still counted for alerting

  # The field name is a contract, not just "anything but error" — log queries
  # read it by name, so a rename to some other wrong key breaks them just as
  # thoroughly as leaving it on "error" would.
  @unit @regression
  Scenario: The cause rides on the named query-cause field
    When a ClickHouse attempt fails
    Then the cause is attached under the field "queryError"
    And no field named "error" is emitted
    And the record does not claim a failure that the level did not establish

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
