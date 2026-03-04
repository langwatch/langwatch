Feature: Single loading indicator on suites page
  As a LangWatch user
  I want to see skeleton placeholders instead of duplicate spinners when the suites page loads
  So that the experience feels polished and gives a preview of the page layout

  @integration
  Scenario: Sidebar shows skeleton placeholders while loading
    Given the suites page is loading
    When I open the suites page
    Then the sidebar displays skeleton placeholder rows
    And no spinner is visible in the sidebar

  @integration
  Scenario: Main panel content is hidden while the page is still loading
    Given the suites page is loading
    When I open the suites page
    Then I do not see suite details or all-runs content yet

  @integration
  Scenario: Main panel shows its own loading indicator after sidebar is ready
    Given the sidebar shows the suite list
    And the main panel content is still loading
    When I stay on the suites page
    Then the sidebar displays the suite list
    And the main panel displays a loading indicator
