Feature: Scenario drawer closes after saving completes
  As a LangWatch user
  I want the scenario drawer to close automatically after a successful save
  So that I return to the scenario list without an extra manual step

  Background:
    Given I am logged into project "my-project"

  @integration @unimplemented
  Scenario: Drawer stays open after save-and-run
    Given I am editing scenario "Refund Flow" in the drawer
    And a target is selected
    When I click "Save and Run"
    Then the scenario drawer remains open
