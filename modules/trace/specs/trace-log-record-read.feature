Feature: Trace reads trace-correlated log records from log's tables
  Log owns its log records and shares log_records for reading with trace, so trace keeps no
  copy of them. Trace reads log_records beside the legacy stored_log_records, which a release
  before the canonical cutover wrote, until those rows age out under their own retention.

  @unit
  Scenario: Trace reads a trace's logs from log's shared log records
    Given log holds two records correlated to one trace
    When a caller reads the trace's logs
    Then the read answers both records, oldest first

  @unit
  Scenario: A record only in the legacy stored log records stays readable
    Given a record a release before the cutover wrote to stored_log_records only
    When a caller reads the trace's logs
    Then the read answers that record beside log's records

  @unit
  Scenario: A record both tables hold is answered once, as log holds it
    Given a record stored_log_records and log_records both hold, with divergent bodies
    When a caller reads the trace's logs
    Then the read answers the record once, with log's body

  @unit
  Scenario: A batch read answers each trace's own records in one read per table
    Given log holds records correlated to three traces
    When a caller reads the logs of all three traces at once
    Then each table is read once for the whole batch
    And each trace answers only its own records, oldest first

  @integration
  Scenario: A batch read caps each trace at its own row limit
    Given two traces, one holding more records than the per-trace cap
    When a caller reads the logs of both traces at once with that cap
    Then the larger trace answers its oldest records up to the cap
    And the smaller trace answers all of its records

  @integration
  Scenario: A batch read of the legacy stored records answers each record's latest version
    Given stored_log_records holds two versions of one record and more records than the cap
    When a caller reads the logs of both traces at once with that cap
    Then each record answers its latest version, oldest first
    And each trace stops at its own cap

  @integration
  Scenario: A batch read bounds each trace by its own time window
    Given a batch holds two traces months apart
    When a caller reads the logs of both traces at once
    Then each trace answers only the records inside its own window

  @unit
  Scenario: A batch of coding-agent traces joins each trace to its own logs
    Given two coding-agent traces holding different log rows
    When one batch read enriches both traces
    Then each trace's spans carry only its own log content

  @unit
  Scenario: A failed batch log read keeps the traces' attribute-only inputs
    Given the batch log read fails
    When the read enriches the coding-agent traces
    Then each trace keeps the input it carries in its span attributes

  @unit
  Scenario: A page of coding-agent traces reads its logs a batch at a time
    Given a multi-trace read answers 95 coding-agent traces
    When the read enriches their spans from the trace logs
    Then the logs are read in 10 batched reads, one at a time
    And no trace is read on its own
