Feature: Workbench row selection
  As an author running or deleting rows in the experiments workbench
  I want each row's checkbox to show whether the row is selected
  So that the toolbar count and the table never disagree

  @integration
  Scenario: A selected row shows its checkbox ticked
    Given a workbench with two dataset rows
    When I select the first row
    Then the toolbar says 1 selected
    And the first row's checkbox is ticked and the second is not

  @integration
  Scenario: Selecting every row ticks the header and every row
    Given a workbench with two dataset rows
    When I tick the header checkbox
    Then the toolbar says 2 selected
    And the header and both row checkboxes are ticked

  @integration
  Scenario: Clearing the selection unticks every checkbox
    Given a workbench with a selected row
    When I clear the selection from the toolbar
    Then the toolbar disappears
    And no row checkbox is ticked
