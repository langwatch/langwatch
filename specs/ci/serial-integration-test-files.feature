Feature: Integration test files run one at a time
  As a developer reading a red integration shard
  I want a failure to mean the code is wrong
  So that I stop rerunning jobs to find out whether it was

  # A shard's isolation is a property of its topology: one runner, one
  # ClickHouse, one Postgres, one Redis, and one file at a time inside it.
  # Concurrency across files was tried and withdrawn, because suites started
  # failing with state vanishing under them rather than with a wrong assertion.

  @unit
  Scenario: A worker cap never turns on file parallelism
    Given the runner caps how many workers vitest may use
    And the suite runs its files one at a time
    When the cap is applied
    Then vitest is left with the single worker serial files resolve to

  @unit
  Scenario: A worker cap still limits a parallel run
    Given the runner caps how many workers vitest may use
    And the suite runs its files in parallel
    When the cap is applied
    Then the cap reaches vitest unchanged

  # The scenarios below describe the test harness rather than the product, so
  # they are validated by running the suite, in the same spirit as
  # no-docker-integration-tests.feature.

  @unimplemented
  Scenario: A rollup rebuild never runs beside another suite's writes
    Given a suite replays the migration that rebuilds the budget rollup
    And that rebuild drops the rollup's materialised view while it runs
    When another suite records spend at the same moment
    Then the spend is recorded against a rollup that is whole
    And every budget window reports it

  @unimplemented
  Scenario: A rollup rebuild never runs beside another suite's reads
    Given a suite replays the migration that rebuilds the budget rollup
    And the rebuild re-derives every rollup row from the ledger
    When another suite reads spend back at the same moment
    Then it reads a rollup that is whole
    And it sees every row it recorded, not one short

  @unimplemented
  Scenario: Reading the rollup is enough to need the lock
    Given a suite never replays a migration itself
    And it writes the budget ledger or reads spend back from the rollup
    When it runs in the same shard as a suite that does replay one
    Then it waits for the rebuild rather than observing it half applied

  @unimplemented
  Scenario: Two rollup rebuilds never run at once
    Given two suites each replay the rollup rebuild
    When they run in the same shard
    Then one completes before the other begins
    And neither reports a scratch table that already exists or has vanished
    And no total is counted twice
