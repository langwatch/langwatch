@unit
Feature: MCP Test Suite Tools
  As a coding agent
  I want to manage test suites through the MCP server
  So that I can group scenarios and run a whole test suite at once

  # A test suite groups scenarios: a name and the scenarios filed in it.
  # A scenario is filed by testSuiteId. Running a test suite is sugar over a run
  # plan: the server creates or joins the plan named
  # "<suite name> <target name>" when the agent sends no name of its own.

  Background:
    Given the MCP server is configured with a valid API key

  Scenario: Agent lists the test suites of a project
    Given the project has test suites
    When the agent calls platform_list_test_suites
    Then the response contains a list of test suites with the count of scenarios in each

  Scenario: Agent lists test suites when none exist
    Given the project has no test suites
    When the agent calls platform_list_test_suites
    Then the response contains a message "No test suites found"
    And the response includes a tip to use platform_create_test_suite

  Scenario: Agent creates a test suite
    When the agent calls platform_create_test_suite with name "Checkout"
    Then the response confirms the test suite was created
    And the response says to file scenarios in it with testSuiteId

  Scenario: Agent reads a test suite with the scenarios filed in it
    Given a test suite exists with two scenarios filed in it
    When the agent calls platform_get_test_suite
    Then the response lists the name and the id of each scenario

  Scenario: Agent reads a test suite with no scenarios filed in it
    Given a test suite exists with no scenarios filed in it
    When the agent calls platform_get_test_suite
    Then the response says none are filed yet

  Scenario: Agent renames a test suite
    Given a test suite exists with id "suite_abc123"
    When the agent calls platform_rename_test_suite with a new name
    Then the response confirms the new name

  Scenario: Agent archives a test suite
    Given a test suite exists with id "suite_abc123"
    When the agent calls platform_archive_test_suite with id "suite_abc123"
    Then the response confirms the test suite is archived
    And the response says the scenarios filed in it are archived with it

  Scenario: Agent runs a test suite against a target
    Given a test suite exists with id "suite_abc123"
    When the agent calls platform_run_test_suite with one target
    Then the response names the run plan the run created or joined
    And the response includes the batch run id and the job count

  Scenario: Agent files a new scenario in a test suite
    When the agent calls platform_create_scenario with a testSuiteId
    Then the response says which test suite the scenario is filed in

  Scenario: Agent files an existing scenario in a test suite
    Given a scenario exists outside any test suite
    When the agent calls platform_update_scenario with a testSuiteId
    Then the response says which test suite the scenario is filed in

  Scenario: Agent lists only the scenarios filed in a test suite
    Given the project has scenarios in two different test suites
    When the agent calls platform_list_scenarios with a testSuiteId
    Then the response contains only the scenarios filed in that test suite

  Scenario: Agent lists the scenarios of an empty test suite
    Given the project has scenarios, none filed in the requested test suite
    When the agent calls platform_list_scenarios with a testSuiteId
    Then the response says no scenarios are filed in that test suite
