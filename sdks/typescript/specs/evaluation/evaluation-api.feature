Feature: Evaluation API
  As a TypeScript developer using the LangWatch SDK
  I want to run offline batch evaluations on my LLM pipeline
  So that I can track metrics, compare targets, and visualize results in LangWatch

  # E2E: Happy paths demonstrating SDK usage with real API

  @e2e
  Scenario: Initialize an evaluation experiment
    Given I have a valid LangWatch API key
    When I call evaluation.init with experiment name "my-experiment"
    Then an experiment is created on the server
    And I receive a URL to view results

  @e2e
  Scenario: Run evaluation over dataset with automatic tracing
    Given I have initialized an evaluation
    And I have a dataset with 3 items
    When I call evaluation.run() with a callback
    Then the callback is called for each item with index and span
    And each iteration creates a trace span

  @e2e
  Scenario: Log custom metrics during evaluation
    Given I am inside an evaluation loop
    When I call evaluation.log with metric "accuracy" and score 0.95
    Then the metric is sent to LangWatch
    And it appears in the experiment results

  @e2e
  Scenario: Run built-in evaluator
    Given I am inside an evaluation loop
    When I call evaluation.run with "langevals/exact_match"
    Then the evaluator is called via the API
    And the result is logged automatically

  @e2e
  Scenario: Compare multiple targets with manual target specification
    Given I am inside an evaluation loop
    When I log metrics for target "gpt4" with metadata
    And I log metrics for target "claude" with metadata
    Then both targets appear in the experiment
    And I can compare them in the UI

  @e2e
  Scenario: Compare multiple targets with withTarget() wrapper
    Given I have initialized an evaluation
    And I have a dataset with 2 items
    When I call evaluation.run() with a callback that uses withTarget()
    And inside the callback I call:
      """
      await evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async (span) => {
        const response = await myLLM(item.question);
        evaluation.log("quality", { index, score: 0.95 });
      });

      await evaluation.withTarget("claude-3", { model: "anthropic/claude-3" }, async (span) => {
        const response = await myLLM(item.question);
        evaluation.log("quality", { index, score: 0.85 });
      });
      """
    Then each withTarget() creates a separate trace span
    And the target is automatically inferred from the span context
    And latency is captured automatically from span duration
    And metrics logged inside withTarget() are associated with that target

  @e2e
  Scenario: Automatic target context inference in nested calls
    Given I am inside a withTarget() block for "gpt-4"
    When I call evaluation.log("latency", { index, score: 100 }) without specifying target
    Then the target "gpt-4" is automatically inferred from context
    And the log is associated with the correct target

  @e2e
  Scenario: Parallel target execution within single dataset item
    Given I have initialized an evaluation
    And I have a dataset with 1 item
    When I call evaluation.run() and use Promise.all with multiple withTarget() calls:
      """
      await Promise.all([
        evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
          await simulateGPT4();
          evaluation.log("quality", { index, score: 0.9 });
        }),
        evaluation.withTarget("claude-3", { model: "anthropic/claude-3" }, async () => {
          await simulateClaude();
          evaluation.log("quality", { index, score: 0.85 });
        }),
      ]);
      """
    Then both targets execute in parallel
    And each has its own trace span
    And context is correctly isolated between concurrent withTarget() blocks

  # Integration: Edge cases and error handling

  @integration
  Scenario: Evaluation sends batched results
    Given I have initialized an evaluation
    When I log 5 metrics in quick succession
    Then the SDK batches them together
    And sends a single request to the API

  @integration
  Scenario: Parallel execution with concurrency control
    Given I have initialized an evaluation
    When I call evaluation.run() with concurrency=4
    And the dataset has 10 items
    Then callbacks run in parallel with max 4 concurrent
    And all items are processed

  @integration
  Scenario: Target metadata validation
    Given I registered target "gpt4" with metadata { model: "gpt-4" }
    When I try to register "gpt4" with different metadata
    Then an error is thrown
    And the message explains the conflict

  @integration
  Scenario: Graceful shutdown on error
    Given I am in the middle of an evaluation loop
    When an error occurs in my code
    Then the SDK sends a stopped_at timestamp
    And the experiment is marked as failed

  @integration
  Scenario: Retry on network failure
    Given the API returns a temporary error
    When the SDK tries to send results
    Then it retries with exponential backoff
    And eventually succeeds

  # Unit: Pure logic / isolated class behavior

  @unit
  Scenario: Dataset item serialization
    Given I have a dataset item with nested objects
    When it is serialized for the API
    Then complex objects are JSON stringified
    And the structure is preserved

  @unit
  Scenario: Trace ID extraction from span
    Given I have an active OpenTelemetry span
    When I log a metric
    Then the trace_id is extracted from the span context
    And included in the logged result

  @unit
  Scenario: Target context isolation with AsyncLocalStorage
    Given I have two concurrent withTarget() executions
    When target "gpt-4" is executing simultaneously with target "claude-3"
    Then log() calls inside "gpt-4" block infer target as "gpt-4"
    And log() calls inside "claude-3" block infer target as "claude-3"
    And there is no cross-contamination between async contexts

  @unit
  Scenario: Run ID generation
    Given I initialize an evaluation without a run_id
    Then a human-readable run_id is generated
    And it follows the adjective-adjective-noun pattern
