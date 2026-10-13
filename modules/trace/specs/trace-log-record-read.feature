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
