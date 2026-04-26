Feature: Rename Suites to Run Plans and Simulation Runs to Run History in UI
  As a user
  I want the UI to use "Run Plans" instead of "Suites" and "Run History" instead of "Runs"
  So that the terminology is clearer and avoids naming collisions

  Background:
    Given the user is logged in and has a project

  # --- Navigation & Page Structure ---

  @e2e @unimplemented
  Scenario: Sidebar displays "Run Plans" instead of "Suites"
    When the user views the sidebar navigation under Simulations
    Then the item formerly labeled "Suites" reads "Run Plans"

  @e2e @unimplemented
  Scenario: Sidebar displays "Run History" instead of "Runs"
    When the user views the sidebar navigation under Simulations
    Then the item formerly labeled "Runs" reads "Run History"

  @integration @unimplemented
  Scenario: Page header displays "Run Plans"
    When the user navigates to the suites list page
    Then the page heading reads "Run Plans"

  @unit @unimplemented
  Scenario: Route title for simulation runs is "Run History"
    When the simulation runs route configuration is read
    Then its title property is "Run History"

  @unit @unimplemented
  Scenario: Feature icon label for simulation runs is "Run History"
    When the simulation runs feature icon configuration is read
    Then its label property is "Run History"

  # --- Create / Edit Forms ---

  @integration @unimplemented
  Scenario: Success toast after creating a run plan
    When the user successfully creates a run plan
    Then a toast displays "Run plan created"

  @integration @unimplemented
  Scenario: Success toast after updating a run plan
    When the user successfully updates a run plan
    Then a toast displays "Run plan updated"

  @integration @unimplemented
  Scenario: Success toast after archiving a run plan
    When the user archives a run plan
    Then a toast displays "Run plan archived"

  @integration @unimplemented
  Scenario: Success toast after duplicating a run plan
    When the user duplicates a run plan
    Then a toast displays "Run plan duplicated"

  # --- Dialogs & Empty States ---

  @integration @unimplemented
  Scenario: Detail panel empty state
    When no run plan is selected
    Then the detail panel reads "No run plan selected"
    And shows a prompt to "Select a run plan from the sidebar"

  @integration @unimplemented
  Scenario: Page header button reads "New Run Plan"
    When the user views the suites list page
    Then the header button reads "New Run Plan"
