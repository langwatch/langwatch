@integration
Feature: Online Evaluation Drawer Complete Flow
  As a user
  I want to complete the entire online evaluation creation flow
  So that I can set up monitoring for my traces

  Background:
    Given I am logged in to a project
    And I have evaluators available

  Scenario: Create trace-level online evaluation with auto-mappings
    Given I open the Online Evaluation drawer
    And I keep "Trace" level selected (default)
    When I click "Select Evaluator"
    Then the evaluator list drawer should open
    When I select "Exact Match" evaluator
    Then the evaluator list drawer should close
    And I should return to the Online Evaluation drawer
    And "Exact Match" should be shown in the evaluator box
    And no pending mapping warning should appear
    And name should be pre-filled with "Exact Match"
    When I click Save
    Then a monitor should be created with evaluatorId reference
    And the drawer should close

  Scenario: Create with pending mappings that need configuration
    Given I open the Online Evaluation drawer
    When I select evaluator "Custom LLM Judge" requiring "custom_criteria"
    Then the evaluator editor drawer should open automatically
    And "custom_criteria" field should be highlighted as pending
    When I map "custom_criteria" to "metadata -> criteria"
    And I click "Done" in the editor
    Then I should return to Online Evaluation drawer
    And no pending mapping warning should appear
    When I click Save
    Then the monitor should be created successfully

  Scenario: User closes editor without completing mappings
    Given I selected an evaluator with pending mappings
    And the evaluator editor opened automatically
    When I close the editor without completing mappings
    Then I should return to Online Evaluation drawer
    And a warning banner should appear: "1 field needs mapping"
    And the Save button should be disabled
    When I click the warning banner
    Then the evaluator editor should re-open

  Scenario: Remove evaluator shows pending state
    Given I have selected an evaluator with all mappings complete
    When I click the X button on the evaluator box
    Then the evaluator should be removed
    And the evaluator box should show "Select Evaluator"
    And the Save button should be disabled
    And a subtle message should say "Select an evaluator to continue"

  Scenario: Switch from trace to thread level
    Given I have selected an evaluator at trace level
    And mappings are auto-completed
    When I switch to "Thread" level
    Then the evaluator editor should open automatically
    Because thread mappings require manual configuration
    And the mapping sources should now show thread options

  Scenario: Switch back from thread to trace level
    Given I am at thread level with manual mappings configured
    When I switch to "Trace" level
    Then auto-inference should run again
    And mappings should update to trace sources
    And the editor may open if there are pending mappings

  Scenario: Edit existing online evaluation
    Given a monitor "My PII Check" exists
    When I click edit on the monitor
    Then the Online Evaluation drawer should open
    And the level should be pre-selected based on existing mappings
    And the evaluator box should show the linked evaluator
    And name should be "My PII Check"
    And sampling should show the configured value
    And preconditions should be pre-filled
    When I change sampling to 75%
    And I click Save
    Then the monitor should be updated

  Scenario: Evaluator has no required fields
    Given I select an evaluator with no required fields
    Then no mappings UI should be shown
    And no editor should open automatically
    And I should be able to save immediately

  Scenario: Create new evaluator on the spot
    Given I open the Online Evaluation drawer
    When I click "Select Evaluator"
    And the evaluator list opens
    When I click "Create New Evaluator"
    Then I should be able to create a new evaluator
    When I save the new evaluator
    Then I should return with the new evaluator selected

  Scenario: Cancel online evaluation creation
    Given I have partially configured an online evaluation
    When I click Cancel or close the drawer
    Then no monitor should be created
    And my changes should be discarded

  Scenario: Drawer preserves state during sub-drawer navigation
    Given I have selected trace level
    And I have set sampling to 50%
    When I open the evaluator list drawer
    And I browse evaluators without selecting
    And I close the evaluator list
    Then I should return to Online Evaluation drawer
    And trace level should still be selected
    And sampling should still be 50%

  Scenario: Configure all options before save
    Given I open the Online Evaluation drawer
    When I select "Trace" level
    And I select an evaluator with auto-mapped fields
    And I change the name to "Production PII Monitor"
    And I set sampling to 25%
    And I add precondition "input contains PII"
    And I click Save
    Then a monitor should be created with:
      | Field        | Value                    |
      | name         | Production PII Monitor   |
      | sample       | 0.25                     |
      | preconditions| [input contains PII]     |
      | evaluatorId  | [selected evaluator id]  |

  Scenario: Validation errors prevent save
    Given I have an evaluator selected
    But the name field is empty
    When I try to save
    Then the Save button should be disabled
    Or a validation error should appear on the name field
