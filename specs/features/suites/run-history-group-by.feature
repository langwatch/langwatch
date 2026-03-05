Feature: Suite run history group-by selector
  As a user viewing suite run results
  I want to group results by target or scenario
  So that I can analyze results from different perspectives

  Background:
    Given a suite with multiple scenarios, targets, and batch runs

  # Full workflow: user switches grouping and sees re-grouped results
  @e2e
  Scenario: User groups suite results by target
    Given the suite has run results across multiple targets
    When I open the suite run history
    Then results are grouped by batch run by default with group-by set to "None"
    When I select "Target" from the group-by selector
    Then results are grouped by target
    And each target group header shows the target name, pass rate, and run count

  # Full workflow: group-by selection persists across page reload
  @e2e
  Scenario: Group-by selection persists in the URL
    When I select "Target" from the group-by selector
    Then the URL contains a groupBy query parameter set to "target"
    When I reload the page
    Then "Target" is still selected in the group-by selector
    And results are grouped by target

  # UI elements: selector exists with correct options
  @integration
  Scenario: Group-by selector renders with correct options
    When the run history list renders
    Then I see a group-by selector in the top-right of the filter bar
    And the selector has options "None", "Scenario", and "Target"
    And "None" is selected by default

  # Grouping by scenario shows scenario name headers with pass rate and counts
  @integration
  Scenario: Grouping by scenario re-groups results under scenario headers
    Given run data with multiple scenarios across multiple batch runs
    When I select "Scenario" from the group-by selector
    Then results are grouped under scenario name headers
    And each scenario group header shows the scenario name, pass rate, and run count
    And the collapsed summary shows passed and failed counts

  # Grouping by target shows target name headers with pass rate and counts
  @integration
  Scenario: Grouping by target re-groups results under target headers
    Given run data with multiple targets across multiple batch runs
    When I select "Target" from the group-by selector
    Then results are grouped under target name headers
    And each target group header shows the target name, pass rate, and run count
    And the collapsed summary shows passed and failed counts

  # None grouping preserves current batch run behavior
  @integration
  Scenario: None grouping preserves current batch run layout
    Given run data with multiple batch runs
    When group-by is set to "None"
    Then results are grouped by batch run
    And each group shows the batch run timestamp, pass rate, and trigger type

  # Grouping respects active scenario filter
  @integration
  Scenario: Grouping by target respects active scenario filter
    Given run data with scenarios "Login" and "Signup" across targets "agent-1" and "agent-2"
    When I filter by scenario "Login"
    And I select "Target" from the group-by selector
    Then only "Login" runs appear, grouped by target

  # Changing group-by mode preserves active filters
  @integration
  Scenario: Switching group-by mode preserves active filters
    Given run data with scenarios "Login" and "Signup"
    When I filter by scenario "Login"
    And I select "Scenario" from the group-by selector
    Then the scenario filter is still set to "Login"

  # Switching group-by resets expansion state
  @integration
  Scenario: Switching group-by mode collapses all groups
    Given a group is expanded
    When I select "Target" from the group-by selector
    Then all groups are collapsed

  # All grouping functions return a consistent group structure
  @unit
  Scenario: Every grouping mode returns groups with identifier, label, type, timestamp, and runs
    Given scenario runs grouped by any mode
    When grouping completes
    Then each group has an identifier, a display label, a type, a timestamp, and associated runs

  # Pure grouping logic: group by scenario
  @unit
  Scenario: groupRunsByScenarioId groups runs by their scenarioId
    Given scenario runs with scenarioIds "s1", "s1", "s2", "s2", "s2"
    When grouping by scenario
    Then the result contains 2 groups
    And the "s1" group has 2 runs
    And the "s2" group has 3 runs

  # Pure grouping logic: group by target (from metadata.langwatch.targetReferenceId)
  @unit
  Scenario: groupRunsByTarget groups runs by their targetReferenceId
    Given scenario runs with metadata.langwatch.targetReferenceId "agent-1", "agent-1", "prompt-1"
    When grouping by target
    Then the result contains 2 groups
    And the "agent-1" group has 2 runs
    And the "prompt-1" group has 1 run

  # Grouping by target with missing target metadata
  @unit
  Scenario: groupRunsByTarget places runs without target metadata in an "Unknown" group
    Given scenario runs where some have no metadata.langwatch.targetReferenceId
    When grouping by target
    Then runs without target metadata are grouped under "Unknown"

  # Sorting: groups are sorted by most recent activity
  @unit
  Scenario: Groups are sorted by most recent timestamp descending
    Given three groups with latest timestamps 1000, 3000, 2000
    When grouping completes
    Then groups are ordered with timestamp 3000 first, then 2000, then 1000
