Feature: Rename Suites to Run Plans and Simulation Runs to Run History in UI
  As a user
  I want the UI to use "Run Plans" instead of "Suites" and "Run History" instead of "Runs"
  So that the terminology is clearer and avoids naming collisions

  Background:
    Given the user is logged in and has a project

  # --- Navigation & Page Structure ---

  @e2e
  Scenario: Sidebar displays "Run Plans" instead of "Suites"
    When the user views the sidebar navigation under Simulations
    Then the item formerly labeled "Suites" reads "Run Plans"

  @e2e
  Scenario: Sidebar displays "Run History" instead of "Runs"
    When the user views the sidebar navigation under Simulations
    Then the item formerly labeled "Runs" reads "Run History"

  @integration
  Scenario: Page header displays "Run Plans"
    When the user navigates to the suites list page
    Then the page heading reads "Run Plans"

  @unit
  Scenario: Route title is "Run Plans"
    When the suites route configuration is read
    Then its title property is "Run Plans"

  @unit
  Scenario: Feature icon label for suites is "Run Plans"
    When the suites feature icon configuration is read
    Then its label property is "Run Plans"

  @unit
  Scenario: Route title for simulation runs is "Run History"
    When the simulation runs route configuration is read
    Then its title property is "Run History"

  @unit
  Scenario: Feature icon label for simulation runs is "Run History"
    When the simulation runs feature icon configuration is read
    Then its label property is "Run History"

  # --- Create / Edit Forms ---

  @integration
  Scenario: Form drawer title reads "New Run Plan" for creation
    When the user opens the form to create a new run plan
    Then the drawer title reads "New Run Plan"

  @integration
  Scenario: Form drawer title reads "Edit Run Plan" for editing
    Given a run plan already exists
    When the user opens the form to edit that run plan
    Then the drawer title reads "Edit Run Plan"

  @integration
  Scenario: Form placeholder uses "Run Plan" terminology
    When the user opens the form to create a new run plan
    Then the name field placeholder reads "e.g., Critical Path Run Plan"

  # --- Toast Messages ---

  @integration
  Scenario: Success toast after creating a run plan
    When the user successfully creates a run plan
    Then a toast displays "Run plan created"

  @integration
  Scenario: Success toast after updating a run plan
    When the user successfully updates a run plan
    Then a toast displays "Run plan updated"

  @integration
  Scenario: Success toast after archiving a run plan
    When the user archives a run plan
    Then a toast displays "Run plan archived"

  @integration
  Scenario: Success toast after duplicating a run plan
    When the user duplicates a run plan
    Then a toast displays "Run plan duplicated"

  # --- Dialogs & Empty States ---

  @integration
  Scenario: Archive confirmation dialog uses "run plan"
    When the user initiates archiving a run plan
    Then the confirmation dialog title reads "Archive run plan?"
    And the dialog body mentions "archived run plans"

  @integration
  Scenario: Empty state when no run plans exist
    Given no run plans exist in the project
    When the user views the run plans sidebar
    Then the empty state reads "No run plans yet"

  @integration
  Scenario: Empty state when search has no matches
    Given run plans exist but none match the search query
    When the user searches in the run plans sidebar
    Then the empty state reads "No matching run plans"

  @integration
  Scenario: Detail panel empty state
    When no run plan is selected
    Then the detail panel reads "No run plan selected"
    And shows a prompt to "Select a run plan from the sidebar"

  @integration
  Scenario: Detail panel empty state button
    When no run plan is selected
    Then the detail panel shows a "New Run Plan" button

  # --- Header Button ---

  @integration
  Scenario: Page header button reads "New Run Plan"
    When the user views the suites list page
    Then the header button reads "New Run Plan"
