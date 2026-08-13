Feature: Scenario Editor
  As a LangWatch user
  I want to create and edit scenario specifications
  So that I can define behavioral test cases for my agents

  Background:
    Given I am logged into project "my-project"

  # Per AUDIT_MANIFEST.md: 10 scenarios → 7 DUPLICATE (already bound elsewhere)
  # + 3 KEEP. The 3 KEEP scenarios remain @unimplemented pending integration
  # test coverage for list-page navigation, form-field schema audit, and
  # criteria empty-input validation — tracked in PR #3458.

  # ============================================================================
  # Create Scenario
  # ============================================================================

  @integration @unimplemented
  Scenario: Navigate to create form
    Given I am on the scenarios list page
    When I click "New Scenario"
    Then I navigate to the scenario editor
    And I see an empty scenario form

  @integration @unimplemented
  Scenario: View scenario form fields
    When I am on the create scenario page
    Then I see the following fields:
      | field     | type              |
      | Name      | text input        |
      | Situation | textarea          |
      | Criteria  | list (add/remove) |
      | Labels    | tag input         |

  # ============================================================================
  # Edit Scenario
  # ============================================================================

  # ============================================================================
  # Criteria Management
  # ============================================================================

  @integration @unimplemented
  Scenario: Criteria list validates empty input
    Given I am on the scenario editor
    When I try to add an empty criterion
    Then the criterion is not added
    And I see a validation message

  # ============================================================================
  # Turn Configuration (ADR-015)
  # ============================================================================

  @integration
  Scenario: Advanced section shows maxTurns and minTurns fields
    Given I am on the scenario editor
    Then I see a collapsible "Advanced" section
    When I expand the "Advanced" section
    Then I see the following fields:
      | field     | type         | placeholder  |
      | Max Turns | number input | Default: 10  |
      | Min Turns | number input | empty        |

  @integration
  Scenario: Save scenario with maxTurns set
    Given I am on the scenario editor
    And I have filled in the required fields
    When I expand the "Advanced" section
    And I set "Max Turns" to "5"
    And I save the scenario
    Then the scenario is saved with maxTurns = 5

  @integration
  Scenario: Save scenario with minTurns set
    Given I am on the scenario editor
    And I have filled in the required fields
    When I expand the "Advanced" section
    And I set "Min Turns" to "3"
    And I save the scenario
    Then the scenario is saved with minTurns = 3

  @integration
  Scenario: Clear turn config resets to SDK defaults
    Given I am editing scenario "Refund Flow" with maxTurns = 5
    When I expand the "Advanced" section
    And I clear the "Max Turns" field
    And I save the scenario
    Then the scenario is saved with maxTurns = null

  @integration
  Scenario: Switching scenarios resets turn config fields
    Given I am editing scenario "Refund Flow" with maxTurns = 5
    When I switch to editing scenario "Billing Check" with maxTurns = 3
    Then the "Max Turns" field shows "3"

  @integration
  Scenario: maxTurns rejects non-positive values
    Given I am on the scenario editor
    When I expand the "Advanced" section
    And I set "Max Turns" to "0"
    Then the field shows a validation error
    And submitting the form does not call the API

  @integration
  Scenario: minTurns rejects negative values
    Given I am on the scenario editor
    When I expand the "Advanced" section
    And I set "Min Turns" to "-1"
    Then the field shows a validation error
    And submitting the form does not call the API

  @integration
  Scenario: maxTurns rejects decimal values
    Given I am on the scenario editor
    When I expand the "Advanced" section
    And I set "Max Turns" to "2.5"
    Then the field shows a validation error
    And submitting the form does not call the API

  # ============================================================================
  # Target Configuration
  # ============================================================================

