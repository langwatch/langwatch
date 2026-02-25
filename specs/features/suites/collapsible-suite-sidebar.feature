Feature: Collapsible suite sidebar
  As a LangWatch user
  I want to collapse the suite sidebar to a narrow icon strip
  So that I can save horizontal space when I don't need to see suite details

  # Design: The sidebar has two states:
  # - Expanded: Full sidebar with header, search box, action buttons, and
  #   suite cards showing names and run status.
  # - Collapsed: Narrow icon strip showing expand button, action icons
  #   (new suite, all runs), and suite avatar icons only.
  # The collapse toggle is the «/» button in the sidebar header.

  Background:
    Given the suite sidebar contains suites

  @integration
  Scenario: Sidebar is expanded by default
    When I open the suites page
    Then the sidebar is in expanded mode
    And the search box is visible
    And suite names and run status are visible

  @integration
  Scenario: Clicking the collapse button collapses the sidebar
    Given the sidebar is expanded
    When I click the collapse button
    Then the sidebar is in collapsed mode
    And only suite icons are visible
    And the search box is not visible

  @integration
  Scenario: Clicking the expand button expands the sidebar
    Given the sidebar is collapsed
    When I click the expand button
    Then the sidebar is in expanded mode
    And suite names and run status are visible
    And the search box is visible

  @integration
  Scenario: All Runs action is accessible when collapsed
    Given the sidebar is collapsed
    Then the all runs icon button is visible

  @integration
  Scenario: Clicking a suite icon when collapsed navigates to that suite
    Given the sidebar is collapsed
    When I click a suite icon
    Then I navigate to that suite's detail view

  @e2e
  Scenario: Collapse state persists across page navigations
    Given the sidebar is collapsed
    When I navigate to another page and return
    Then the sidebar is still in collapsed mode
