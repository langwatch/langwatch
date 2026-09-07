Feature: Integration test files run one at a time
  As a developer whose integration suites share a ClickHouse schema and a Redis instance
  I want concurrent files to be impossible unless they are asked for by name
  So that a suite replaying a migration cannot rebuild a table underneath a suite reading it

  # Vitest implements `fileParallelism: false` by clamping the worker count to
  # one and nothing else, and it applies VITEST_MAX_WORKERS after that clamp.
  # A runner that exports a worker count therefore gets concurrent files while
  # the config still reads `fileParallelism: false` and the reporter still
  # prints one run. The suites that replay goose migrations rebuild shared
  # rollup tables in place, so the second file reads a column that briefly does
  # not exist or an aggregate that reads as zero until reconciliation lands.

  Rule: a worker count from the environment cannot re-enable concurrent files

    @unit
    Scenario: The runner exports a worker count while files are serial
      Given the environment asks for two vitest workers
      And concurrent files have not been asked for
      When the integration config is loaded
      Then the worker count from the environment is withdrawn

    @unit
    Scenario: Concurrency is asked for deliberately
      Given the environment asks for two vitest workers
      And concurrent files have been asked for
      When the integration config is loaded
      Then the worker count from the environment is honoured

  Rule: a worker that should not exist fails loudly

    @unit
    Scenario: A second worker starts while files are serial
      Given concurrent files have not been asked for
      When a test file starts on a worker slot above the first
      Then the run fails naming the worker count that re-enabled concurrency

    @unit
    Scenario: The only worker starts
      Given concurrent files have not been asked for
      When a test file starts on the first worker slot
      Then the run proceeds

    @unit
    Scenario: A second worker starts in a deliberately parallel run
      Given concurrent files have been asked for
      When a test file starts on a worker slot above the first
      Then the run proceeds
