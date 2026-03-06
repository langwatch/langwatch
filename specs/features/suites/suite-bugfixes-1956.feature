Feature: Suite bugfixes - drawer navigation, table width, and quick run
  As a user viewing suite runs
  I want consistent drawer-based navigation, full-width tables, and proper quick-run behavior
  So that I stay in context without being sent to deprecated pages

  # Bug 1: ExternalSetDetailPanel navigates to old run page

  @integration
  Scenario: Clicking a run in external set detail opens the drawer
    Given the ExternalSetDetailPanel is rendered with run data
    When I click on a scenario run row
    Then the scenario run detail drawer opens with that run's ID
    And the browser does not navigate to a new page

  # Bug 2: All Runs page tables are not full width

  @integration
  Scenario: Run rows in All Runs panel span the full available width
    Given the AllRunsPanel is rendered with batch run data
    Then the run list container has no horizontal padding
    And the header, filter, empty state, load-more, and footer sections have horizontal padding

  # Bug 3: Quick run navigation uses callbacks instead of hardcoded navigation

  @integration
  Scenario: Quick run from drawer navigates to runs page via URL with drawer params
    Given I trigger a quick run from the scenario run detail drawer
    When the run completes successfully
    Then I am navigated to the suite runs page with drawer params in the URL
    And the scenario run detail drawer opens with the new run's ID on page load

  @integration
  Scenario: Quick run failure shows toast with drawer link instead of page link
    Given I trigger a quick run from the scenario run detail drawer
    When the run fails with an error
    Then I see an error toast
    And the toast action opens the scenario run detail drawer for the failed run

  # Regression guard: standalone run page still works

  @integration
  Scenario: Run Again from standalone run page stays on the standalone page
    Given I am on the standalone scenario run page
    When I click Run Again and the run completes
    Then I remain on the standalone run page with the new run displayed
