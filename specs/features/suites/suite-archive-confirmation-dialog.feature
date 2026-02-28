Feature: Suite archive confirmation dialog
  As a user managing suites
  I want an in-app confirmation dialog when archiving a suite
  So that the experience is consistent with the rest of the app and I can make an informed decision

  Background:
    Given I am on the Suites page
    And a suite named "Smoke Tests" exists

  # The archive flow uses a Chakra Dialog instead of a browser-native window.confirm.
  # This covers the full happy path: context menu -> dialog -> confirm.
  @integration
  Scenario: Archive confirmation dialog appears when archiving a suite
    When I right-click on the "Smoke Tests" suite
    And I click "Archive" in the context menu
    Then I see a confirmation dialog with the title "Archive suite?"
    And the dialog displays the suite name "Smoke Tests"
    And the dialog explains that archived suites no longer appear in the sidebar

  @integration
  Scenario: Cancel dismisses the archive confirmation dialog without archiving
    Given the archive confirmation dialog is open for "Smoke Tests"
    When I click "Cancel"
    Then the dialog closes
    And the suite "Smoke Tests" is still visible in the sidebar

  @integration
  Scenario: Confirm archives the suite
    Given the archive confirmation dialog is open for "Smoke Tests"
    When I click "Archive"
    Then the suite is archived
    And the dialog closes

  @integration
  Scenario: Buttons are disabled while archive is in progress
    Given the archive confirmation dialog is open for "Smoke Tests"
    When the archive request is in progress
    Then the Cancel button is disabled
    And the Archive button is disabled
