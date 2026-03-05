Feature: All Runs panel shows all scenario runs
  As a user viewing the Suites page
  I want the All Runs panel to show all scenario runs for my project
  So that I can see historical runs regardless of when they were created

  Background:
    Given a project with scenario runs

  @integration
  Scenario: Pre-suite scenario runs appear in All Runs
    Given scenario runs exist with scenarioSetId "default"
    When I fetch all suite run data
    Then the pre-suite runs are included in the results

  @integration
  Scenario: Suite-created runs still appear in All Runs
    Given scenario runs exist with a suite-pattern scenarioSetId
    When I fetch all suite run data
    Then the suite runs are included in the results

  @integration
  Scenario: All run types appear together
    Given scenario runs exist with scenarioSetId "default"
    And scenario runs exist with a suite-pattern scenarioSetId
    When I fetch all suite run data
    Then both pre-suite and suite runs are included in the results
