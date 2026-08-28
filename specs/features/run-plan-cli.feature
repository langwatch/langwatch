Feature: Run Plan CLI Commands
  As a developer using LangWatch from the terminal
  I want to run a configuration under a name and read the plans it made
  So that repeated runs of the same thing join one history

  A run plan is identified by its name. Running under a name already in use
  replaces that plan's configuration and joins its history; running under a new
  name creates the plan. A configuration is a scope, one or more targets, a
  repeat count, a simulator model and a judge model.

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  # ==========================================================================
  # run-plan run
  # ==========================================================================

  @unit
  Scenario: Run every active scenario against a target
    Given my project has active scenarios
    When I run "langwatch run-plan run --all --target http:agent_abc"
    Then the run is scheduled with a scope of all scenarios
    And I see the plan name, the job count and the batch run ID

  @unit
  Scenario: Run the scenarios filed in a test suite
    Given my project has a test suite "Refunds"
    When I run "langwatch run-plan run --suite Refunds --target http:agent_abc"
    Then the test suite name is resolved to its ID
    And the run is scheduled with a scope of that test suite

  @unit
  Scenario: Run the scenarios carrying a label
    Given my project has scenarios labelled "checkout"
    When I run "langwatch run-plan run --label checkout --label refunds --target http:agent_abc"
    Then the run is scheduled with a scope of both labels

  @unit
  Scenario: Run named scenarios
    Given my project has scenarios "scenario_1" and "scenario_2"
    When I run "langwatch run-plan run --scenario scenario_1 --scenario scenario_2 --target http:agent_abc"
    Then the run is scheduled with a scope of the named cases
    And the two scenario IDs travel with the configuration

  @unit
  Scenario: Run against more than one target
    When I run "langwatch run-plan run --all --target http:agent_abc --target prompt:prompt_xyz"
    Then the run is scheduled against both targets

  @unit
  Scenario: Run under a name that names an existing plan
    Given my project has a run plan named "Nightly regression"
    When I run "langwatch run-plan run --all --target http:agent_abc --name 'Nightly regression'"
    Then that plan keeps its identity and takes this configuration
    And the run joins its history

  @unit
  Scenario: Run without a name
    When I run "langwatch run-plan run --all --target http:agent_abc"
    Then no name is sent
    And the platform derives the plan name from what the run covers and what it runs against

  @unit
  Scenario: Run with a repeat count and models
    When I run "langwatch run-plan run --all --target http:agent_abc --repeat 3 --simulator-model openai/gpt-5-mini --judge-model openai/gpt-5-mini"
    Then the configuration carries the repeat count and both models

  @unit
  Scenario: Run with parameters
    When I run "langwatch run-plan run --all --target http:agent_abc --param account_tier=gold --param seats=12"
    Then the run carries both parameter values
    And a plain number is read as a number

  @unit
  Scenario: Run with a note
    When I run "langwatch run-plan run --all --target http:agent_abc --note 'after the timeout fix'"
    Then the run is scheduled with that note

  @unit
  Scenario: Run with an idempotency key
    When I run "langwatch run-plan run --all --target http:agent_abc --idempotency-key nightly-2026-08-28"
    Then that key travels with the request

  # ==========================================================================
  # run-plan run refusals
  # ==========================================================================

  @unit
  Scenario: Run with two scope flags
    When I run "langwatch run-plan run --all --label checkout --target http:agent_abc"
    Then I see an error that a run covers one rule
    And no run is scheduled

  @unit
  Scenario: Run with no scope flag
    When I run "langwatch run-plan run --target http:agent_abc"
    Then I see an error that one of --all, --suite, --label or --scenario is needed
    And no run is scheduled

  @unit
  Scenario: Run with no target
    When I run "langwatch run-plan run --all"
    Then I see an error that at least one --target is needed
    And no run is scheduled

  @unit
  Scenario: Run with a malformed target
    When I run "langwatch run-plan run --all --target agent_abc"
    Then I see an error that a target reads as type:referenceId
    And no run is scheduled

  @unit
  Scenario: Run with a note over two hundred characters
    When I run "langwatch run-plan run --all --target http:agent_abc --note '<201 characters>'"
    Then I see an error that the note is too long
    And no run is scheduled

  @unit
  Scenario: Run a suite name that names nothing
    Given my project has no test suite named "Refunds"
    When I run "langwatch run-plan run --suite Refunds --target http:agent_abc"
    Then I see an error that the test suite was not found
    And no run is scheduled

  # ==========================================================================
  # run-plan run --wait
  # ==========================================================================

  @unit
  Scenario: Wait for a run to complete
    When I run "langwatch run-plan run --all --target http:agent_abc --wait"
    Then the CLI polls until every run of the batch has stopped
    And I see the pass and fail counts

  @unit
  Scenario: Wait for a run that failed
    Given a run of the batch ends with a failed verdict
    When I run "langwatch run-plan run --all --target http:agent_abc --wait"
    Then the command exits with code 1

  @unit
  Scenario: Wait for a run that scheduled no job
    Given every scenario the scope covers is archived
    When I run "langwatch run-plan run --all --target http:agent_abc --wait"
    Then the CLI does not poll
    And I see that nothing was scheduled

  # ==========================================================================
  # run-plan list, get, archive
  # ==========================================================================

  @unit
  Scenario: List run plans
    Given my project has run plans
    When I run "langwatch run-plan list"
    Then I see a table with the name, ID, scope, target count and repeat count of each plan
    And archived plans are left out

  @unit
  Scenario: List run plans when none exist
    Given my project has no run plans
    When I run "langwatch run-plan list"
    Then I see a message that no run plans were found

  @unit
  Scenario: List archived run plans as well
    Given my project has an archived run plan
    When I run "langwatch run-plan list --archived"
    Then the archived plan is listed

  @unit
  Scenario: Get one run plan
    Given my project has a run plan "Nightly regression"
    When I run "langwatch run-plan get <plan-id>"
    Then I see its name, scope, targets, repeat count and models

  @unit
  Scenario: Get a run plan that does not exist
    When I run "langwatch run-plan get nonexistent-id"
    Then I see an error that the run plan was not found

  @unit
  Scenario: Archive a run plan
    Given my project has a run plan "Nightly regression"
    When I run "langwatch run-plan archive <plan-id>"
    Then the plan is archived and I see confirmation

  # ==========================================================================
  # Surface
  # ==========================================================================

  @unit
  Scenario: Every run plan request declares the command line as its surface
    When I run any "langwatch run-plan" command
    Then the request carries the header "X-LangWatch-Surface: cli"
