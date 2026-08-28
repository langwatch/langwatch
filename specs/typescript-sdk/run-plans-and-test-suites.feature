Feature: Run plans and test suites on the TypeScript SDK
  As a developer using the LangWatch TypeScript SDK
  I want typed services for run plans and test suites
  So that I can start runs and keep suites from my own code

  The two families are separate: a test suite is a folder of scenarios, a run
  plan is a named configuration that runs them. `client.suites` stays for the
  frozen `/api/suites` alias and is marked deprecated.

  Background:
    Given a LangWatch client built with an API key

  # ==========================================================================
  # The client surface
  # ==========================================================================

  @unit
  Scenario: The client exposes both services
    When I read the client
    Then "runPlans" is a RunPlansApiService
    And "testSuites" is a TestSuitesApiService
    And "suites" still answers, marked deprecated

  # ==========================================================================
  # RunPlansApiService
  # ==========================================================================

  @unit
  Scenario: List run plans
    When I call runPlans.list()
    Then the SDK reads GET /api/v1/run-plans
    And archived plans are left out

  @unit
  Scenario: List run plans including archived
    When I call runPlans.list({ includeArchived: true })
    Then the query carries includeArchived=true

  @unit
  Scenario: Read one run plan
    When I call runPlans.get("plan_abc")
    Then the SDK reads GET /api/v1/run-plans/plan_abc

  @unit
  Scenario: Run a configuration
    When I call runPlans.run with a scope, targets and a name
    Then the SDK posts the configuration to /api/v1/run-plans/run
    And the answer carries the run plan ID, the plan name and whether it was created

  @unit
  Scenario: Run a configuration with a note of only spaces
    When I call runPlans.run with a note of only spaces
    Then no note is sent

  @unit
  Scenario: Run a plan again with the configuration it already holds
    When I call runPlans.rerun("plan_abc", { note: "nightly" })
    Then the SDK posts to /api/v1/run-plans/plan_abc/run
    And no configuration is sent

  @unit
  Scenario: Archive a run plan
    When I call runPlans.archive("plan_abc")
    Then the SDK sends DELETE /api/v1/run-plans/plan_abc

  # ==========================================================================
  # TestSuitesApiService
  # ==========================================================================

  @unit
  Scenario: List test suites
    When I call testSuites.list()
    Then the SDK reads GET /api/v1/test-suites

  @unit
  Scenario: Create a test suite
    When I call testSuites.create({ name: "Refunds" })
    Then the SDK posts the name to /api/v1/test-suites

  @unit
  Scenario: Read one test suite
    When I call testSuites.get("suite_abc")
    Then the SDK reads GET /api/v1/test-suites/suite_abc
    And the answer names the scenarios filed in it

  @unit
  Scenario: Rename a test suite
    When I call testSuites.rename("suite_abc", { name: "Refunds and credits" })
    Then the SDK sends PATCH /api/v1/test-suites/suite_abc

  @unit
  Scenario: Archive a test suite
    When I call testSuites.archive("suite_abc")
    Then the SDK sends DELETE /api/v1/test-suites/suite_abc

  @unit
  Scenario: Run a test suite
    When I call testSuites.run("suite_abc", { targets: [{ type: "http", referenceId: "agent_abc" }] })
    Then the SDK posts the targets to /api/v1/test-suites/suite_abc/run

  # ==========================================================================
  # Failures
  # ==========================================================================

  @unit
  Scenario: The platform names the failure in the flat envelope
    Given the platform answers 404 with a code at the top level of the body
    When a run plan call fails
    Then the SDK raises the typed handled error with that code and status

  @unit
  Scenario: The platform names the failure in the nested envelope
    Given the platform answers 401 with the failure nested under "error"
    When a test suite call fails
    Then the SDK raises the typed handled error with that code and status

  @unit
  Scenario: The failure body is not the platform's shape
    Given a proxy answers 502 with an HTML page
    When a run plan call fails
    Then the SDK throws its own error class with the status attached
