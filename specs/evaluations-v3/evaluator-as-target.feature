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

  Scenario: Evaluator appears as third option in type selector
    When I click the "+ Add" button
    Then the TargetTypeSelectorDrawer opens
    And I see three options: "Prompt", "Agent", and "Evaluator"

  Scenario: Select Evaluator type opens evaluator list
    Given the TargetTypeSelectorDrawer is open
    When I select "Evaluator"
    Then the EvaluatorListDrawer opens
    And I can select from existing evaluators

  Scenario: Evaluator card shows correct styling
    When I click the "+ Add" button
    Then the Evaluator card shows a checkmark icon
    And the Evaluator card has green styling

  # ============================================================================
  # Adding evaluator as target
  # ============================================================================

  Scenario: Add existing evaluator as target
    Given evaluator "Sentiment Check" of type "langevals/sentiment" exists
    When I click "+ Add"
    And I select "Evaluator"
    And I select evaluator "Sentiment Check"
    Then a new target column appears in the table
    And the target header shows the evaluator name with evaluator icon
    And the target type is "evaluator"
    And the target has outputs: passed, score, label

  Scenario: Evaluator target inputs derived from evaluator definition
    Given evaluator "Custom LLM Judge" with required fields ["output", "expected_output"] exists
    When I click "+ Add"
    And I select "Evaluator"
    And I select evaluator "Custom LLM Judge"
    Then the target has inputs: output, expected_output
    And I can map dataset columns to these inputs

  Scenario: Evaluator target has standard evaluator outputs
    Given evaluator "Exact Match" exists
    When I add it as a target
    Then the target has outputs:
      | identifier | type  |
      | passed     | bool  |
      | score      | float |
      | label      | str   |

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

  Scenario: Map dataset columns to evaluator target inputs
    Given an evaluator target "Sentiment Check" with input "output"
    And dataset column "response"
    When I map "output" to dataset column "response"
    Then the mapping is saved
    And execution will pass "response" value to the evaluator

  Scenario: Evaluator target shows missing mapping warning
    Given an evaluator target "Exact Match" with inputs ["output", "expected_output"]
    And only "output" is mapped
    Then the target column header shows a warning indicator
    And hovering shows tooltip about unmapped inputs

  Scenario: Value mapping works for evaluator targets
    Given an evaluator target with input "threshold"
    When I set a value mapping of "0.8" for "threshold"
    Then the mapping is saved
    And execution will use literal value "0.8" for threshold

  # ============================================================================
  # Target header and UI
  # ============================================================================

  Scenario: Evaluator target header shows evaluator icon
    Given an evaluator target "Sentiment Check" is configured
    Then the target header shows a checkmark icon
    And the icon has green color styling

  Scenario: Evaluator target header shows popover on click
    Given an evaluator target "Sentiment Check" is configured
    When I click on the target header "Sentiment Check"
    Then a popover menu appears with options:
      | Edit Evaluator       |
      | Remove from Workbench|

  Scenario: Edit evaluator target opens evaluator editor
    Given an evaluator target "Sentiment Check" is configured
    When I click on the target header "Sentiment Check"
    And I click "Edit Evaluator" in the popover
    Then the EvaluatorEditorDrawer opens
    And I can view the evaluator settings

  Scenario: Remove evaluator target from workbench
    Given an evaluator target "Sentiment Check" is configured
    When I click on the target header "Sentiment Check"
    And I click "Remove from Workbench" in the popover
    Then the target column is removed from the table

  # ============================================================================
  # Execution
  # ============================================================================

  Scenario: Execute evaluator target
    Given an evaluator target "Exact Match" is configured
    And input "output" is mapped to dataset column "response"
    And input "expected_output" is mapped to dataset column "expected"
    When I run the evaluation
    Then the evaluator executes for each row
    And the target output shows passed/score/label for each row

  Scenario: Evaluator target result displays in cell
    Given an evaluator target completed execution
    Then the cell shows the evaluator result
    And I see passed status (checkmark or X)
    And I see the score value
    And I see the label if present

  Scenario: Evaluator target error displays in cell
    Given an evaluator target failed with "Invalid input format"
    Then the cell shows an error state
    And I can see the error message

  # ============================================================================
  # Meta-evaluation (evaluators on evaluator targets)
  # ============================================================================

  Scenario: Add downstream evaluator to evaluator target
    Given an evaluator target "First Evaluator" is configured
    When I add evaluator "Pass Rate Check" to the evaluation
    Then "Pass Rate Check" can evaluate the outputs of "First Evaluator"

  Scenario: Map downstream evaluator to evaluator target outputs
    Given an evaluator target "First Evaluator" is configured
    And an evaluator "Score Threshold" is added to the evaluation
    When I configure "Score Threshold" mappings
    Then I can map input "value" to "First Evaluator" output "score"
    And I can map input "threshold" to a literal value

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

  Scenario: Compare two evaluators
    Given evaluator "Evaluator A" exists
    And evaluator "Evaluator B" exists
    When I add "Evaluator A" as a target
    And I click "+ Add Comparison"
    And I select "Evaluator"
    And I add "Evaluator B" as a target
    Then 2 target columns show the different evaluators
    And I can compare their outputs side by side

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

  Scenario: Evaluator target is saved with experiment
    Given an evaluator target "Sentiment Check" is configured
    When the experiment is saved
    And I reload the page
    Then the evaluator target is restored
    And the target has the correct dbEvaluatorId
    And the mappings are preserved
