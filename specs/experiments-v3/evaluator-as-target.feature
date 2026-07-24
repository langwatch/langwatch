@unit
Feature: Evaluator as evaluation target
  As a user configuring an evaluation
  I want to use an evaluator as a target
  So that I can evaluate the evaluator's behavior and compare evaluators

  # When an evaluator is used as a target, it becomes the "thing being tested"
  # instead of a prompt or agent. The dataset maps directly to the evaluator's
  # inputs, and the evaluator's outputs (passed, score, label) become the
  # target output. Downstream evaluators can then evaluate these outputs.

  Background:
    Given I render the EvaluationsV3 spreadsheet table

  # ============================================================================
  # Target type selection
  # ============================================================================
  @unimplemented
  Scenario: Evaluator card shows correct styling
    When I click the "+ Add" button
    Then the Evaluator card shows a checkmark icon
    And the Evaluator card has green styling

  # ============================================================================
  # Adding evaluator as target
  # ============================================================================

  @unimplemented
  Scenario: Add existing evaluator as target
    Given evaluator "Sentiment Check" of type "langevals/sentiment" exists
    When I click "+ Add"
    And I select "Evaluator"
    And I select evaluator "Sentiment Check"
    Then a new target column appears in the table
    And the target header shows the evaluator name with evaluator icon
    And the target type is "evaluator"
    And the target has outputs: passed, score, label

  @unimplemented
  Scenario: Evaluator target inputs derived from evaluator definition
    Given evaluator "Custom LLM Judge" with required fields ["output", "expected_output"] exists
    When I click "+ Add"
    And I select "Evaluator"
    And I select evaluator "Custom LLM Judge"
    Then the target has inputs: output, expected_output
    And I can map dataset columns to these inputs

  @unimplemented
  Scenario: Evaluator target has standard evaluator outputs
    Given evaluator "Exact Match" exists
    When I add it as a target
    Then the target has outputs:
      | identifier | type  |
      | passed     | bool  |
      | score      | float |
      | label      | str   |

  @unimplemented
  Scenario: Create new evaluator inline
    When I click "+ Add"
    And I select "Evaluator"
    And I click "+ New Evaluator" in the EvaluatorListDrawer
    Then the EvaluatorCategorySelectorDrawer opens
    When I configure and save a new evaluator
    Then the evaluator is saved to the database
    And the evaluator is added as a target to the evaluation

  # ============================================================================
  # Mapping and configuration
  # ============================================================================

  @unimplemented
  Scenario: Map dataset columns to evaluator target inputs
    Given an evaluator target "Sentiment Check" with input "output"
    And dataset column "response"
    When I map "output" to dataset column "response"
    Then the mapping is saved
    And execution will pass "response" value to the evaluator

  @unimplemented
  Scenario: Evaluator target shows missing mapping warning
    Given an evaluator target "Exact Match" with inputs ["output", "expected_output"]
    And only "output" is mapped
    Then the target column header shows a warning indicator
    And hovering shows tooltip about unmapped inputs

  @unimplemented
  Scenario: Value mapping works for evaluator targets
    Given an evaluator target with input "threshold"
    When I set a value mapping of "0.8" for "threshold"
    Then the mapping is saved
    And execution will use literal value "0.8" for threshold

  # ============================================================================
  # Target header and UI
  # ============================================================================
  @unimplemented
  Scenario: Evaluator target header shows popover on click
    Given an evaluator target "Sentiment Check" is configured
    When I click on the target header "Sentiment Check"
    Then a popover menu appears with options:
      | Edit Evaluator       |
      | Remove from Workbench|

  @unimplemented
  Scenario: Edit evaluator target opens evaluator editor
    Given an evaluator target "Sentiment Check" is configured
    When I click on the target header "Sentiment Check"
    And I click "Edit Evaluator" in the popover
    Then the EvaluatorEditorDrawer opens
    And I can view the evaluator settings

  # ============================================================================
  # Execution
  # ============================================================================

  @unimplemented
  Scenario: Execute evaluator target
    Given an evaluator target "Exact Match" is configured
    And input "output" is mapped to dataset column "response"
    And input "expected_output" is mapped to dataset column "expected"
    When I run the evaluation
    Then the evaluator executes for each row
    And the target output shows passed/score/label for each row

  @unimplemented
  Scenario: Evaluator target result displays in cell
    Given an evaluator target completed execution
    Then the cell shows the evaluator result
    And I see passed status (checkmark or X)
    And I see the score value
    And I see the label if present

  # ============================================================================
  # Meta-evaluation (evaluators on evaluator targets)
  # ============================================================================

  @unimplemented
  Scenario: Add downstream evaluator to evaluator target
    Given an evaluator target "First Evaluator" is configured
    When I add evaluator "Pass Rate Check" to the evaluation
    Then "Pass Rate Check" can evaluate the outputs of "First Evaluator"

  @unimplemented
  Scenario: Map downstream evaluator to evaluator target outputs
    Given an evaluator target "First Evaluator" is configured
    And an evaluator "Score Threshold" is added to the evaluation
    When I configure "Score Threshold" mappings
    Then I can map input "value" to "First Evaluator" output "score"
    And I can map input "threshold" to a literal value

  @unimplemented
  Scenario: Execute with downstream evaluator on evaluator target
    Given an evaluator target "Sentiment Check" is configured
    And an evaluator "Pass Rate Check" maps input "passed" to "Sentiment Check" output "passed"
    When I run the evaluation
    Then "Sentiment Check" executes first
    And "Pass Rate Check" receives the passed value from "Sentiment Check"
    And both results are displayed in the UI

  # ============================================================================
  # Comparison flow
  # ============================================================================

  @unimplemented
  Scenario: Compare two evaluators
    Given evaluator "Evaluator A" exists
    And evaluator "Evaluator B" exists
    When I add "Evaluator A" as a target
    And I click "+ Add Comparison"
    And I select "Evaluator"
    And I add "Evaluator B" as a target
    Then 2 target columns show the different evaluators
    And I can compare their outputs side by side

  @unimplemented
  Scenario: Compare evaluator with prompt
    Given evaluator "Sentiment Check" exists
    And prompt "Sentiment Classifier" exists
    When I add evaluator "Sentiment Check" as a target
    And I click "+ Add Comparison"
    And I add prompt "Sentiment Classifier" as a target
    Then I can compare evaluator vs prompt outputs

  # ============================================================================
  # Persistence
  # ============================================================================

  @unimplemented
  Scenario: Evaluator target is saved with experiment
    Given an evaluator target "Sentiment Check" is configured
    When the experiment is saved
    And I reload the page
    Then the evaluator target is restored
    And the target has the correct dbEvaluatorId
    And the mappings are preserved

  # ============================================================================
  # Type coercion when piping a target output into a downstream evaluator input
  # ============================================================================
  #
  # An evaluator-as-target emits typed outputs: passed (bool), score (float),
  # label (str). A downstream string-input evaluator (Exact Match, LLM Answer
  # Match, etc.) accepts those outputs without surfacing the customer-visible
  # "Validation error: Expected string, received boolean" rejection. The
  # workbench live-execute path coerces the mapped value to the evaluator's
  # declared input type before the request is validated, matching the
  # coercion the batch worker already applied for years.

  @regression
  Scenario: Downstream evaluator receives a boolean target output without rejection
    Given an evaluator target "Sentiment Check" emits "passed" as a boolean
    And a downstream evaluator "Exact Match" expects "output" as a string
    And "output" is mapped to "Sentiment Check.passed"
    And "expected_output" is mapped to a dataset column containing "1"
    When I run the downstream evaluator
    Then the evaluator runs without a "Expected string, received boolean" error
    And the row scores as a match

  Scenario Outline: Non-string target outputs are coerced to the evaluator's declared input type
    Given an evaluator target emits an output of type "<source_type>" with value "<source_value>"
    And a downstream evaluator expects an "output" input typed as string
    When the downstream evaluator runs with that mapping
    Then the value reaches the scorer as the string "<as_string>"
    And no validation error is surfaced to the user

    Examples:
      | source_type | source_value | as_string          |
      | boolean     | true         | true               |
      | boolean     | false        | false              |
      | number      | 42           | 42                 |
      | number      | 0.5          | 0.5                |
      | object      | {"a":1}      | {"a":1}            |
      | array       | [1,2,3]      | [1,2,3]            |

  Scenario: Null target outputs are preserved, not coerced into a string
    Given an evaluator target emits "output" as null
    And a downstream evaluator's "output" mapping points at that field
    When the downstream evaluator runs
    Then the scorer receives a null/absent value
    And the row is reported as inconclusive rather than rejected

  @regression
  Scenario: Online evaluation request with a boolean trace metadata mapping runs without rejection
    Given an online evaluator pulls "output" from a trace metadata field that is a boolean
    When the evaluation is dispatched
    Then the live-execute path coerces the boolean to its string form
    And no "Expected string, received boolean" error is surfaced
