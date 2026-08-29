@unit
Feature: MCP Run Plan Tools
  As a coding agent
  I want to run scenarios against targets through the MCP server
  So that I can start a simulation batch and read back what it started

  # A run plan is what you run, and its NAME identifies it. Running a name
  # that already exists replaces that plan's configuration; running a new name
  # creates the plan. Configuration is the scope, the targets, the repeat
  # count and the two models. Parameters, the note and the idempotency key
  # belong to one run, not to the plan.
  #
  # A target is what to run against plus the parameters that target alone runs
  # with. Two targets may name the same agent with different parameters, which
  # is how one run compares one agent on two models.

  Background:
    Given the MCP server is configured with a valid API key

  Scenario: Agent runs a name that no plan carries yet
    When the agent calls platform_run_plan with a name no plan carries
    Then the response says the run plan was created and started

  Scenario: Agent runs a name an existing plan carries
    Given a run plan exists with the name the agent sends
    When the agent calls platform_run_plan with that name
    Then the response says the plan ran with the configuration of this run

  Scenario: Agent compares one agent on two models in one run
    When the agent calls platform_run_plan with two targets that name the same agent and different parameters
    Then the request carries both targets, each with its own parameters
    And the parameters of a target override the parameters of the run

  Scenario: Agent reads the batch a run started
    When the agent calls platform_run_plan
    Then the response includes the plan name, the batch run id and the job count
    And the response includes the platform URL of the batch

  Scenario: A run reports what it skipped as archived
    Given the plan names a scenario and a target that are archived
    When the agent calls platform_run_plan
    Then the response lists the skipped scenarios and the skipped targets

  Scenario: Agent lists the run plans of a project
    Given the project has run plans
    When the agent calls platform_list_run_plans
    Then the response contains a list of run plans with what each one covers

  Scenario: Agent lists run plans when none exist
    Given the project has no run plans
    When the agent calls platform_list_run_plans
    Then the response contains a message "No run plans found"
    And the response includes a tip to use platform_run_plan

  Scenario: Agent reads the full configuration of a run plan
    Given a run plan exists with id "plan_abc123"
    When the agent calls platform_get_run_plan with id "plan_abc123"
    Then the response includes the scope, the targets, the repeat count and the models

  Scenario: Agent reads a plan that runs the scenarios of a test suite
    Given a run plan whose scope names test suites
    When the agent calls platform_get_run_plan
    Then the response says the plan covers the scenarios of those test suites

  Scenario: Agent reads a plan that names its own models
    Given a run plan with no simulator model and no judge model
    When the agent calls platform_get_run_plan
    Then the response says both models are the project default

  Scenario: Agent runs a plan again with the configuration it holds
    Given a run plan exists with id "plan_abc123"
    When the agent calls platform_rerun_run_plan with id "plan_abc123" and a note
    Then the response says the plan ran with the configuration of this run
    And the response includes the batch run id

  Scenario: Agent archives a run plan
    Given a run plan exists with id "plan_abc123"
    When the agent calls platform_archive_run_plan with id "plan_abc123"
    Then the response confirms the plan is archived
    And the response says the past runs stay readable
