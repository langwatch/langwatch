Feature: Suite sidebar status summary
  As a LangWatch user
  I want to see pass count and recency for each suite in the sidebar
  So that I can assess suite health at a glance without clicking into each one

  Background:
    Given I am logged into project "my-project"
    And the feature flag "release_ui_suites_enabled" is enabled

  # Pass count and recency display

  @integration
  Scenario: Suite item shows pass count and time since last run
    Given suite "Critical Path" last ran 2 hours ago with 8/8 passing
    When I view the suites sidebar
    Then "Critical Path" shows a checkmark icon with "8/8 passed" and recency

  @integration
  Scenario: Suite item shows partial pass count with failure icon
    Given suite "Billing Edge" last ran 3 hours ago with 9/12 passing
    When I view the suites sidebar
    Then "Billing Edge" shows an error icon with "9/12 passed" and recency

  @integration
  Scenario: Suite item with no runs shows no summary
    Given suite "New Suite" exists with no completed runs
    When I view the suites sidebar
    Then "New Suite" shows only its name with no summary line

  @integration
  Scenario: "All Runs" item does not show a status summary
    Given suites exist with completed runs
    When I view the suites sidebar
    Then the "All Runs" item shows no pass count or recency

  # Summary updates

  @integration
  Scenario: Summary reflects latest run data
    Given suite "Critical Path" previously showed 7/8 passed
    When a new run completes for "Critical Path" with 8/8 passing
    Then "Critical Path" shows a checkmark icon with "8/8 passed" and recency

  # Three-dot context menu on hover (#1670)

  @integration
  Scenario: Three-dot menu button appears on hover
    Given suite "Critical Path" exists
    When I hover over "Critical Path" in the sidebar
    Then a three-dot menu button appears on the right side of the suite item

  @integration
  Scenario: Three-dot menu button is hidden when not hovering
    Given suite "Critical Path" exists
    When I am not hovering over "Critical Path" in the sidebar
    Then the three-dot menu button is not visible

  @integration
  Scenario: Clicking three-dot menu opens context menu
    Given suite "Critical Path" exists
    When I hover over "Critical Path" in the sidebar
    And I click the three-dot menu button
    Then I see a context menu with "Edit", "Duplicate", and "Delete"
    And "Delete" is styled in red

  @integration
  Scenario: Context menu stays open after mouse leaves suite item
    Given I hover over "Critical Path" and click the three-dot menu
    When I move my mouse away from the suite item
    Then the context menu remains visible
