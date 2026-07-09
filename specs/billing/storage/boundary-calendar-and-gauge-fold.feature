Feature: Storage billing boundary calendar and gauge fold
  As a billing system
  I compute exactly when stored data enters and leaves the billable window
  So that a per-organization running gauge can replace re-counting all stored data every hour

  # ADR-039 phase 1 of 4: tables + pure math. No queues, no ClickHouse, no Stripe.
  # Data is billable when it is older than 35 days AND still under retention.

  Background:
    Given data is stored in week partitions
    And each row carries its own retention days

  # Boundary calendar

  @unit @unimplemented
  Scenario: Retention below 35 days produces no billing boundaries
    Given a week partition with 30-day retention
    When crossing dates are computed
    Then no entry or exit dates are produced
    And the data is never billable

  @unit @unimplemented
  Scenario: Retention of exactly 35 days nets to zero and is skipped
    Given a week partition with 35-day retention
    When crossing dates are computed
    Then entry and exit coincide
    And no events are scheduled for the partition

  @unit @unimplemented
  Scenario: A week partition crosses the billable line over 7 consecutive days
    Given a week partition with 63-day retention
    When crossing dates are computed
    Then 7 daily entry dates are produced, one per day of the week slice

  @unit @unimplemented
  Scenario: Exit dates mirror entry dates shifted by retention minus 35 days
    Given a week partition with 63-day retention
    When crossing dates are computed
    Then each exit date is exactly 28 days after its matching entry date

  # Event identity and deduplication

  @unit @unimplemented
  Scenario: Recording the same entry slice twice stores one event
    Given an entry event for a partition day slice
    When the same slice is recorded again
    Then only one event exists for that slice

  @unit @unimplemented
  Scenario: An exit event is never deduplicated against its matching entry
    Given a recorded entry event for a partition day slice
    When the mirroring exit event is recorded
    Then both events exist
    And the fold of the two nets to zero

  @unit @unimplemented
  Scenario: Seed and entry events for the same slice collapse into one
    Given a seed event for a partition day slice
    When an entry event for the same slice is recorded
    Then only one event exists for that slice

  @unit @unimplemented
  Scenario: Corrections from different causes are distinct events
    Given a retention change from 63 to 91 days emits correction events
    When a later change from 91 back to 63 days emits its own corrections
    Then the two correction sets do not deduplicate against each other
    And the folded gauge matches a fresh computation at 63-day retention

  # Fold

  @unit @unimplemented
  Scenario: Entry events increase the gauge by their bytes
    Given an organization gauge of 10 GiB
    When an entry event of 2 GiB is folded
    Then the gauge reads 12 GiB

  @unit @unimplemented
  Scenario: Exit events decrease the gauge by their bytes
    Given an organization gauge of 10 GiB
    When an exit event of 3 GiB is folded
    Then the gauge reads 7 GiB

  @integration @unimplemented
  Scenario: Folding the full event log reproduces the gauge row
    Given an organization with a mix of entry, exit, and correction events
    When all events are folded from scratch
    Then the result equals the stored gauge value
