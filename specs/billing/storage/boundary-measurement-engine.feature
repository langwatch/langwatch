Feature: Storage billing boundary measurement engine
  As a billing system
  I measure data only at the moments it crosses a billing boundary
  So that storage billing never re-counts an organization's full data pile

  # ADR-039 phase 2 of 4: the engine running dark behind a metering flag.
  # No Stripe calls in this phase. Ambient ingest traffic is the clock — no cron.

  Background:
    Given the storage metering flag is enabled

  # Sweep trigger

  @integration @unimplemented
  Scenario: The sweep runs once per sealed hour regardless of ingest volume
    Given the current sealed hour was already swept
    When 1000 more ingest events arrive within the same hour
    Then no additional measurement work is performed

  @integration @unimplemented
  Scenario: The once-per-hour guarantee survives a process restart
    Given the current sealed hour was swept before a worker restart
    When an ingest event wakes the restarted worker within the same hour
    Then no additional measurement work is performed

  @integration @unimplemented
  Scenario: Ingest from any organization triggers measurement for all billable organizations
    Given two billable organizations where only one is actively ingesting
    When a new sealed hour is swept
    Then both organizations get their gauge sampled for that hour

  @integration @unimplemented
  Scenario: A failing organization does not block the rest of the sweep
    Given three billable organizations where one fails during measurement
    When the sweep runs
    Then the other two organizations are measured and sampled normally

  @integration @unimplemented
  Scenario: Missed hours are filled by one ordered catch-up replay
    Given an organization with 6 hours of unsampled gauge history
    When the sweep runs
    Then all 6 hourly rows are produced in order from a single replay

  @integration @unimplemented
  Scenario: A caught-up hour records its true historical value, never the current one
    Given the gauge changed between a missed hour and now
    When the missed hour is caught up
    Then its hourly row records the gauge value as of that hour
    And not the gauge value at catch-up time

  # Entries

  @integration @unimplemented
  Scenario: Data aging past 35 days increases the gauge that day
    Given an organization with 63-day retention and a partition slice turning 35 days old
    When the daily crossing is measured
    Then an entry event with that slice's bytes is recorded
    And the gauge increases by the same amount

  @integration @unimplemented
  Scenario: Measuring a crossing reads only the crossing week partition
    Given an organization with 40 weeks of stored data
    When one partition's daily crossing is measured
    Then only that single week partition is queried

  # Exits

  @integration @unimplemented
  Scenario: Data reaching its retention age decreases the gauge without a query
    Given a recorded entry for a partition slice under 63-day retention
    When the slice reaches 63 days of age
    Then a mirroring exit event is recorded without querying ClickHouse
    And the gauge decreases by the recorded entry amount

  # Corrections

  @integration @unimplemented
  Scenario: Deleting a project lowers the bill the same hour
    Given a project whose data contributes 5 GiB to the organization gauge
    When the project is deleted
    Then negative events for the affected partitions are recorded before deletion
    And the next hourly sample reflects the 5 GiB drop

  @integration @unimplemented
  Scenario: A privacy erasure request lowers the bill before the data is erased
    Given an erasure request covering billable data
    When the erasure is executed
    Then the affected partitions are measured and negative events recorded before deletion
    And the gauge decreases by the erased amount

  @integration @unimplemented
  Scenario: A retention policy change re-books affected data under the new retention
    Given an organization gauge built under 63-day retention
    When retention changes to 91 days
    Then the old retention group's events are reversed and re-emitted under 91 days
    And the gauge value is unchanged while future exits move to day 91

  # Sampling

  @unit @unimplemented
  Scenario: The sampled hourly value is never negative
    Given an organization gauge that folded to a negative value due to a defect
    When the hour is sampled
    Then the hourly row records zero megabytes

  @integration @unimplemented
  Scenario: A gauge negative beyond tolerance raises a drift alarm without blocking sampling
    Given an organization gauge far below zero
    When the hour is sampled
    Then a drift alarm is raised for that organization
    And the hourly row is still written as zero megabytes

  @integration @unimplemented
  Scenario: With the metering flag off the engine stays fully dark
    Given the storage metering flag is disabled
    When sealed hours pass with active ingestion
    Then no boundary events, gauge changes, or hourly rows are produced
