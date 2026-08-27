Feature: Python SDK run plans and test suites
  As a Python SDK user who runs agent tests
  I want a facade for run plans and a facade for test suites
  So that I can start a run under a name and keep my scenarios grouped in folders

  Background: two nouns, one run.
    A TEST SUITE is a folder of scenarios: a name and the cases filed under it.
    A RUN PLAN is what you run, and its name is its identity: running under the
    name of an existing plan replaces that plan's configuration, running under a
    new name creates one. The configuration is the scope, the targets, the
    repeat count, the simulator model and the judge model. A run also carries
    parameters, a note and an idempotency key, none of which belong to the plan.

    Running a test suite is sugar over the same call: the caller sends targets,
    and the server derives the plan name from the suite name and the target name
    when the caller sends none.

    The SDK sends the bytes and reads the answer. It resolves the scope object
    locally, because a scope mode whose list is missing is a mistake the caller
    can fix without a round trip. Everything else is the platform's to refuse.

  # --- Run plans: starting a run ---

  @unit
  Scenario: Running under a name sends the name and the configuration together
    Given a run plan facade on a mounted transport
    When the caller runs a plan named "Nightly" against one target
    Then the request is a POST to /api/v1/run-plans/run
    And the body carries the name and the configuration the caller built

  @unit
  Scenario: A run with no name lets the server name the plan
    Given a run plan facade on a mounted transport
    When the caller runs without a name
    Then the body carries no name field

  @unit
  Scenario: The default scope covers every scenario of the project
    Given a run plan facade on a mounted transport
    When the caller runs without naming a scope
    Then the configuration carries the scope mode "all"

  @unit
  Scenario: A folder scope carries the folder ids the caller named
    Given a run plan facade on a mounted transport
    When the caller runs the scope "folders" with two folder ids
    Then the configuration carries those folder ids under the "folders" mode

  @unit
  Scenario: A label scope carries the labels the caller named
    Given a run plan facade on a mounted transport
    When the caller runs the scope "labels" with two labels
    Then the configuration carries those labels under the "labels" mode

  @unit
  Scenario: A hand-picked scope carries the case ids as the configuration's scenario ids
    Given a run plan facade on a mounted transport
    When the caller runs the scope "cases" with two scenario ids
    Then the configuration carries the "cases" mode and those scenario ids

  @unit
  Scenario: The run inputs the caller left out are absent from the body
    Given a run plan facade on a mounted transport
    When the caller runs with no repeat count, models, parameters, note or idempotency key
    Then the body carries only the configuration's scope and targets

  @unit
  Scenario: The run inputs the caller gave ride beside the configuration
    Given a run plan facade on a mounted transport
    When the caller runs with parameters, a note and an idempotency key
    Then those three fields sit at the top of the body, outside the configuration

  # --- Run plans: local refusals ---

  @unit
  Scenario: A folder scope with no folder ids is refused before the request
    Given a run plan facade on a mounted transport
    When the caller runs the scope "folders" without folder ids
    Then the SDK raises a ValueError naming folder_ids
    And no request is sent

  @unit
  Scenario: A label scope with no labels is refused before the request
    Given a run plan facade on a mounted transport
    When the caller runs the scope "labels" without labels
    Then the SDK raises a ValueError naming labels
    And no request is sent

  @unit
  Scenario: A hand-picked scope with no case ids is refused before the request
    Given a run plan facade on a mounted transport
    When the caller runs the scope "cases" without scenario ids
    Then the SDK raises a ValueError naming scenario_ids
    And no request is sent

  @unit
  Scenario: A scope mode the platform does not have is refused before the request
    Given a run plan facade on a mounted transport
    When the caller runs the scope "everything"
    Then the SDK raises a ValueError listing the four modes
    And no request is sent

  # --- Run plans: the rest of the surface ---

  @unit
  Scenario: Re-running a plan sends the run inputs and nothing else
    Given a run plan facade on a mounted transport
    When the caller re-runs the plan "run_plan_1" with a note
    Then the request is a POST to /api/v1/run-plans/run_plan_1/run
    And the body carries the note alone

  @unit
  Scenario: Listing run plans leaves the archived ones out by default
    Given a run plan facade on a mounted transport
    When the caller lists run plans
    Then the request carries includeArchived=false

  @unit
  Scenario: Listing run plans can ask for the archived ones as well
    Given a run plan facade on a mounted transport
    When the caller lists run plans including archived
    Then the request carries includeArchived=true

  @unit
  Scenario: Reading one run plan by id
    Given a run plan facade on a mounted transport
    When the caller reads the plan "run_plan_1"
    Then the request is a GET to /api/v1/run-plans/run_plan_1
    And the answer is the plan the platform served

  @unit
  Scenario: Archiving a run plan
    Given a run plan facade on a mounted transport
    When the caller archives the plan "run_plan_1"
    Then the request is a DELETE to /api/v1/run-plans/run_plan_1
    And the answer reports the plan archived

  @unit
  Scenario: An id with a slash stays one path segment
    Given a run plan facade on a mounted transport
    When the caller reads a plan whose id carries a slash
    Then the slash is percent-encoded in the path

  # --- Test suites ---

  @unit
  Scenario: Listing test suites
    Given a test suite facade on a mounted transport
    When the caller lists test suites
    Then the request is a GET to /api/v1/test-suites

  @unit
  Scenario: Creating a test suite sends the name alone
    Given a test suite facade on a mounted transport
    When the caller creates the test suite "Refunds"
    Then the request is a POST to /api/v1/test-suites carrying only the name
    And the answer is the created test suite

  @unit
  Scenario: Reading a test suite returns the scenarios filed under it
    Given a test suite facade on a mounted transport
    When the caller reads the test suite "suite_1"
    Then the request is a GET to /api/v1/test-suites/suite_1
    And the answer carries the suite's scenarios

  @unit
  Scenario: Renaming a test suite
    Given a test suite facade on a mounted transport
    When the caller renames "suite_1" to "Refunds and chargebacks"
    Then the request is a PATCH to /api/v1/test-suites/suite_1 carrying the new name

  @unit
  Scenario: Archiving a test suite
    Given a test suite facade on a mounted transport
    When the caller archives the test suite "suite_1"
    Then the request is a DELETE to /api/v1/test-suites/suite_1
    And the answer reports the suite archived

  @unit
  Scenario: Running a test suite sends the targets and lets the server name the plan
    Given a test suite facade on a mounted transport
    When the caller runs the test suite "suite_1" against one target
    Then the request is a POST to /api/v1/test-suites/suite_1/run
    And the body carries the targets and no name

  @unit
  Scenario: Running a test suite under a name of the caller's choosing
    Given a test suite facade on a mounted transport
    When the caller runs the test suite "suite_1" under the name "Nightly refunds"
    And gives a repeat count, both models, parameters, a note and an idempotency key
    Then every one of those fields rides in the body beside the targets

  # --- Failures and the deprecated facade ---

  @unit
  Scenario: A refused call raises the typed error for its status
    Given a run plan facade whose transport refuses with a 404
    When the caller reads a plan that is not there
    Then the SDK raises the not-found error carrying the platform's code

  @unit
  Scenario: A refusal in the legacy envelope still reaches the caller as a detail
    Given a test suite facade whose transport refuses with the legacy error body
    When the caller reads a suite that is not there
    Then the message carries the detail the legacy body held

  @unit
  Scenario: The suites facade tells its callers it is deprecated
    Given the deprecated suites facade
    When it is built
    Then a DeprecationWarning names run_plans and test_suites as the replacement

  @unit
  Scenario: Both new facades are reachable from the SDK entry point
    Given the langwatch package
    When the names run_plans and test_suites are read
    Then each resolves to its facade and is listed in __all__

  @unit
  Scenario: The run_plans facade stays reachable after test_suites is used
    Given the langwatch package
    When test_suites is read before run_plans
    Then run_plans still resolves to its facade and not to its module
