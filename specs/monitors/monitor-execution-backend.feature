@integration
Feature: Monitor Execution with Evaluator Reference
  As a platform
  I want monitors to read settings from linked evaluators
  So that evaluator changes automatically apply to monitors

  Background:
    Given the evaluation worker is running
    And LangEvals service is available

  Scenario: Execute evaluation using evaluator settings
    Given a monitor with evaluatorId "evaluator_abc123"
    And the evaluator has config:
      | evaluatorType | langevals/exact_match |
      | settings      | { caseSensitive: false } |
    When a trace is processed that matches the monitor
    Then the evaluation should use settings from the Evaluator table
    And the settings should be { caseSensitive: false }

  Scenario: Backward compatibility with legacy monitors
    Given a monitor without evaluatorId
    And the monitor has parameters:
      | key           | value     |
      | caseSensitive | true      |
    When a trace is processed that matches the monitor
    Then the evaluation should use parameters from the Monitor table
    And the settings should be { caseSensitive: true }

  Scenario: Evaluator settings take precedence
    Given a monitor with both evaluatorId and parameters
    When a trace is processed
    Then the evaluation should use settings from the Evaluator
    And monitor parameters should be ignored

  Scenario: Fetch evaluator in single query with monitor
    Given a monitor with evaluatorId
    When the worker processes the evaluation job
    Then the evaluator should be fetched with the monitor in a join
    To minimize database queries

  Scenario: Handle missing evaluator gracefully
    Given a monitor with evaluatorId pointing to deleted evaluator
    When a trace is processed
    Then the evaluation should fail with a clear error
    And the error should indicate "Evaluator not found"

  Scenario: Handle archived evaluator
    Given a monitor with evaluatorId pointing to archived evaluator
    When a trace is processed
    Then the evaluation should still execute
    Because archived evaluators should remain functional for existing monitors

  Scenario: Thread-level evaluation fetches thread traces
    Given a monitor configured for thread-level evaluation
    And the mappings include thread type mappings
    And a trace with thread_id "thread123"
    When the evaluation runs
    Then all traces with thread_id "thread123" should be fetched
    And the traces should be passed to the evaluator as conversation

  Scenario: Thread-level with selectedFields
    Given a monitor with thread mapping:
      | field        | source | selectedFields     |
      | conversation | traces | ["input", "output"] |
    And thread "thread123" has 5 traces
    When the evaluation runs
    Then only input and output fields should be extracted from each trace
    And the conversation array should have 5 entries

  Scenario: Sampling applies correctly
    Given a monitor with sample rate 0.5
    When 100 traces are processed
    Then approximately 50 evaluations should be scheduled

  Scenario: Preconditions filter traces
    Given a monitor with precondition "input contains PII"
    When a trace with input "Hello, my SSN is 123-45-6789" is processed
    Then the evaluation should be scheduled
    When a trace with input "Hello world" is processed
    Then the evaluation should NOT be scheduled

  Scenario: Evaluation results stored correctly
    Given a monitor with evaluatorId
    When an evaluation completes successfully
    Then the result should be stored in Elasticsearch
    And the result should include the evaluator name
    And the result should include score/passed/details

  Scenario: Evaluation error handling
    Given an evaluator that will fail (e.g., invalid API key)
    When the evaluation runs
    Then the error should be captured
    And the evaluation status should be "error"
    And retry logic should apply (up to 3 attempts)

  Scenario: Cost tracking with evaluator reference
    Given an evaluator that uses LLM (incurs cost)
    When the evaluation runs successfully
    Then the cost should be tracked
    And the cost should be associated with the project

  Scenario: Concurrent evaluations for same trace
    Given a trace that matches multiple monitors
    When the trace is processed
    Then all matching evaluations should be scheduled
    And they should run in parallel

  Scenario: Evaluation worker timeout
    Given an evaluator that takes a long time
    When the evaluation runs
    Then it should timeout after 5 minutes
    And the status should reflect the timeout

  Scenario: LangEvals API call structure
    Given a monitor with evaluatorId
    When the evaluation runs
    Then the LangEvals API should be called with:
      | field    | value                          |
      | endpoint | /{evaluatorType}/evaluate      |
      | settings | from evaluator.config.settings |
      | data     | mapped from trace              |
