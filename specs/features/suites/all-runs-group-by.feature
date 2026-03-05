Feature: All Runs page group-by selector
  As a user viewing the All Runs page
  I want to group results by scenario, target, or none
  So that I can analyze all historical runs from different perspectives

  Background:
    Given a project with scenario runs across multiple suites, scenarios, and targets

  @e2e
  Scenario: User groups All Runs results by scenario
    When I open the All Runs page
    Then results are grouped by batch run by default
    And the group-by selector shows "None"
    When I select "Scenario" from the group-by selector
    Then results are grouped by scenario
    And each scenario group header shows the scenario name, pass rate, and run count

  @integration
  Scenario: All Runs page displays group-by selector with correct options and default
    When I open the All Runs page
    Then I see a group-by selector in the filter bar
    And the selector has options "None", "Scenario", and "Target"
    And "None" is selected by default

  @integration
  Scenario: None grouping on All Runs preserves batch run layout
    Given run data with multiple batch runs across suites
    When I select "None" from the group-by selector
    Then results are grouped by batch run
    And each group shows the batch run timestamp, pass rate, and trigger type

  @integration
  Scenario: Grouped results include runs from all suites
    Given runs from suite "Suite A" and suite "Suite B"
    When I select "Scenario" from the group-by selector
    Then grouped results include runs from both "Suite A" and "Suite B"
