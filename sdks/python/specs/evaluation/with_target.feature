Feature: target() context manager for multi-target evaluation
  As a Python developer using the LangWatch SDK
  I want to compare multiple LLM targets on the same dataset
  So that each target gets its own dataset entry with proper latency tracking

  Background:
    Given I have a valid LangWatch API key
    And I have initialized an evaluation with name "model-comparison"
    And I have a dataset with sample inputs

  # Core Functionality

  @unit
  Scenario: target creates dataset entry per target
    Given I am inside an evaluation loop
    When I use evaluation.target("gpt-4", {"model": "openai/gpt-4"})
    And I execute my LLM call inside the context
    Then a dataset entry is created with target_id="gpt-4"
    And the entry has the correct duration

  @unit
  Scenario: Multiple target calls create multiple dataset entries
    Given I am inside an evaluation loop at index 0
    When I call target("gpt-4") and execute a 100ms task
    And I call target("claude-3") and execute a 150ms task
    Then 2 dataset entries are created for index 0
    And entry for "gpt-4" has duration ~100ms
    And entry for "claude-3" has duration ~150ms

  @unit
  Scenario: target prevents duplicate row-level dataset entry
    Given I am inside an evaluation loop
    When I use target() at least once
    Then no separate row-level dataset entry is created
    And only target-specific entries exist

  # Context Inference

  @unit
  Scenario: log() infers target from target context
    Given I am inside evaluation.target("gpt-4")
    When I call evaluation.log("quality", index=0, score=0.95) without explicit target
    Then the evaluation result has target_id="gpt-4"

  @unit
  Scenario: log() with explicit target overrides context
    Given I am inside evaluation.target("gpt-4")
    When I call evaluation.log("quality", index=0, score=0.95, target="custom")
    Then the evaluation result has target_id="custom"

  @unit
  Scenario: log() with data= records output inside target context
    Given I am inside evaluation.target("gpt-4")
    When I call evaluation.log("quality", index=0, score=0.95, data={"output": "response"})
    Then the evaluation result has target_id="gpt-4"
    And the evaluation result has data={"output": "response"}

  # Parallel Execution (with submit)

  @integration
  Scenario: target works with evaluation.submit for parallel execution
    Given I am inside an evaluation loop with threads=4
    When I use evaluation.submit with a function containing target()
    Then each submitted task gets isolated target context
    And dataset entries are correctly associated with their targets

  @integration
  Scenario: Concurrent target calls have isolated contexts
    Given I am inside an evaluation loop
    When I submit two tasks in parallel:
      | Task A uses target("gpt-4") and logs "quality" |
      | Task B uses target("claude") and logs "quality" |
    Then Task A's log has target_id="gpt-4"
    And Task B's log has target_id="claude"
    And there is no cross-contamination between contexts

  # Error Handling

  @unit
  Scenario: target captures errors in dataset entry
    Given I am inside an evaluation loop
    When I use target("gpt-4") and an exception is raised
    Then the dataset entry has the error message
    And the error is re-raised after cleanup

  # Backwards Compatibility

  @unit
  Scenario: Evaluation works without target (existing behavior)
    Given I am inside an evaluation loop
    When I do NOT use target()
    And I call evaluation.log("metric", index=0, score=1.0)
    Then a single row-level dataset entry is created
    And the evaluation result has no target_id

  @unit
  Scenario: Explicit target parameter in log() still works
    Given I am inside an evaluation loop
    When I call evaluation.log("metric", index=0, score=1.0, target="my-target")
    Then the evaluation result has target_id="my-target"
