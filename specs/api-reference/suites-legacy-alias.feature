@integration
Feature: The suites REST family is a deprecated alias
  As an integrator already calling /api/suites
  I want the family to keep working and to tell me where it moved
  So that I can move to run plans and test suites on my own schedule

  # /api/suites predates the split between a RUN PLAN (what you run) and a
  # TEST SUITE (a folder of scenarios). It keeps answering exactly as it did.
  # Every response names its successor, and every operation is marked
  # deprecated in the published document.

  Scenario: Every suites response carries the deprecation headers
    Given the project holds one run plan
    When I call any endpoint of the suites family
    Then the response carries the header Deprecation set to true
    And the response carries a successor-version link to /api/v1/run-plans

  Scenario: A refused suites request still carries the deprecation headers
    When I read a suite id the project does not hold
    Then the response is 404
    And the response carries the header Deprecation set to true

  Scenario: The suites operations are marked deprecated in the document
    When I read the generated OpenAPI document
    Then every /api/suites operation is marked deprecated
    And every /api/suites description names the run plans and test suites families

  Scenario: Running a test suite through the alias takes its targets from the body
    Given the project holds a test suite with one scenario and one agent
    When I run the test suite through the alias with that target in the body
    Then the runs are scheduled
    And a run plan named after the suite and the target is created

  Scenario: Running a test suite through the alias with no target answers suite_targets_required
    Given the project holds a test suite with one scenario
    When I run the test suite through the alias with no target
    Then the response is 400 with the code suite_targets_required

  # A run plan holds its own configuration, and a test suite holds no
  # execution setting at all, so both refusals are a malformed request rather
  # than a domain refusal: they answer 422 validation_error, the shape this
  # family has always used for one.
  Scenario: Running a run plan through the alias with targets answers validation_error
    Given the project holds one run plan
    When I run the run plan through the alias with a target in the body
    Then the response is 422 with the code validation_error

  Scenario: Updating a test suite through the alias with targets answers validation_error
    Given the project holds one test suite
    When I update the test suite through the alias with a target in the body
    Then the response is 422 with the code validation_error
