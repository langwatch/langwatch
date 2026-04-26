@integration
Feature: Monitor Execution with Evaluator Reference
  As a platform
  I want monitors to read settings from linked evaluators
  So that evaluator changes automatically apply to monitors

  Background:
    Given the evaluation worker is running
    And LangEvals service is available

  @unimplemented
  Scenario: Execute evaluation using evaluator settings
    Given a monitor with evaluatorId "evaluator_abc123"
    And the evaluator has config:
      | evaluatorType | langevals/exact_match |
      | settings      | { caseSensitive: false } |
    When a trace is processed that matches the monitor
    Then the evaluation should use settings from the Evaluator table
    And the settings should be { caseSensitive: false }

  @unimplemented
  Scenario: Backward compatibility with legacy monitors
    Given a monitor without evaluatorId
    And the monitor has parameters:
      | key           | value     |
      | caseSensitive | true      |
    When a trace is processed that matches the monitor
    Then the evaluation should use parameters from the Monitor table
    And the settings should be { caseSensitive: true }

  @unimplemented
  Scenario: Evaluator settings take precedence
    Given a monitor with both evaluatorId and parameters
    When a trace is processed
    Then the evaluation should use settings from the Evaluator
    And monitor parameters should be ignored

  @unimplemented
  Scenario: Handle missing evaluator gracefully
    Given a monitor with evaluatorId pointing to deleted evaluator
    When a trace is processed
    Then the evaluation should fail with a clear error
    And the error should indicate "Evaluator not found"

  @unimplemented
  Scenario: Thread-level evaluation fetches thread traces
    Given a monitor configured for thread-level evaluation
    And the mappings include thread type mappings
    And a trace with thread_id "thread123"
    When the evaluation runs
    Then all traces with thread_id "thread123" should be fetched
    And the traces should be passed to the evaluator as conversation

  @unimplemented
  Scenario: Thread-level with selectedFields
    Given a monitor with thread mapping:
      | field        | source | selectedFields     |
      | conversation | traces | ["input", "output"] |
    And thread "thread123" has 5 traces
    When the evaluation runs
    Then only input and output fields should be extracted from each trace
    And the conversation array should have 5 entries

  @unimplemented
  Scenario: Sampling applies correctly
    Given a monitor with sample rate 0.5
    When 100 traces are processed
    Then approximately 50 evaluations should be scheduled

  @unimplemented
  Scenario: Evaluation results stored correctly
    Given a monitor with evaluatorId
    When an evaluation completes successfully
    Then the result should be stored in Elasticsearch
    And the result should include the evaluator name
    And the result should include score/passed/details

  @unimplemented
  Scenario: Evaluation error handling
    Given an evaluator that will fail (e.g., invalid API key)
    When the evaluation runs
    Then the error should be captured
    And the evaluation status should be "error"
    And retry logic should apply (up to 3 attempts)

  @unimplemented
  Scenario: Cost tracking with evaluator reference
    Given an evaluator that uses LLM (incurs cost)
    When the evaluation runs successfully
    Then the cost should be tracked
    And the cost should be associated with the project

  @unimplemented
  Scenario: Concurrent evaluations for same trace
    Given a trace that matches multiple monitors
    When the trace is processed
    Then all matching evaluations should be scheduled
    And they should run in parallel

