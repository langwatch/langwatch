Feature: Remove redundant SUITES label from sidebar
  As a LangWatch user
  I want the sidebar to avoid repeating "SUITES" when the page header already says "Suites"
  So that there is less visual noise and a cleaner layout

  # The sidebar currently displays a "SUITES" section header above the suite list.
  # This is redundant because the top-level page header already reads "Suites".
  # Removing it reduces visual clutter while preserving the sidebar's hierarchy
  # (search box, action buttons, and suite cards remain unchanged).

  @integration
  Scenario: Sidebar does not display a redundant SUITES label
    Given the suite sidebar contains suites
    When I view the suites sidebar in expanded mode
    Then there is no "SUITES" section header above the suite list

  @integration
  Scenario: Sidebar still shows suite names and action buttons after label removal
    Given the suite sidebar contains suites
    When I view the suites sidebar in expanded mode
    Then suite names are visible
    And the search box is visible
    And the collapse button is visible
