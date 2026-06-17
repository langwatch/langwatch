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
  #
  # The auto-inference is restricted by INPUT IDENTITY so a confused-looking
  # mapping never lands ahead of an empty one:
  #
  #   - "output"-like fields (output, response, answer, result, generated)
  #     are ALWAYS sourced from the runner/target output, never the dataset.
  #     Mapping them to a dataset column would let the evaluator grade the
  #     dataset against itself, which is never what the user wants.
  #
  #   - "expected_output"-like fields (expected_output, expected_answer,
  #     ground_truth) and "input"-like fields (input, question, user_input,
  #     user_query, context, contexts, retrieved_contexts) are ALWAYS sourced
  #     from the dataset, never the runner/target output. The whole reason a
  #     dataset row carries an expected answer is for the evaluator to grade
  #     against it; reading it back from the runner would be a tautology.
  #
  # When no candidate column exists on the correct side, the mapping stays
  # empty — empty is recoverable, a wrong default mapping is not.

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

  @regression
  Scenario: "output" never falls back to a dataset column
    Given I have a dataset with column "output"
    And I have a runner with multiple outputs, none named like "output"
    When I add an evaluator with input "output"
    Then evaluator "output" has no auto-inferred mapping
    And the dataset's "output" column is NOT chosen

  @regression
  Scenario: "expected_output" never picks the runner output
    Given I have a runner producing output "expected_output"
    And I have a dataset with no column named like an expected answer
    When I add an evaluator with input "expected_output"
    Then evaluator "expected_output" has no auto-inferred mapping
    And the runner's "expected_output" output is NOT chosen

  @regression
  Scenario: "input" never picks the runner output
    Given I have a runner producing output "input"
    And I have a dataset with no column named like "input"
    When I add an evaluator with input "input"
    Then evaluator "input" has no auto-inferred mapping
    And the runner's "input" output is NOT chosen

  Scenario: Target output wins over a same-named dataset column for "output"
    Given I have a dataset with column "output"
    And I have a runner producing output "output"
    When I add an evaluator with input "output"
    Then evaluator "output" is mapped to the runner output "output"
    And the dataset's "output" column is not chosen

  # When an "output"-like evaluator field cannot be matched to a target output
  # by name, but the target exposes exactly ONE output, that single output is
  # the only sensible source, so it is auto-mapped. This covers the common
  # single-output classifier case (a target "category_classifier" whose one
  # output "category" does not match the evaluator field name "output").
  Scenario: Auto-map a target-output field to the target's only output when no name matches
    Given I have a runner producing a single output "category"
    And I have a dataset with columns "input, expected_output"
    When I add an evaluator with input "output"
    Then evaluator "output" is mapped to the runner output "category"
    And no manual mapping is required for "output"

  @regression
  Scenario: Do not guess a single output when the target has multiple outputs and no name matches
    Given I have a runner producing outputs "category" and "confidence"
    When I add an evaluator with input "output"
    Then evaluator "output" has no auto-inferred mapping

  # When manually mapping an evaluator field in the workbench, the source
  # selector offers the TARGET's outputs ahead of the dataset columns, so the
  # graded "output" field surfaces the runner's output first instead of a
  # same-named dataset column.
  @unimplemented
  Scenario: The evaluator mapping selector offers target outputs before dataset columns
    Given I open an evaluator's mapping drawer in the workbench
    Then the source selector lists the target's outputs before the dataset columns

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
