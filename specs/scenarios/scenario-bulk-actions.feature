Feature: Scenario Bulk Actions
  As a LangWatch user
  I want a floating action bar when I select multiple scenarios
  So that I can perform bulk operations efficiently

  Background:
    Given I am logged into project "my-project"
    And scenarios exist in the project:
      | name            | labels      |
      | Refund Flow     | ["support"] |
      | Billing Check   | ["billing"] |
      | Greeting Prompt | ["general"] |

  # ============================================================================
  # Floating Bar Visibility
  # ============================================================================

  # ============================================================================
  # Floating Bar Layout (matches traces pattern)
  # ============================================================================

  @e2e @unimplemented
  Scenario: Floating bar stays fixed during scroll
    Given I am on the scenarios list page
    And the scenario list is long enough to scroll
    When I select "Refund Flow"
    And I scroll down the scenario list
    Then the floating action bar remains visible

  # ============================================================================
  # Bulk Actions
  # ============================================================================

  @e2e @unimplemented
  Scenario: Archive selected scenarios via floating bar
    Given I am on the scenarios list page
    And I select "Refund Flow" and "Billing Check"
    When I click "Archive" on the floating action bar
    And I confirm the archive
    Then "Refund Flow" and "Billing Check" are no longer in the list
    And the floating action bar disappears
