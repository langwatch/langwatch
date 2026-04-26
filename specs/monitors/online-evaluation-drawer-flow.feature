@integration
Feature: Online Evaluation Drawer Complete Flow
  As a user
  I want to complete the entire online evaluation creation flow
  So that I can set up monitoring for my traces

  Background:
    Given I am logged in to a project
    And I have evaluators available

  @unimplemented
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

  @unimplemented
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

  @unimplemented
  Scenario: User closes editor without completing mappings
    Given I selected an evaluator with pending mappings
    And the evaluator editor opened automatically
    When I close the editor without completing mappings
    Then I should return to Online Evaluation drawer
    And a warning banner should appear: "1 field needs mapping"
    And the Save button should be disabled
    When I click the warning banner
    Then the evaluator editor should re-open

  @unimplemented
  Scenario: Switch from trace to thread level
    Given I have selected an evaluator at trace level
    And mappings are auto-completed
    When I switch to "Thread" level
    Then the evaluator editor should open automatically
    Because thread mappings require manual configuration
    And the mapping sources should now show thread options

  @unimplemented
  Scenario: Switch back from thread to trace level
    Given I am at thread level with manual mappings configured
    When I switch to "Trace" level
    Then auto-inference should run again
    And mappings should update to trace sources
    And the editor may open if there are pending mappings

  @unimplemented
  Scenario: Evaluator has no required fields
    Given I select an evaluator with no required fields
    Then no mappings UI should be shown
    And no editor should open automatically
    And I should be able to save immediately

  @unimplemented
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

