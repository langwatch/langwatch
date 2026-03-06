Feature: Unified group-by and list/grid view across all run views
  As a LangWatch user
  I want the same layout controls (group-by, list/grid toggle) on every run view
  So that I have a consistent experience whether viewing suite runs, external sets, or all runs

  Background:
    Given I am logged into a project with scenario runs

  # Happy path: external runs view has the same controls as suite runs
  @e2e
  Scenario: External set view shows group-by and list/grid toggle
    Given an SDK client has submitted scenario runs with scenarioSetId "nightly-regression"
    When I open the external set "nightly-regression"
    Then I see a group-by selector in the filter bar
    And I see a list/grid view toggle in the filter bar
    When I select "Scenario" from the group-by selector
    Then results are grouped by scenario
    When I select the list view toggle
    Then scenario results display as rows

  # Happy path: all three views share the same layout controls
  @e2e
  Scenario: All run views provide the same layout controls
    Given a suite "Checkout Tests" with run history exists
    And an SDK client has submitted scenario runs with scenarioSetId "ci-smoke"
    When I open suite "Checkout Tests"
    Then I see a group-by selector and a list/grid view toggle
    When I navigate to the all runs panel
    Then I see a group-by selector and a list/grid view toggle
    When I navigate to the external set "ci-smoke"
    Then I see a group-by selector and a list/grid view toggle

  # External runs omit "Target" from group-by since targets do not apply
  @integration
  Scenario: External set group-by selector omits target option
    Given I am viewing an external set detail panel
    When the filter bar renders
    Then the group-by selector has options "None" and "Scenario"
    And the group-by selector does not have a "Target" option

  # Suite view retains all group-by options including Target
  @integration
  Scenario: Suite detail group-by selector includes target option
    Given I am viewing a suite detail panel with targets
    When the filter bar renders
    Then the group-by selector has options "None", "Scenario", and "Target"

  # All runs view includes all group-by options
  @integration
  Scenario: All runs group-by selector includes all options
    Given I am viewing the all runs panel
    When the filter bar renders
    Then the group-by selector has options "None", "Scenario", and "Target"

  # External set respects group-by selection
  @integration
  Scenario: Grouping by scenario in external set groups runs under scenario headers
    Given an external set with runs across scenarios "Login" and "Signup"
    When I select "Scenario" from the group-by selector
    Then results are grouped under scenario name headers
    And each group header shows the scenario name, pass rate, and run count

  # External set supports list/grid toggle
  @integration
  Scenario: External set supports list and grid view modes
    Given an external set with expanded run results
    When I select the grid view toggle
    Then scenario results display as cards in a responsive grid
    When I select the list view toggle
    Then scenario results display as rows

  # Shared filter bar component is used across all views
  @integration
  Scenario: All views render the same filter bar component
    Given I am viewing a suite detail panel
    Then the filter bar contains scenario filter, pass/fail filter, group-by, and view toggle
    When I navigate to the all runs panel
    Then the filter bar contains scenario filter, pass/fail filter, group-by, and view toggle
    When I navigate to an external set panel
    Then the filter bar contains scenario filter, pass/fail filter, group-by, and view toggle

  # View mode persists when switching between views
  @integration
  Scenario: View mode selection carries over between views
    Given I select the list view toggle on the suite detail panel
    When I navigate to the all runs panel
    Then the list view is still selected

  # Group-by "None" in external set shows batch run grouping
  @integration
  Scenario: External set with group-by None shows batch run grouping
    Given an external set with multiple batch runs
    When group-by is set to "None"
    Then results are grouped by batch run
    And each group shows the batch run timestamp and pass rate

  # Determines available group-by options based on view context
  @unit
  Scenario: availableGroupByOptions returns options without Target for external sets
    Given the view context is "external"
    When computing available group-by options
    Then the result is ["none", "scenario"]

  @unit
  Scenario: availableGroupByOptions returns all options for suite views
    Given the view context is "suite"
    When computing available group-by options
    Then the result is ["none", "scenario", "target"]

  @unit
  Scenario: availableGroupByOptions returns all options for all-runs view
    Given the view context is "all-runs"
    When computing available group-by options
    Then the result is ["none", "scenario", "target"]
