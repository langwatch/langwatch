@integration
Feature: The test suites REST API
  As a developer organising agent tests over HTTP
  I want a test suite family that holds a folder of scenarios
  So that I can run a whole folder against the targets I choose at run time

  # A TEST SUITE is a folder of scenarios. It holds what it collects and
  # nothing about how a run of it is executed, so the targets, the repeat count
  # and the models arrive with the run request.
  #
  #   GET    /api/v1/test-suites            list the project's test suites
  #   POST   /api/v1/test-suites            create an empty test suite
  #   GET    /api/v1/test-suites/{id}       read one test suite and its scenarios
  #   PATCH  /api/v1/test-suites/{id}       rename a test suite
  #   DELETE /api/v1/test-suites/{id}       archive a test suite and its scenarios
  #   POST   /api/v1/test-suites/{id}/run   run the suite against the targets sent

  Scenario: Listing test suites returns the folders only
    Given the project holds one test suite and one run plan
    When I list the test suites
    Then only the test suite is returned

  Scenario: Creating a test suite creates it empty
    When I create a test suite named "Refunds"
    Then the response is 201
    And the test suite holds no scenario

  Scenario: Reading a test suite names the scenarios filed in it
    Given a test suite holds two scenarios
    When I read the test suite
    Then both scenarios are named in the response

  Scenario: Reading a run plan through the test suite route answers suite_not_found
    Given the project holds one run plan
    When I read that run plan id through the test suites route
    Then the response is 404 with the code suite_not_found

  Scenario: Renaming a test suite keeps its slug
    Given the project holds a test suite named "Refunds"
    When I rename the test suite to "Returns"
    Then the test suite carries the new name
    And the slug is unchanged

  Scenario: Archiving a test suite archives the scenarios filed in it
    Given a test suite holds two scenarios
    When I archive the test suite
    Then the test suite is archived
    And both scenarios are archived

  Scenario: Running a test suite names the plan after the suite and its targets
    Given a test suite holds one scenario
    And the project holds one agent named "dev-agent"
    When I run the test suite against that agent
    Then a run plan named "Refunds dev-agent" is created
    And the runs are scheduled

  Scenario: Running a test suite twice joins the run plan the first run resolved
    Given a test suite holds one scenario
    And the project holds one agent named "dev-agent"
    And the test suite has already been run against that agent
    When I run the test suite against that agent
    Then the response reports the plan as not created

  Scenario: Running a test suite with no target is refused with suite_targets_required
    Given a test suite holds one scenario
    When I run the test suite with an empty target list
    Then the response is 422 with the code suite_targets_required
    And nothing is scheduled

  Scenario: Running a test suite that does not exist answers suite_not_found
    Given the project holds one agent
    When I run a test suite id the project does not hold
    Then the response is 404 with the code suite_not_found

  Scenario: A dated test suites path and the bare alias both answer
    Given the project holds one test suite
    When I list the test suites through the dated path 2026-08-27
    Then the list matches the one the bare alias returns

  Scenario: An unknown test suites version segment answers 404
    When I list the test suites through the version segment 2020-01-01
    Then the response is 404
