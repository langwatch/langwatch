Feature: Single loading indicator on suites page
  As a LangWatch user
  I want to see skeleton placeholders instead of duplicate spinners when the suites page loads
  So that the experience feels polished and gives a preview of the page layout

  # Context: The suites page has a sidebar panel (suite list) and a main panel
  # (suite detail or all-runs view). Both panels fetch data independently.
  # Currently both show a Spinner component, resulting in two simultaneous
  # spinners. The fix replaces the sidebar spinner with skeleton placeholders
  # and suppresses the main panel until the sidebar is ready.

  @integration
  Scenario: Sidebar shows skeleton placeholders while loading
    Given the suites data has not yet loaded
    When I open the suites page
    Then the sidebar displays skeleton placeholder rows
    And no spinner is visible in the sidebar

  @integration
  Scenario: Main panel is not rendered while sidebar is loading
    Given the suites data has not yet loaded
    When I open the suites page
    Then the main panel is not rendered

  @integration
  Scenario: Main panel shows its own spinner after sidebar finishes loading
    Given the sidebar data has loaded
    And the main panel data is still loading
    When I view the suites page
    Then the sidebar displays the suite list
    And the main panel displays a loading indicator

  @integration
  Scenario: Main panel spinner still works for period changes
    Given all data has loaded
    And the all-runs view is visible
    When the period selector changes
    Then the main panel displays a loading indicator while refreshing
    And the sidebar does not show a loading indicator
