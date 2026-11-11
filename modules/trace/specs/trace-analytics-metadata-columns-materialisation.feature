Feature: The trace analytics metadata columns are stored in existing rows after an upgrade
  Goose migration 00126 adds nine columns to trace_analytics, each computed from one metadata
  key of the row's Attributes, and starts one ClickHouse mutation that stores them in the parts
  written before it. A background upgrade step waits on that mutation so the Upgrades page shows
  its progress and its failure. Until it finishes, an older part computes the value on read.

  @unit
  Scenario: The step finishes once ClickHouse has stored the metadata columns
    Given the columns' mutation is recorded as done
    When the step runs
    Then it finishes with that mutation and starts no other

  @unit
  Scenario: The step starts storing the metadata columns once when no mutation is recorded
    Given no mutation for the columns is recorded
    And an active trace_analytics part does not yet store the nine columns
    When the step runs
    Then it starts the columns' mutation once
    And it waits on the mutation that start recorded

  @unit
  Scenario: The step starts no mutation when the parts already store the metadata columns
    Given no mutation for the columns is recorded, since ClickHouse pruned the finished one
    And every active trace_analytics part already stores the nine columns
    When the step runs
    Then it finishes without starting a mutation

  @unit
  Scenario: The step waits for the columns when its started mutation is not listed yet
    Given no mutation for the columns is recorded
    And an active trace_analytics part does not yet store the nine columns
    When the step starts the columns' mutation and ClickHouse does not list it yet
    Then the step keeps polling while a part still lacks the columns
    And it finishes once every active part stores them

  @unit
  Scenario: A failed metadata-column mutation fails the step naming the columns
    Given the columns' mutation reports a failure reason
    When the step runs
    Then the step fails naming the trace_analytics metadata columns, the mutation and the reason

  @unit
  Scenario: The step saves its checkpoint before it starts the mutation
    Given no mutation for the columns is recorded
    And an active trace_analytics part does not yet store the nine columns
    When the step runs
    Then it saves a checkpoint before it starts the columns' mutation

  @unit
  Scenario: A resumed step waits for the columns without starting a second mutation
    Given an earlier run saved a checkpoint
    And no mutation for the columns is listed
    And an active trace_analytics part does not yet store the nine columns
    When the step resumes
    Then it starts no mutation
    And it finishes once every active part stores the columns

  @unit
  Scenario: A resumed step fails for an operator when no mutation is listed and the parts stay unfilled
    Given an earlier run saved a checkpoint
    And no mutation for the columns is listed
    And an active trace_analytics part still lacks the columns after one poll
    When the step resumes
    Then the step fails naming the trace_analytics metadata columns
    And it says an operator starts the fill by hand if none is running and retries the step
