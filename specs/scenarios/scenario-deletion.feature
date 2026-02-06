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
  Scenario: Archive a single scenario via row action menu
    When I am on the scenarios list page
    And I open the row action menu for "Angry double-charge refund"
    And I click "Archive"
    Then I see a confirmation modal asking to archive "Angry double-charge refund"
    When I confirm the archive
    Then "Angry double-charge refund" no longer appears in the scenarios list
    And the remaining 4 scenarios are still visible

  @e2e
  Scenario: Batch archive multiple selected scenarios
    When I am on the scenarios list page
    And I select the checkbox for "Cross-doc synthesis question"
    And I select the checkbox for "Failed booking escalation"
    Then I see a batch action bar showing "2 selected"
    When I click the "Archive" button in the batch action bar
    Then I see a confirmation modal listing both scenarios
    When I confirm the archive
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
  Scenario: Row action menu contains archive option
    When I am on the scenarios list page
    And I open the row action menu for "Angry double-charge refund"
    Then I see an "Archive" option in the menu

  @integration
  Scenario: Single archive confirmation modal shows scenario name
    When I am on the scenarios list page
    And I open the row action menu for "Angry double-charge refund"
    And I click "Archive"
    Then I see a confirmation modal with title "Archive scenario?"
    And the modal displays the scenario name "Angry double-charge refund"
    And the modal shows "Archived scenarios will no longer appear in the library."
    And the modal has "Cancel" and "Archive" buttons

  @integration
  Scenario: Cancel single archive dismisses modal without archiving
    When I am on the scenarios list page
    And I open the row action menu for "Angry double-charge refund"
    And I click "Archive"
    And I click "Cancel" in the confirmation modal
    Then the modal closes
    And "Angry double-charge refund" still appears in the scenarios list

  # ============================================================================
  # Integration: Batch Archive
  # ============================================================================

  @integration
  Scenario: Batch archive confirmation modal lists all selected scenarios
    When I am on the scenarios list page
    And I select 2 scenarios
    And I click the "Archive" button in the batch action bar
    Then I see a confirmation modal with title "Archive 2 scenarios?"
    And the modal lists each selected scenario by name
    And the modal shows "Archived scenarios will no longer appear in the library."
    And the modal has "Cancel" and "Archive" buttons

  @integration
  Scenario: Cancel batch archive dismisses modal and preserves selection
    When I am on the scenarios list page
    And I select 2 scenarios
    And I click the "Archive" button in the batch action bar
    And I click "Cancel" in the confirmation modal
    Then the modal closes
    And the 2 scenarios remain selected
    And both scenarios still appear in the scenarios list

  # ============================================================================
  # Integration: Soft Archive Backend Behavior
  # ============================================================================

  @integration
  Scenario: Archived scenario is soft-deleted, not permanently removed
    Given I am authenticated in project "test-project"
    And scenario "To Archive" exists
    When I archive "To Archive"
    Then "To Archive" is marked as archived
    And "To Archive" still exists in the database

  @integration
  Scenario: Archived scenario does not appear in the scenario list
    Given I am authenticated in project "test-project"
    And scenario "Archived Scenario" has been archived
    When I view the scenario list for the project
    Then "Archived Scenario" is not in the list

  @integration
  Scenario: Archived scenario is still accessible for historical lookups
    Given I am authenticated in project "test-project"
    And scenario "Archived Scenario" has been archived
    When I look up "Archived Scenario" including archived
    Then "Archived Scenario" is returned and marked as archived

  @integration
  Scenario: Batch archive marks all selected scenarios as archived
    Given I am authenticated in project "test-project"
    And scenarios "Scenario A" and "Scenario B" exist
    When I archive "Scenario A" and "Scenario B" together
    Then both scenarios are marked as archived
    And neither appears in the scenario list

  @integration
  Scenario: Batch archive reports individual failures
    Given I am authenticated in project "test-project"
    And scenario "Valid Scenario" exists
    And scenario "nonexistent-id" does not exist
    When I archive "Valid Scenario" and "nonexistent-id" together
    Then "Valid Scenario" is archived successfully
    And "nonexistent-id" is reported as failed

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
    When I archive "Already Archived"
    Then the request succeeds without error

  @integration
  Scenario: Cannot archive a scenario from a different project
    Given I am authenticated in project "project-a"
    And scenario "Foreign Scenario" exists in project "project-b"
    When I archive "Foreign Scenario"
    Then I receive a not found error

  @integration
  Scenario: Archiving a non-existent scenario returns not found
    Given I am authenticated in project "test-project"
    When I archive "nonexistent-id"
    Then I receive a not found error

  # ============================================================================
  # Unit: Selection State Logic
  # ============================================================================

  @unit
  Scenario: Toggling selection adds a scenario
    Given no scenarios are selected
    When I toggle selection for "scen_1"
    Then "scen_1" is selected

  @unit
  Scenario: Toggling selection removes an already-selected scenario
    Given "scen_1" is selected
    When I toggle selection for "scen_1"
    Then no scenarios are selected

  @unit
  Scenario: Select all selects all visible scenarios
    Given 5 scenarios are visible
    And no scenarios are selected
    When I select all
    Then all 5 scenarios are selected

  @unit
  Scenario: Deselect all clears the selection
    Given 3 scenarios are selected
    When I deselect all
    Then no scenarios are selected

  @unit
  Scenario: Selection count reflects number of selected scenarios
    Given "scen_1" and "scen_2" are selected
    Then the selection count is 2
