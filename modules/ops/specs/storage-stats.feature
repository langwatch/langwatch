Feature: ClickHouse storage stats, measured once and exported everywhere
  As an operator alerting on table size, disk space and backups
  I want every LangWatch process to export the same fresh storage gauges
  So that a scrape of any replica reports what ClickHouse is holding now.

  # Main measured every 15s on every worker replica, each publishing its own
  # gauges. Here (ruled 2026-09-23) one scheduled process measures once across
  # the fleet every 15s and saves the readings to ops-owned shared state
  # (Redis, with a memory twin); each process's gauges read that state on
  # export, api and worker alike. Only the shared ClickHouse is measured, as on
  # main; readings carry the endpoint as the "instance" label ("shared").

  @unit @storage-stats @schedule
  Scenario: Storage is measured every fifteen seconds as a scheduled process
    Given Ops's storage-stats pipeline is installed
    When the schedule wakes
    Then one measurement is asked for, keyed by that wake
    And the next wake comes fifteen seconds later

  @unit @storage-stats
  Scenario: A measurement saves each endpoint's reading to the shared readings
    Given the shared ClickHouse holds rows in a monitored table
    When a measurement is delivered
    Then the endpoint's tables, disks and backup counts are saved where every process reads them

  @unit @storage-stats
  Scenario: Every process exports the reading the one measurement saved
    Given an api process and a worker process reading the same shared readings
    When the worker running the storage-stats process measures
    Then both processes export the same table sizes
    And a later measurement's sizes are what each process exports next

  @unit @storage-stats
  Scenario: A measurement whose backup read fails keeps the last backup it knew
    Given a saved reading with a last successful backup
    When the next reading of that endpoint carries no last backup
    Then its tables and backup counts are replaced
    And the last successful backup is still exported

  @unit @storage-stats @schedule
  Scenario: A failed measurement waits for the next wake
    Given the measurement fails on its first delivery
    When the measurement is delivered
    Then the delivery settles without an error
    And the next wake measures again
