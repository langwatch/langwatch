Feature: Scenario result grid view and full-width borderless run history
  As a LangWatch user
  I want to toggle between list and grid views for scenario results
  and see run history in clean full-width tables
  So that I can scan results visually as cards or as a compact list

  # The run history currently shows scenario results only in a list.
  # This feature adds a grid/list toggle so scenario results within an
  # expanded run can display as cards (reusing SimulationCard) or rows.
  # It also updates run history styling to full-width borderless tables
  # with sticky collapsible headers. All run rows are expanded by default.

  # --- List/Grid View Toggle ---

  @integration @unimplemented
  Scenario: Switching to list view shows scenario results as rows
    Given a run row is expanded to show scenario results
    When I select the list view toggle
    Then scenario results display as rows in the current list layout

  @e2e @unimplemented
  Scenario: View toggle preference persists within the session
    Given I select the grid view toggle
    When I navigate to a different suite and back
    Then the grid view is still selected

  @integration @unimplemented
  Scenario: Grid layout is responsive
    Given a run row is expanded in grid view
    When the viewport narrows
    Then cards reflow to fewer columns

  # --- Run Rows Expanded by Default ---

  @integration @unimplemented
  Scenario: Expanded scenario rows span the full container width
    Given a run row is expanded to show scenario results
    When I view the expanded content in list view
    Then scenario rows span the full container width

  @integration @unimplemented
  Scenario: Expanded scenario rows have no outer border radius
    Given a run row is expanded to show scenario results
    When I view the expanded content in list view
    Then scenario rows have no outer border radius
