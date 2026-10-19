Feature: A lookup by id reads only the partitions its id index names

  Our large ClickHouse tables are partitioned by time but often looked up by id
  alone, with no time to prune on, so a lookup walks every partition, cold ones
  included. Each such table gets a small unpartitioned id index, filled by a
  materialised view on insert, that maps an id to the time range its rows live in.
  A lookup asks the index first and reads the source with that exact bound.
  (dev/docs/plans/id-index-2026-10-10.md)

  Background:
    Given a time-partitioned table with an id index owned by the same module

  @integration @unimplemented
  Scenario: a lookup by id reads only the partitions the index names
    Given a record written eight weeks ago
    When it is looked up by its id alone
    Then the read is bounded to the index's time range, widened by one day each side
    And it touches only the partitions inside that range
    And it is recorded as an index hit

  @integration @unimplemented
  Scenario: inserting a record fills its index row in the same insert
    When a record is inserted into the source table
    Then its id index row exists without any application code writing it

  @integration @unimplemented
  Scenario: a trace's spans arriving over time widen its index range
    Given a trace whose first span started on Monday
    When a late span from the same trace starting on Thursday is stored
    Then the trace's index range covers Monday to Thursday
    And a lookup of the trace's spans returns both spans

  @integration @unimplemented
  Scenario: a span lookup hits before the trace summary is projected
    Given a trace whose spans are stored but whose summary is not yet projected
    When its spans are looked up by trace id
    Then the read is bounded by the trace index and returns the spans

  @integration @unimplemented
  Scenario: an id the index has never seen probes recent data once and stops
    Given the index's backfill has completed
    And no record exists for the id
    When it is looked up by its id alone
    Then the read probes only the recent window and returns nothing
    And it never scans without a time bound
    And it is recorded as an index miss

  @integration @unimplemented
  Scenario: the index expires with the data it points at
    Given a record in a project with a 30-day retention
    When the record's last row passes its retention
    Then its index row expires on the same retention, never before the source rows

  @unit @unimplemented
  Scenario: the index table has no partition key
    When the id index migrations are read
    Then no id index table declares a PARTITION BY
    And each is ordered by tenant then id

  @integration @unimplemented
  Scenario: the backfill fills existing records and can run twice
    Given records stored before the index existed
    When the background backfill step runs, is interrupted, resumes and runs again
    Then every existing id has an index row covering all of its rows
    And running it again changes no index range

  @integration @unimplemented
  Scenario: until the backfill completes, a lookup keeps today's fallback
    Given the index's backfill step has not completed
    When a record is looked up by its id alone
    Then the read uses the existing windowed fallback rather than trusting the index

  @integration @unimplemented
  Scenario: replaying an aggregate reads only the weeks its events span
    Given an aggregate whose events span three weeks, a year ago
    When its events are read for replay with no lower bound
    Then the read touches only those weeks' partitions
    And events with an unknown occurred time are still included
