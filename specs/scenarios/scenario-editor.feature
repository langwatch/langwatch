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
  # Target Configuration
  # ============================================================================

