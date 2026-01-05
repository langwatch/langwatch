Feature: Mapping Validation and Missing Mapping Detection
  As a user creating evaluations
  I want to be alerted when required mappings are missing
  So that I can fix them before running evaluations

  Background:
    Given I have an evaluation workbench open
    And I have a dataset with columns "input, expected_output"

  # ============================================================================
  # Runner Header Alert
  # ============================================================================

  Scenario: Runner header shows alert icon when mapping is missing
    Given I have a runner with input field "question"
    And "question" is not mapped for the active dataset
    Then the runner header shows a pulsing alert icon

  Scenario: Runner header hides alert when all mappings are set
    Given I have a runner with input field "question"
    And "question" is mapped to "input" for the active dataset
    Then the runner header does not show an alert icon

  Scenario: Alert icon updates when switching datasets
    Given I have two datasets
    And I have a runner with mappings for dataset 1 but not dataset 2
    When I switch to dataset 2
    Then the runner header shows a pulsing alert icon

  # ============================================================================
  # Drawer Highlights
  # ============================================================================

  Scenario: Opening drawer shows missing mapping warning
    Given I have a runner with missing mappings
    When I click to open the runner's drawer
    Then I see a warning message about missing mappings
    And the unmapped fields are visually highlighted

  Scenario: Highlighting clears after mapping is set
    Given I have the drawer open with highlighted missing mappings
    When I set a mapping for a highlighted field
    Then that field is no longer highlighted as missing

  # ============================================================================
  # Required vs Optional Fields
  # ============================================================================

  Scenario: Only required fields trigger missing mapping warnings
    Given I have a runner with:
      | field   | required | mapped |
      | input   | yes      | no     |
      | context | no       | no     |
    Then the runner header shows alert for "input" only
    And "context" does not trigger a warning

  Scenario: Value mappings count as mapped
    Given I have a runner with input "question"
    And "question" has a value mapping "Hello world"
    Then "question" is not considered missing

  # ============================================================================
  # Per-Runner Run Button Validation
  # ============================================================================

  Scenario: Run button validates mappings before execution
    Given I have a runner with missing mappings
    When I click the run button for that runner
    Then the drawer opens automatically
    And missing fields are highlighted

  Scenario: Run button proceeds when all mappings are set
    Given I have a runner with all mappings set
    When I click the run button for that runner
    Then the evaluation starts (or mock run triggers)

  # ============================================================================
  # Global Run Evaluation Button
  # ============================================================================

  Scenario: Global run validates all runners and evaluators
    Given I have multiple runners
    And runner 2 has missing mappings
    When I click the global "Run Evaluation" button
    Then the drawer opens for runner 2
    And missing fields are highlighted

  Scenario: Global run validates in order
    Given I have runners with missing mappings:
      | runner   | missing_fields |
      | Runner 1 | question       |
      | Runner 2 | context        |
    When I click the global "Run Evaluation" button
    Then the drawer opens for "Runner 1" first

  Scenario: Global run validates evaluators too
    Given I have a runner with all mappings set
    And the runner has an evaluator with missing mappings
    When I click the global "Run Evaluation" button
    Then the evaluator drawer opens
    And missing fields are highlighted

  # ============================================================================
  # Evaluator Validation
  # ============================================================================

  Scenario: Evaluator shows missing mapping alert on runner cell
    Given I have an evaluator with missing mappings for a runner
    Then the evaluator chip on that runner's cell shows an alert

  Scenario: Clicking evaluator chip opens with highlights
    Given I have an evaluator with missing mappings
    When I click the evaluator chip on a runner cell
    Then the evaluator drawer opens
    And the missing mappings are highlighted
