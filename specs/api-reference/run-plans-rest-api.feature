@integration
Feature: The run plans REST API
  As a developer starting agent tests over HTTP
  I want a run plan family that runs a configuration under a name
  So that a run from the command line and a run from the platform land on one plan

  # A RUN PLAN is what you run. It is identified by its NAME: a run started
  # under a name joins the plan of that name and replaces its configuration, or
  # creates the plan when nothing answers.
  #
  #   GET    /api/v1/run-plans           list the project's run plans
  #   GET    /api/v1/run-plans/{id}      read one run plan
  #   POST   /api/v1/run-plans/run       run a configuration under a name
  #   POST   /api/v1/run-plans/{id}/run  run a stored plan again
  #   DELETE /api/v1/run-plans/{id}      archive a run plan
  #
  # The family authenticates with a project API key and publishes its routes
  # under the dated version 2026-08-27, the bare alias, and latest.

  Scenario: Listing run plans leaves out archived plans
    Given the project holds one active run plan and one archived run plan
    When I list the run plans
    Then only the active run plan is returned

  Scenario: Listing run plans includes archived plans when asked
    Given the project holds one active run plan and one archived run plan
    When I list the run plans with includeArchived set
    Then both run plans are returned

  Scenario: Listing run plans leaves out test suites
    Given the project holds one run plan and one test suite
    When I list the run plans
    Then only the run plan is returned

  Scenario: Reading a run plan that does not exist answers suite_not_found
    When I read a run plan by an id the project does not hold
    Then the response is 404 with the code suite_not_found

  Scenario: Reading a test suite through the run plan route answers suite_not_found
    Given the project holds a test suite
    When I read that test suite id through the run plans route
    Then the response is 404 with the code suite_not_found

  Scenario: Running a configuration creates the run plan its name resolves
    Given the project holds one scenario and one agent
    When I run a configuration under the name "Nightly"
    Then a run plan named "Nightly" is created
    And the response reports the plan as created
    And the response carries a platform URL for the plan

  Scenario: Running the same name twice joins the run plan already there
    Given the project holds one scenario and one agent
    And a run has already been started under the name "Nightly"
    When I run a configuration under the name "Nightly"
    Then the response reports the plan as not created
    And the plan id is the one the first run resolved

  Scenario: A run started with a key that names no person records no actor
    Given the project holds one scenario and one agent
    When I run a configuration with a project API key
    Then the queued run records no actor

  Scenario: A run started with a key that names a person records the api actor
    Given the project holds one scenario and one agent
    When I run a configuration with a user API key
    Then the queued run records the actor label "api"

  Scenario: A run started from the command line records the cli actor
    Given the project holds one scenario and one agent
    When I run a configuration with a user API key and the cli surface header
    Then the queued run records the actor label "cli"

  Scenario: Running a configuration with no target is refused with suite_targets_required
    Given the project holds one scenario
    When I run a configuration that names no target
    Then the response is 422 with the code suite_targets_required
    And nothing is scheduled

  Scenario: Running a stored run plan again runs the configuration it holds
    Given the project holds a run plan over one scenario and one agent
    When I run that run plan by its id
    Then the runs are scheduled
    And the response reports the plan as not created

  Scenario: Running a stored run plan that does not exist answers suite_not_found
    When I run a run plan id the project does not hold
    Then the response is 404 with the code suite_not_found

  Scenario: Archiving a run plan hides it from the list
    Given the project holds one run plan
    When I archive the run plan
    Then the response reports the plan as archived
    And the run plan is no longer listed

  Scenario: A dated run plans path and the bare alias both answer
    Given the project holds one run plan
    When I list the run plans through the dated path 2026-08-27
    Then the list matches the one the bare alias returns

  Scenario: An unknown run plans version segment answers 404
    When I list the run plans through the version segment 2020-01-01
    Then the response is 404
