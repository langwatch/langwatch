Feature: Suite Archiving
  As a LangWatch user
  I want to archive suites instead of permanently deleting them
  So that historical test results are preserved and accidental deletions are recoverable

  Background:
    Given I am logged into project "my-project"
    And the following suites exist:
      | name                | scenarios | last run  |
      | Regression Suite    | 5         | 2 days ago |
      | Smoke Tests         | 3         | 1 day ago  |
      | Edge Case Suite     | 4         | 1 week ago |

  # ============================================================================
  # E2E: Happy Paths — Full User Workflows
  # ============================================================================

  @e2e
  Scenario: Archive a suite via the context menu
    When I right-click on "Regression Suite" in the sidebar
    And I click "Archive"
    Then I see a confirmation modal asking to archive "Regression Suite"
    When I confirm the archive
    Then "Regression Suite" no longer appears in the sidebar
    And I do not see a "Delete" option in the context menu
    And the remaining 2 suites are still visible

  @e2e
  Scenario: Archived suite runs remain visible in All Runs
    Given "Regression Suite" has been archived
    When I navigate to the All Runs view
    Then the test runs for "Regression Suite" are still accessible

  @e2e
  Scenario: Restore an archived suite
    Given "Edge Case Suite" has been archived
    When I navigate to the archived suites view
    Then I see "Edge Case Suite" listed as archived
    When I click "Restore" on "Edge Case Suite"
    Then "Edge Case Suite" reappears in the sidebar
    And I can run "Edge Case Suite" again

  # ============================================================================
  # Integration: Context Menu — Archive replaces Delete
  # ============================================================================

  @integration
  Scenario: Archive confirmation modal displays suite name
    When I right-click on "Smoke Tests" in the sidebar
    And I click "Archive"
    Then I see a confirmation modal with title "Archive suite?"
    And the modal displays the suite name "Smoke Tests"

  @integration
  Scenario: Archive confirmation modal explains preservation
    When I right-click on "Smoke Tests" in the sidebar
    And I click "Archive"
    Then the modal shows "Archived suites will no longer appear in the sidebar. Test runs are preserved."

  @integration
  Scenario: Archive confirmation modal has Cancel and Archive buttons
    When I right-click on "Smoke Tests" in the sidebar
    And I click "Archive"
    Then the modal has "Cancel" and "Archive" buttons

  @integration
  Scenario: Cancel archive dismisses modal without archiving
    When I right-click on "Smoke Tests" in the sidebar
    And I click "Archive"
    And I click "Cancel" in the confirmation modal
    Then the modal closes
    And "Smoke Tests" still appears in the sidebar

  # ============================================================================
  # Integration: Archived Suites Hidden from Default Views
  # ============================================================================

  @integration
  Scenario: Archived suite does not appear in sidebar search results
    Given "Edge Case Suite" has been archived
    When I search for "Edge Case" in the sidebar
    Then no matching suites are shown

  # ============================================================================
  # Integration: Viewing and Restoring Archived Suites
  # ============================================================================

  @integration
  Scenario: Archived suites view lists all archived suites
    Given "Edge Case Suite" has been archived
    And "Regression Suite" has been archived
    When I navigate to the archived suites view
    Then I see both "Edge Case Suite" and "Regression Suite"
    And each suite shows its archived date

  @integration
  Scenario: Restored suite appears in the default suite list
    Given "Edge Case Suite" has been archived
    When I restore "Edge Case Suite"
    Then "Edge Case Suite" appears in the default suite list

  # ============================================================================
  # Integration: Soft Archive Backend Behavior
  # ============================================================================

  @integration
  Scenario: Archived suite is retrievable when including archived
    Given I am authenticated in project "test-project"
    And suite "To Archive" exists
    When I archive "To Archive"
    Then "To Archive" appears when listing suites including archived
    And "To Archive" does not appear when listing active suites

  @integration
  Scenario: Archived suite preserves associated test runs
    Given I am authenticated in project "test-project"
    And suite "To Archive" exists with 3 completed runs
    When I archive "To Archive"
    Then all 3 runs for "To Archive" are returned by the runs API

  @integration
  Scenario: Archived suite is returned when queried including archived
    Given I am authenticated in project "test-project"
    And suite "Archived Suite" has been archived
    When I look up "Archived Suite" including archived
    Then "Archived Suite" is returned and marked as archived

  # ============================================================================
  # Integration: Negative Paths
  # ============================================================================

  @integration
  Scenario: Archiving an already-archived suite is idempotent
    Given I am authenticated in project "test-project"
    And suite "Already Archived" has been archived
    When I archive "Already Archived"
    Then the request succeeds without error

  @integration
  Scenario: Cannot archive a suite from a different project
    Given I am authenticated in project "project-a"
    And suite "Foreign Suite" exists in project "project-b"
    When I archive "Foreign Suite"
    Then I receive a not found error

  @integration
  Scenario: Archiving a non-existent suite returns not found
    Given I am authenticated in project "test-project"
    When I archive "nonexistent-id"
    Then I receive a not found error

  @integration
  Scenario: Restoring a suite whose slug conflicts with an active suite fails with error
    Given I am authenticated in project "test-project"
    And suite "Duplicate Suite" exists and has been archived
    And a new suite "Duplicate Suite" exists with the same slug
    When I restore the archived "Duplicate Suite"
    Then I receive an error indicating the slug is already in use

  @integration
  Scenario: Restoring a non-archived suite is a no-op
    Given I am authenticated in project "test-project"
    And suite "Active Suite" exists and is not archived
    When I restore "Active Suite"
    Then the request succeeds without error
    And "Active Suite" remains in the default suite list
