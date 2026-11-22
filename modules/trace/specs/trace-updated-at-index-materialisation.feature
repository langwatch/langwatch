Feature: The trace summaries updated-at index is built in the background after an upgrade
  Goose migration 00103 adds a skip index on trace_summaries.UpdatedAt and starts a ClickHouse
  mutation that builds it for existing rows. A background upgrade step waits on that mutation
  so the Upgrades page shows its progress and its failure.

  @unit
  Scenario: The step finishes once ClickHouse has built the index
    Given the index's mutation is recorded as done
    When the step runs
    Then it finishes with that mutation and starts no other

  @unit
  Scenario: The step saves progress while the mutation is still running
    Given the index's mutation has parts left to build
    When the step runs until the mutation completes
    Then it saves the mutation and its remaining parts after each check
    And it finishes once the mutation is done

  @unit
  Scenario: The step starts the build once when no mutation is recorded
    Given no mutation for the index is recorded
    When the step runs
    Then it starts the index build once
    And it waits on the mutation that build recorded

  @unit
  Scenario: The step finishes when the table has no such index
    Given no mutation for the index is recorded
    And starting the build records no mutation
    When the step runs
    Then it finishes with nothing left to build after one start

  @unit
  Scenario: A failed mutation fails the step in operator words
    Given the index's mutation reports a failure reason
    When the step runs
    Then the step fails naming the mutation and the reason

  @unit
  Scenario: A dry run reports the remaining parts and changes nothing
    Given the index's mutation has parts left to build
    When the step runs as a dry run
    Then it reports the remaining parts
    And it starts no build and saves no progress

  @unit
  Scenario: The step stops when it is asked to
    Given the index's mutation has parts left to build
    When the step is aborted while waiting
    Then it returns the progress it last saw without failing
