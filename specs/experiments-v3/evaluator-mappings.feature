Feature: Evaluator Mappings in Evaluations V3
  As a user creating evaluations
  I want to configure input mappings for evaluators
  So that evaluators can access the right data from datasets and runners

  Background:
    Given I am in the Evaluations V3 workbench
    And I have a dataset with columns "input, expected_output"
    And I have a runner "my-first-prompt" configured

  # ============================================================================
  # Edit Evaluator from Chip
  # ============================================================================

  Scenario: Click Edit Configuration opens evaluator editor drawer
    Given I have an evaluator "Exact Match" in the workbench
    When I click the evaluator chip "Exact Match"
    And I click "Edit Configuration"
    Then the evaluator editor drawer opens
    And I see the evaluator name "Exact Match"
    And I see the mappings section with available sources

  Scenario: Evaluator drawer shows runner output as source option
    Given I have an evaluator with input "output"
    When I open the evaluator drawer for runner "my-first-prompt"
    Then I see "my-first-prompt" as an available source
    And I can select runner output fields

  Scenario: Evaluator drawer shows dataset columns as source options
    Given I have an evaluator with input "expected_output"
    When I open the evaluator drawer
    Then I see the active dataset columns as available sources
    And I can map "expected_output" to dataset column "expected_output"

  # ============================================================================
  # Auto-inference of Evaluator Mappings
  # ============================================================================

  Scenario: Mappings are auto-inferred when evaluator is added
    Given I have a runner with output "output"
    When I add evaluator "Exact Match" with inputs "output, expected_output"
    Then "output" is automatically mapped to runner output "output"
    And "expected_output" is automatically mapped to dataset column "expected_output"

  Scenario: Mappings propagate when new dataset is added
    Given I have evaluator "Exact Match" with mappings for dataset 1
    When I add dataset 2 with similar columns
    Then evaluator mappings are inferred for dataset 2
    Based on the field names and existing mappings

  Scenario: Mappings initialize when new runner is added
    Given I have evaluator "Exact Match" configured
    When I add a new runner "claude-prompt"
    Then evaluator mappings are inferred for "claude-prompt"
    Based on the runner's output field names

  # ============================================================================
  # Missing Mapping Validation - Evaluator Chip
  # ============================================================================

  Scenario: Evaluator chip shows alert when mappings are missing
    Given I have evaluator "Exact Match" with missing mappings
    Then the evaluator chip shows a pulsing alert icon
    And the alert is visible on all runner cells

  Scenario: Evaluator chip alert clears when mappings are complete
    Given I have evaluator "Exact Match" with missing mappings
    When I set all required mappings
    Then the evaluator chip no longer shows an alert icon

  Scenario: Alert updates when switching datasets
    Given evaluator has complete mappings for dataset 1
    But incomplete mappings for dataset 2
    When I switch to dataset 2
    Then the evaluator chip shows a pulsing alert icon

  # ============================================================================
  # Missing Mapping Validation - Drawer Highlights
  # ============================================================================

  Scenario: Opening drawer shows missing mapping warnings
    Given I have evaluator "Exact Match" with missing mapping for "output"
    When I click "Edit Configuration" on the evaluator chip
    Then the drawer opens
    And the "output" field is highlighted as missing
    And I see a warning message about missing mappings

  Scenario: Highlighting clears after setting mapping
    Given I have the evaluator drawer open with "output" highlighted
    When I select a source for "output"
    Then the "output" field is no longer highlighted

  # ============================================================================
  # Run Evaluation Validation
  # ============================================================================

  Scenario: Global Run validates evaluator mappings
    Given I have a runner with complete mappings
    But evaluator "Exact Match" has missing mappings
    When I click the global "Run Evaluation" button
    Then the evaluator editor drawer opens
    And missing fields are highlighted

  Scenario: Clicking evaluator alert opens drawer
    Given evaluator has missing mappings
    When I click the pulsing alert icon on the evaluator chip
    Then the evaluator editor drawer opens
    And missing fields are highlighted

  # ============================================================================
  # Per-Dataset, Per-Runner Scoping
  # ============================================================================

  Scenario: Mappings are stored per-dataset per-runner
    Given I have two datasets and two runners
    When I set mapping for evaluator on runner 1 dataset 1
    Then the mapping only affects that specific combination
    And other dataset/runner combinations remain unchanged

  Scenario: Drawer shows correct mappings for current context
    Given I have mappings set differently for each dataset
    When I switch datasets and open the evaluator drawer
    Then I see the mappings for the currently active dataset
