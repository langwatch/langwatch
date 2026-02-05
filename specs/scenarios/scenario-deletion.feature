Feature: Scenario Archiving
  As a LangWatch user
  I want to archive scenarios from the library
  So that I can remove test cases I no longer need while preserving history

  Background:
    Given I am logged into project "my-project"
    And the following scenarios exist:
      | name                         | labels       |
      | Cross-doc synthesis question | doc-qa       |
      | SaaS documentation guidance  | saas         |
      | Failed booking escalation    | booking      |
      | Angry double-charge refund   | billing      |
      | HTTP troubleshooting request | http         |

  # ============================================================================
  # E2E: Happy Paths — Full User Workflows
  # ============================================================================

  @e2e
  Scenario: Delete a single scenario via row action menu
    When I am on the scenarios list page
    And I open the row action menu for "Angry double-charge refund"
    And I click "Delete"
    Then I see a confirmation modal asking to delete "Angry double-charge refund"
    When I confirm the deletion
    Then "Angry double-charge refund" no longer appears in the scenarios list
    And the remaining 4 scenarios are still visible

  @e2e
  Scenario: Batch delete multiple selected scenarios
    When I am on the scenarios list page
    And I select the checkbox for "Cross-doc synthesis question"
    And I select the checkbox for "Failed booking escalation"
    Then I see a batch action bar showing "2 selected"
    When I click the "Delete" button in the batch action bar
    Then I see a confirmation modal listing both scenarios
    When I confirm the deletion
    Then neither scenario appears in the scenarios list
    And the remaining 3 scenarios are still visible

  # ============================================================================
  # Integration: Row Selection UI
  # ============================================================================

  @integration
  Scenario: Select all checkbox toggles all visible rows
    When I am on the scenarios list page
    And I click the "select all" checkbox in the table header
    Then all visible scenario row checkboxes are checked
    When I click the "select all" checkbox again
    Then all visible scenario row checkboxes are unchecked

  @integration
  Scenario: Select all with active filter only selects visible rows
    When I am on the scenarios list page
    And I filter by label "billing"
    And I click the "select all" checkbox in the table header
    Then only the filtered scenario checkboxes are checked

  @integration
  Scenario: Deselecting all rows hides the batch action bar
    When I am on the scenarios list page
    And I select the checkbox for "SaaS documentation guidance"
    Then the batch action bar is visible
    When I deselect the checkbox for "SaaS documentation guidance"
    Then the batch action bar is no longer visible

  # ============================================================================
  # Integration: Single Archive via Row Action Menu
  # ============================================================================

  @integration
  Scenario: Row action menu contains delete option
    When I am on the scenarios list page
    And I open the row action menu for "Angry double-charge refund"
    Then I see a "Delete" option in the menu

  @integration
  Scenario: Single delete confirmation modal shows scenario name
    When I am on the scenarios list page
    And I open the row action menu for "Angry double-charge refund"
    And I click "Delete"
    Then I see a confirmation modal with title "Delete scenario?"
    And the modal displays the scenario name "Angry double-charge refund"
    And the modal shows "This action cannot be undone."
    And the modal has "Cancel" and "Delete" buttons

  @integration
  Scenario: Cancel single delete dismisses modal without deleting
    When I am on the scenarios list page
    And I open the row action menu for "Angry double-charge refund"
    And I click "Delete"
    And I click "Cancel" in the confirmation modal
    Then the modal closes
    And "Angry double-charge refund" still appears in the scenarios list

  # ============================================================================
  # Integration: Batch Archive
  # ============================================================================

  @integration
  Scenario: Batch delete confirmation modal lists all selected scenarios
    When I am on the scenarios list page
    And I select 2 scenarios
    And I click the "Delete" button in the batch action bar
    Then I see a confirmation modal with title "Delete 2 scenarios?"
    And the modal lists each selected scenario by name
    And the modal shows "This action cannot be undone."
    And the modal has "Cancel" and "Delete" buttons

  @integration
  Scenario: Cancel batch delete dismisses modal and preserves selection
    When I am on the scenarios list page
    And I select 2 scenarios
    And I click the "Delete" button in the batch action bar
    And I click "Cancel" in the confirmation modal
    Then the modal closes
    And the 2 scenarios remain selected
    And both scenarios still appear in the scenarios list

  # ============================================================================
  # Integration: Soft Archive Backend Behavior
  # ============================================================================

  @integration
  Scenario: Archived scenario has archivedAt timestamp set
    Given I am authenticated in project "test-project"
    And scenario "To Archive" exists
    When I call the archive endpoint for "To Archive"
    Then the scenario record has an archivedAt timestamp set
    And the scenario record still exists in the database

  @integration
  Scenario: Archived scenario does not appear in list queries
    Given I am authenticated in project "test-project"
    And scenario "Archived Scenario" has been archived
    When I call scenario.getAll for the project
    Then "Archived Scenario" is not in the results

  @integration
  Scenario: Archived scenario is still found by ID for internal lookups
    Given I am authenticated in project "test-project"
    And scenario "Archived Scenario" has been archived
    When I call scenario.getById for "Archived Scenario" including archived
    Then the scenario is returned with archivedAt set

  @integration
  Scenario: Batch archive sets archivedAt on all selected scenarios
    Given I am authenticated in project "test-project"
    And scenarios "Scenario A" and "Scenario B" exist
    When I call the batch archive endpoint for both scenarios
    Then both scenario records have archivedAt timestamps set
    And neither appears in list queries

  @integration
  Scenario: Batch archive reports individual failures
    Given I am authenticated in project "test-project"
    And scenario "Valid Scenario" exists
    And scenario "nonexistent-id" does not exist
    When I call the batch archive endpoint for both IDs
    Then "Valid Scenario" is archived successfully
    And the response reports "nonexistent-id" as failed

  # ============================================================================
  # Integration: Archived Scenario Guardrails
  # ============================================================================

  @integration
  Scenario: Run again is blocked for archived scenarios
    Given I am authenticated in project "test-project"
    And scenario "Archived Runner" has been archived
    When I view the run results for "Archived Runner"
    Then the "Run again" button is disabled
    And I see a message indicating the scenario has been archived

  @integration
  Scenario: Archived scenarios do not count against license limits
    Given I am authenticated in project "test-project"
    And the project has a scenario limit of 5
    And 5 scenarios exist
    When I archive 1 scenario
    Then I can create a new scenario without hitting the limit

  # ============================================================================
  # Integration: Negative Paths
  # ============================================================================

  @integration
  Scenario: Archiving an already-archived scenario is idempotent
    Given I am authenticated in project "test-project"
    And scenario "Already Archived" has been archived
    When I call the archive endpoint for "Already Archived"
    Then the request succeeds without error

  @integration
  Scenario: Cannot archive a scenario from a different project
    Given I am authenticated in project "project-a"
    And scenario "Foreign Scenario" exists in project "project-b"
    When I call the archive endpoint for "Foreign Scenario"
    Then I receive a not found error

  @integration
  Scenario: Archiving a non-existent scenario returns not found
    Given I am authenticated in project "test-project"
    When I call the archive endpoint for "nonexistent-id"
    Then I receive a not found error

  # ============================================================================
  # Unit: Selection State Logic
  # ============================================================================

  @unit
  Scenario: Toggle individual selection adds scenario to selected set
    Given no scenarios are selected
    When I toggle selection for scenario "scen_1"
    Then the selected set contains "scen_1"

  @unit
  Scenario: Toggle individual selection removes already-selected scenario
    Given scenario "scen_1" is selected
    When I toggle selection for scenario "scen_1"
    Then the selected set is empty

  @unit
  Scenario: Select all adds all visible scenario IDs to selected set
    Given 5 scenarios are visible with IDs "scen_1" through "scen_5"
    And no scenarios are selected
    When I select all
    Then the selected set contains all 5 IDs

  @unit
  Scenario: Deselect all clears the selected set
    Given 3 scenarios are selected
    When I deselect all
    Then the selected set is empty

  @unit
  Scenario: Selection count reflects number of selected scenarios
    Given scenarios "scen_1" and "scen_2" are selected
    Then the selection count is 2
