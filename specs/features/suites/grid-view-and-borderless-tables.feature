Feature: Scenario result grid view and full-width borderless run history
  As a LangWatch user
  I want to toggle between list and grid views for scenario results
  and see run history in clean full-width tables
  So that I can scan results visually as cards or as a compact list

  # The run history currently shows scenario results only in a list.
  # This feature adds a grid/list toggle so scenario results within an
  # expanded run can display as cards (reusing SimulationCard) or rows.
  # It also updates run history styling to full-width borderless tables
  # with sticky collapsible headers.

  # --- List/Grid View Toggle ---

  @integration
  Scenario: Filter bar shows a list/grid view toggle
    Given a suite has run history
    When I view the suite detail panel
    Then a list/grid view toggle is visible in the filter bar
    And the default view is grid

  @integration
  Scenario: Switching to grid view shows scenario results as cards
    Given a run row is expanded to show scenario results
    When I select the grid view toggle
    Then scenario results display as cards in a responsive grid

  @integration
  Scenario: Switching to list view shows scenario results as rows
    Given a run row is expanded to show scenario results
    When I select the list view toggle
    Then scenario results display as rows in the current list layout

  @e2e
  Scenario: View toggle preference persists within the session
    Given I select the grid view toggle
    When I navigate to a different suite and back
    Then the grid view is still selected

  @integration
  Scenario: Grid layout is responsive
    Given a run row is expanded in grid view
    When the viewport narrows
    Then cards reflow to fewer columns

  # --- Full-Width Borderless Tables ---

  @integration
  Scenario: Run history rows span the full container width
    Given a suite has run history
    When I view the suite detail panel
    Then run history rows span the full container width

  @integration
  Scenario: Run history rows have no rounded corners
    Given a suite has run history
    When I view the suite detail panel
    Then run history rows have no rounded corners

  @integration
  Scenario: Run row headers are sticky when scrolling
    Given a run row is expanded with many scenario results
    When I scroll down through the results
    Then the run row header remains visible at the top

  @integration
  Scenario: Expanded scenario rows span the full container width
    Given a run row is expanded to show scenario results
    When I view the expanded content in list view
    Then scenario rows span the full container width

  @integration
  Scenario: Expanded scenario rows have no outer border radius
    Given a run row is expanded to show scenario results
    When I view the expanded content in list view
    Then scenario rows have no outer border radius
