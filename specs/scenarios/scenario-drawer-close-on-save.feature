Feature: Scenario drawer closes after saving completes
  As a LangWatch user
  I want the scenario drawer to close automatically after a successful save
  So that I return to the scenario list without an extra manual step

  Background:
    Given I am logged into project "my-project"

  @e2e
  Scenario: Drawer closes after saving a new scenario
    Given I opened the scenario editor via "New Scenario"
    And I filled in "Name" with "Refund Request Test"
    And I filled in "Situation" with "User requests a refund"
    And I added criterion "Agent acknowledges the issue"
    When I click "Save"
    Then the scenario drawer closes
    And "Refund Request Test" appears in the scenarios list

  @e2e
  Scenario: Drawer closes after updating an existing scenario
    Given scenario "Refund Flow" exists
    And I am editing scenario "Refund Flow" in the drawer
    When I change the name to "Refund Flow (Updated)"
    And I click "Save"
    Then the scenario drawer closes
    And "Refund Flow (Updated)" appears in the scenarios list

  @integration
  Scenario: Drawer stays open when save fails
    Given I am editing a scenario in the drawer
    And the save request will fail
    When I click "Save"
    Then I see an error message
    And the scenario drawer remains open

  @integration
  Scenario: Drawer stays open after save-and-run
    Given I am editing scenario "Refund Flow" in the drawer
    And a target is selected
    When I click "Save and Run"
    Then the scenario drawer remains open
