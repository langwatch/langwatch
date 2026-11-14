Feature: Every ClickHouse statement reports how it ended
  As an operator of a ClickHouse cluster
  I want each read and write logged and counted once its retries settle
  So that failures, latency and cold scans show up on the dashboards main already reads

  @unit
  Scenario: A read that succeeds is timed and counted as a success
    Given the routed ClickHouse client reports its statements
    When a read against a time-partitioned table filters on its partition column
    Then its duration is observed under its query type and table
    And it is counted as a success, with no cold-scan warning

  @unit
  Scenario: A read with no partition predicate is warned about as a cold scan
    Given the routed ClickHouse client reports its statements
    When a read against a time-partitioned table has no predicate on its partition column
    Then a cold-scan warning names the table it walked

  @unit
  Scenario: A read that declares a full-history scan is not warned about
    Given the routed ClickHouse client reports its statements
    When a maintenance read sets SKIP_COLD_SCAN_CHECK with a comment giving the reason
    Then it is counted as a success, with no cold-scan warning
    And the same read without the declaration is still warned about

  @unit
  Scenario: A table named only in a string literal is not a cold scan
    Given the routed ClickHouse client reports its statements
    When a read of system.mutations filters on the literal 'trace_summaries'
    Then no cold-scan warning names trace_summaries

  @unit
  Scenario: A statement that fails is reported and still reaches its caller
    Given the routed ClickHouse client reports its statements
    When a read fails after its retries
    Then the failure is logged and counted as an error
    And the caller receives the original error

  @unit
  Scenario: A write is counted as an insert against its table
    Given the routed ClickHouse client reports its statements
    When a batch is inserted
    Then it is counted as an INSERT success against the table it wrote to

  @unit
  Scenario: The process member counts statements under main's metric names
    Given a process that built its ClickHouse member
    When a read reaches the server
    Then clickhouse_query_duration_seconds and clickhouse_query_total record it by query type

  @unit
  Scenario: A cold scan warns once per query shape per hour
    Given the routed ClickHouse client reports its statements
    When the same cold-scanning statement runs again with other literals inside the hour
    Then only the first run is logged as a warning
    And the next warning after the hour counts the runs it held back
    And a statement of another shape warns on its own
