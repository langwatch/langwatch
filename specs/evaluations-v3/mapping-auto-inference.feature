Feature: Mapping Auto-Inference
  As a user creating evaluations
  I want mappings to be automatically inferred when possible
  So that I don't have to manually map every field

  Background:
    Given I have an evaluation workbench open

  # ============================================================================
  # Basic Name Matching
  # ============================================================================

  Scenario: Auto-infer mapping for exact name match
    Given I have a dataset with columns:
      | name   |
      | input  |
      | output |
    When I add a runner with input field "input"
    Then "input" is automatically mapped to dataset column "input"

  Scenario: Auto-infer mapping for semantic equivalents
    Given I have a dataset with columns:
      | name       |
      | user_input |
      | response   |
    When I add a runner with input fields:
      | name     |
      | input    |
      | question |
    Then "input" is automatically mapped to "user_input"
    And "question" is automatically mapped to "user_input"

  Scenario: Recognize common column name variations
    Given I have a dataset with columns:
      | name            |
      | expected_output |
    When I add an evaluator with input "expected"
    Then "expected" is automatically mapped to "expected_output"

  # ============================================================================
  # Trigger Points
  # ============================================================================

  Scenario: Infer mappings when adding a runner to existing dataset
    Given I have a dataset "Dataset A" with columns "question, answer"
    When I add a runner with inputs "query"
    Then the runner's "query" is auto-mapped to "question" for "Dataset A"

  Scenario: Infer mappings when adding a dataset to existing runner
    Given I have a runner with input "question"
    When I add a dataset with columns "question, expected_output"
    Then the runner's "question" is auto-mapped to "question" for the new dataset

  Scenario: Infer mappings when runner inputs change
    Given I have a dataset with column "context"
    And I have a runner with input "question" mapped to "question"
    When I add a new input "context" to the runner
    Then "context" is automatically mapped to dataset column "context"

  # ============================================================================
  # Cross-Dataset Inference
  # ============================================================================

  Scenario: Propagate mappings to new dataset with same column names
    Given I have a dataset "Dataset A" with columns "input, expected_output"
    And I have a runner with input "question" mapped to "input" on "Dataset A"
    When I add a dataset "Dataset B" with columns "input, expected_output"
    Then "question" is automatically mapped to "input" on "Dataset B"

  Scenario: Propagate mappings using semantic equivalents
    Given I have a dataset "Dataset A" with column "input"
    And I have a runner with input "question" mapped to "input" on "Dataset A"
    When I add a dataset "Dataset B" with column "user_input" (but not "input")
    Then "question" is automatically mapped to "user_input" on "Dataset B"

  Scenario: Do not propagate if no matching column exists
    Given I have a runner with input "special_field" mapped to "foo" on "Dataset A"
    When I add a dataset "Dataset B" with columns "bar, baz"
    Then "special_field" has no mapping on "Dataset B"

  # ============================================================================
  # Evaluator Auto-Inference
  # ============================================================================

  Scenario: Auto-infer evaluator mappings for standard fields
    Given I have a dataset with columns "input, expected_output"
    And I have a runner producing output "output"
    When I add an evaluator with inputs:
      | name            |
      | output          |
      | expected_output |
    Then evaluator "output" is mapped to runner "output"
    And evaluator "expected_output" is mapped to dataset "expected_output"

  Scenario: Auto-infer evaluator mappings per runner
    Given I have runners "Runner A" and "Runner B"
    And "Runner A" outputs "answer" and "Runner B" outputs "result"
    When I add an evaluator with input "output"
    Then evaluator "output" is mapped to "answer" for "Runner A"
    And evaluator "output" is mapped to "result" for "Runner B"

  # ============================================================================
  # Semantic Mapping Dictionary
  # ============================================================================

  Scenario Outline: Map using semantic equivalents dictionary
    Given I have a dataset with column "<column>"
    When I add a runner with input "<field>"
    Then "<field>" is automatically mapped to "<column>"

    Examples:
      | field              | column             |
      | input              | question           |
      | input              | user_input         |
      | input              | user_query         |
      | question           | input              |
      | question           | user_input         |
      | output             | answer             |
      | output             | response           |
      | output             | result             |
      | expected_output    | expected_answer    |
      | expected_output    | ground_truth       |
      | context            | contexts           |
      | retrieved_contexts | contexts           |

  # ============================================================================
  # Priority and Conflict Resolution
  # ============================================================================

  Scenario: Exact name match takes priority over semantic match
    Given I have a dataset with columns "input, question"
    When I add a runner with input "input"
    Then "input" is mapped to "input" (not "question")

  Scenario: Do not override existing mappings
    Given I have a runner with "question" manually mapped to "foo"
    When auto-inference runs
    Then "question" remains mapped to "foo"

  Scenario: Do not infer for value mappings
    Given I have a runner with "question" set to value "Hello"
    When I add a new dataset with column "question"
    Then "question" remains set to value "Hello"
