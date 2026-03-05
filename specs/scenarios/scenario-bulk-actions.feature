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

  @integration
  Scenario: Floating bar appears when scenarios are selected
    Given I am on the scenarios list page
    When I select "Refund Flow" and "Billing Check"
    Then I see a floating action bar at the bottom of the page
    And the bar shows "2 selected"

  @integration
  Scenario: Floating bar disappears when selection is cleared
    Given I am on the scenarios list page
    And I have selected "Refund Flow"
    When I deselect "Refund Flow"
    Then I do not see the floating action bar

  @integration
  Scenario: Floating bar updates count when selection changes
    Given I am on the scenarios list page
    And I have selected "Refund Flow" and "Billing Check"
    When I also select "Greeting Prompt"
    Then the bar shows "3 selected"

  # ============================================================================
  # Floating Bar Layout (matches traces pattern)
  # ============================================================================

  @e2e
  Scenario: Floating bar stays fixed during scroll
    Given I am on the scenarios list page
    And the scenario list is long enough to scroll
    When I select "Refund Flow"
    And I scroll down the scenario list
    Then the floating action bar remains visible

  # ============================================================================
  # Bulk Actions
  # ============================================================================

  @e2e
  Scenario: Archive selected scenarios via floating bar
    Given I am on the scenarios list page
    And I select "Refund Flow" and "Billing Check"
    When I click "Archive" on the floating action bar
    And I confirm the archive
    Then "Refund Flow" and "Billing Check" are no longer in the list
    And the floating action bar disappears
