Feature: Scenario Editor
  As a LangWatch user
  I want to create and edit scenario specifications
  So that I can define behavioral test cases for my agents

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Create Scenario
  # ============================================================================

  @integration
  Scenario: Navigate to create form
    Given I am on the scenarios list page
    When I click "New Scenario"
    Then I navigate to the scenario editor
    And I see an empty scenario form

  @integration
  Scenario: View scenario form fields
    When I am on the create scenario page
    Then I see the following fields:
      | field     | type              |
      | Name      | text input        |
      | Situation | textarea          |
      | Criteria  | list (add/remove) |
      | Labels    | tag input         |

  @e2e
  Scenario: Save new scenario
    Given I am on the create scenario page
    When I fill in "Name" with "Refund Request Test"
    And I fill in "Situation" with "User requests a refund for a defective product"
    And I add criterion "Agent acknowledges the issue"
    And I add criterion "Agent offers a solution"
    And I click "Save"
    Then I navigate back to the scenarios list
    And "Refund Request Test" appears in the list

  # ============================================================================
  # Edit Scenario
  # ============================================================================

  @e2e
  Scenario: Load existing scenario for editing
    Given scenario "Refund Flow" exists with:
      | name      | Refund Flow                |
      | situation | User wants a refund        |
      | criteria  | ["Acknowledge", "Resolve"] |
    When I navigate to edit "Refund Flow"
    Then the form is populated with the existing data

  @e2e
  Scenario: Update scenario name
    Given I am editing scenario "Refund Flow"
    When I change the name to "Refund Flow (Updated)"
    And I click "Save"
    Then I see the updated name in the list

  # ============================================================================
  # Criteria Management
  # ============================================================================

  @integration
  Scenario: Add criterion to list
    Given I am on the scenario editor
    When I type criterion "Agent must apologize"
    And I click the add button
    Then the criterion appears in the criteria list
    And I can add more criteria

  @integration
  Scenario: Remove criterion from list
    Given criteria ["Criterion A", "Criterion B"] exist in the form
    When I click remove on "Criterion A"
    Then only "Criterion B" remains in the list

  @integration
  Scenario: Criteria list validates empty input
    Given I am on the scenario editor
    When I try to add an empty criterion
    Then the criterion is not added
    And I see a validation message

  # ============================================================================
  # Target Configuration
  # ============================================================================

  @integration
  Scenario: Configure prompt as target
    Given I am on the scenario editor
    And prompts exist in the project
    When I open the target selector
    Then I can select an existing prompt config

  @integration
  Scenario: Configure HTTP agent as target
    Given I am on the scenario editor
    When I open the target selector
    And I select "HTTP Agent"
    Then I can configure the HTTP endpoint details
