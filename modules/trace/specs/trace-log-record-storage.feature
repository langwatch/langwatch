Feature: Trace keeps its own copy of trace-correlated log records
  Log owns log records and records each one as a fact. Trace maps that fact into its own
  stored_log_records, so its log reads (the logs read, Claude Code enrichment, transcripts)
  hold no log peer. Existing records arrive by a projection replay step over log's facts.

  @unit
  Scenario: Trace maps a trace-correlated log record into its own stored log records
    Given log records a record correlated to a trace and a span
    When trace's log record lane maps the fact
    Then trace stores the record in log's trace read shape, keyed by its record id
    And the record carries the tenant's trace retention

  @unit
  Scenario: A log record that names no trace is not stored by trace
    Given log records a record with no correlated trace
    When trace's log record lane maps the fact
    Then trace stores nothing

  @unit
  Scenario: A redelivered log record fact leaves one stored row
    Given log's record fact is delivered to trace twice
    When trace's log record lane maps both deliveries
    Then trace holds one row for the record

  @unit
  Scenario: Trace reads a trace's logs from its own stored log records
    Given trace stores two records for one trace, one of them written twice under two ids
    When a caller reads the trace's logs
    Then the read answers both records once, oldest first, without asking log

  @unit
  Scenario: Trace's log record lane is replayed over every log record at deploy
    Given log records made before trace's log record lane was installed on this deployment
    When the deploy's background steps run once no old worker remains
    Then trace's log record lane is replayed from the start of log's record log
