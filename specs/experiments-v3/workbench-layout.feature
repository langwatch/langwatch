Feature: Experiments workbench page layout
  As a user working in the experiments workbench
  I want the data grid laid out beside the navigation menu, never under it
  So that the leftmost columns (row select and the first dataset cell) stay visible and clickable

  # The workbench renders inside DashboardLayout. With the compact menu the rail
  # is a 56px strip whose inner box is position:absolute, zIndex 100, and
  # expands to a 200px overlay on hover (see MainMenu). That overlay covers the
  # grid's leftmost columns. The workbench therefore requests the full in-flow
  # menu (it does not pass compactMenu), so the menu reserves its own width in
  # the page flow and never overlaps the grid. The prop-level contract is bound
  # to WorkbenchUsesFullMenu.integration.test.tsx; the visual result (no column
  # hidden behind the menu) is verified by browser QA.

  @unit
  Scenario: The workbench lays out beside the full navigation menu, not under the compact overlay rail
    Given I open an experiment in the workbench
    Then the page uses the full in-flow navigation menu
    And the grid is not placed under a hover-overlay menu rail
