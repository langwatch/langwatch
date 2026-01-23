@integration
Feature: Pending Mappings Validation
  As a user
  I want clear feedback when mappings are incomplete
  So that I can complete them before saving my online evaluation

  Background:
    Given I am creating an online evaluation
    And trace level is selected

  Scenario: All fields auto-mapped - can save immediately
    Given I selected evaluator "Exact Match" requiring "input", "output"
    When the evaluator is selected
    Then "input" should be auto-mapped to trace.input
    And "output" should be auto-mapped to trace.output
    And no pending mapping warning should show
    And the Save button should be enabled

  Scenario: Some fields cannot be auto-mapped - editor opens
    Given I selected evaluator "Custom Eval" requiring "custom_field"
    And "custom_field" cannot be auto-mapped from trace
    When the evaluator is selected
    Then the evaluator editor drawer should open automatically
    And "custom_field" should be highlighted as pending
    And the mapping input should have yellow/orange border
    And the placeholder should say "Required"

  Scenario: User closes editor without completing mappings
    Given the evaluator editor is open with pending mappings
    When I close the editor without mapping "custom_field"
    Then I should return to the online evaluation drawer
    And a warning banner should appear below the evaluator box
    And the warning should say "1 field needs mapping"
    And the warning should be clickable

  Scenario: Click warning banner to re-open editor
    Given a warning banner is shown for pending mappings
    When I click the warning banner
    Then the evaluator editor should re-open
    And the pending field should still be highlighted

  Scenario: Thread level always opens editor
    Given I have an evaluator with auto-mappable fields "input", "output"
    And I have selected it at trace level (auto-mapped)
    When I switch to "Thread" level
    Then the evaluator editor should open automatically
    Because thread mappings cannot be auto-inferred
    And the mapping sources should now show thread options

  Scenario: Cannot save with pending mappings
    Given I have pending mappings for "expected_output"
    Then the Save button should be disabled
    When I hover over the Save button
    Then a tooltip should explain "Complete all mappings first"

  Scenario: Save button enables after completing mappings
    Given I have pending mappings for "expected_output"
    And the Save button is disabled
    When I open the editor and map "expected_output"
    And I close the editor
    Then the warning banner should disappear
    And the Save button should be enabled

  Scenario: Multiple pending fields
    Given I selected an evaluator requiring "field1", "field2", "field3"
    And only "field1" can be auto-mapped
    When the evaluator is selected
    Then the editor should open
    And "field2" and "field3" should be highlighted as pending
    And the warning should say "2 fields need mapping"

  Scenario: Remove evaluator clears pending state
    Given I have an evaluator with pending mappings
    When I remove the evaluator from the selection box
    Then the pending mapping warning should disappear
    And the Save button should be disabled (no evaluator selected)

  Scenario: Change evaluator resets mappings
    Given I have evaluator A with complete mappings
    When I select evaluator B which has different required fields
    Then mappings should be reset
    And auto-inference should run for evaluator B
    And pending mappings should be recalculated

  Scenario: Evaluator with no required fields
    Given I select an evaluator with no required or optional fields
    Then no mappings UI should be shown
    And no editor should open automatically
    And the Save button should be enabled

  Scenario: Optional fields not required for save
    Given I select an evaluator with required field "input" and optional field "metadata"
    And "input" is auto-mapped
    And "metadata" is not mapped
    Then the Save button should still be enabled
    Because optional fields don't block saving

  Scenario: Visual distinction between required and optional pending fields
    Given an evaluator has required field "input" pending
    And optional field "extra_context" pending
    Then "input" should have a warning highlight (orange)
    And "extra_context" should have a subtle highlight or none
