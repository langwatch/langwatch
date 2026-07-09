Feature: Storage billing seeding and audits
  As a billing operator
  I backfill existing old data once and continuously verify the gauge against reality
  So that no customer is ever billed on a number that has not been proven

  # ADR-039 phase 3 of 4: trust the numbers before charging them.
  # Discrepancies always alarm a human — the system never auto-corrects money.

  # Seeding

  @integration @unimplemented
  Scenario: Seeding backfills data that was already billable at deploy time
    Given an organization with 60 GiB of data older than 35 days and a gauge of zero
    When the seeding command runs for that organization
    Then per-partition seed events are recorded
    And the gauge reads 60 GiB

  @integration @unimplemented
  Scenario: Re-running the seed produces no duplicate events
    Given an organization that was already seeded
    When the seeding command runs again
    Then no new events are recorded
    And the gauge is unchanged

  @integration @unimplemented
  Scenario: Seeding a partition mid-crossing does not double count
    Given a partition currently in its 7-day entry crossing with 3 daily entries recorded
    When the seeding command covers the same partition
    Then the folded gauge counts each day slice exactly once

  @integration @unimplemented
  Scenario: Unseeded old data never drives the gauge negative
    Given billable data that predates the engine and was never seeded
    When that data reaches its retention age and is deleted
    Then no exit event is recorded for it
    And the gauge does not go down

  # Fold audit (Postgres only)

  @integration @unimplemented
  Scenario: The daily fold audit recomputes every gauge from its event log
    Given organizations with stored gauge values
    When the fold audit runs
    Then each gauge is compared against a from-scratch fold of its events
    And no ClickHouse queries are issued

  @integration @unimplemented
  Scenario: A gauge that disagrees with its event log raises an alarm
    Given a gauge row that was corrupted to disagree with its events
    When the fold audit runs
    Then an alarm is raised for that organization
    And the gauge is not modified

  # Reference audit (ClickHouse, capped)

  @integration @unimplemented
  Scenario: The reference audit re-measures a bounded rotating slice per day
    Given an organization with 39 billable partitions
    When the reference audit runs on consecutive days
    Then each day re-measures at most the per-organization partition cap
    And every partition is re-measured within 7 days

  @integration @unimplemented
  Scenario: A reference mismatch alarms and is never auto-corrected
    Given recorded events that disagree with the re-measured partition bytes
    When the reference audit detects the mismatch
    Then an alarm is raised for that organization
    And no corrective events are written automatically

  @integration @unimplemented
  Scenario: An alarmed organization stays on daily audit permanently
    Given an organization whose audit alarm was resolved by an operator re-seed
    When audit schedules are next computed
    Then that organization remains on the daily audit tier

  @integration @unimplemented
  Scenario: Operator re-seed corrects a broken gauge with a full audit trail
    Given an organization flagged by an audit alarm
    When the operator re-runs the seeding path for it
    Then corrective events are recorded rather than the gauge being overwritten
    And the fold audit passes the next day
