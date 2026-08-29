Feature: Run Plan CLI Commands
  As a developer using LangWatch from the terminal
  I want to run a configuration under a name and read the plans it made
  So that repeated runs of the same thing join one history

  A run plan is identified by its name. Running under a name already in use
  replaces that plan's configuration and joins its history; running under a new
  name creates the plan. A configuration is a scope, one or more targets, a
  repeat count, a simulator model and a judge model.

  A target is what to run against plus the parameter values that target alone
  runs with, written as a query string after its reference id. The same agent
  named twice with different values is two targets, which is how one agent is
  compared on two models.

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
    When I run "langwatch run-plan run --test-suite Refunds --target http:agent_abc"
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
    Then the run is scheduled with a scope of the named scenarios
    And the two scenario IDs travel with the configuration

  @unit
  Scenario: Run against more than one target
    When I run "langwatch run-plan run --all --target http:agent_abc --target prompt:prompt_xyz"
    Then the run is scheduled against both targets

  @unit
  Scenario: A target carries its own parameters after a question mark
    When I run "langwatch run-plan run --all --target 'http:agent_abc?model=gpt-5' --target 'http:agent_abc?model=gpt-5-mini'"
    Then the run is scheduled against two targets that name the same agent
    And each target carries the model value written after its question mark
    And the values are percent-decoded and read as the type they look like
    And a value given here wins over the same name given with --param

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
    Then I see an error that one of --all, --test-suite, --label or --scenario is needed
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
  Scenario: Run with a target whose question mark carries nothing
    When I run "langwatch run-plan run --all --target 'http:agent_abc?'"
    Then I see an error that the question mark carries no parameters
    And no run is scheduled

  @unit
  Scenario: Run with a target parameter that is not a pair
    When I run "langwatch run-plan run --all --target 'http:agent_abc?model'"
    Then I see an error that each target parameter reads as key=value
    And no run is scheduled

  @unit
  Scenario: Run with a target holding a second question mark
    When I run "langwatch run-plan run --all --target 'http:agent_abc?ask=what?'"
    Then I see an error that a question mark must be percent-encoded as %3F
    And no run is scheduled

  @unit
  Scenario: Run with a note over two hundred characters
    When I run "langwatch run-plan run --all --target http:agent_abc --note '<201 characters>'"
    Then I see an error that the note is too long
    And no run is scheduled

  @unit
  Scenario: The old --suite flag is still accepted
    When I run "langwatch run-plan run --help"
    Then "--test-suite" is listed
    And "--suite" is still read, and is not listed

  @unit
  Scenario: Run a test suite name that names nothing
    Given my project has no test suite named "Refunds"
    When I run "langwatch run-plan run --test-suite Refunds --target http:agent_abc"
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
  # run-plan run machine-readable output
  #
  # A machine caller reads stdout. Whichever way the run ends, it must find one
  # document there and nothing else. Human output stays as it is.
  # ==========================================================================

  @unit
  Scenario: Run with machine-readable output
    When I run "langwatch run-plan run --all --target http:agent_abc" asking for JSON output
    Then exactly one machine-readable document is printed on stdout
    And it carries the batch run ID, the job count and a scheduled outcome

  @unit
  Scenario: Wait with machine-readable output
    When I run "langwatch run-plan run --all --target http:agent_abc --wait" asking for JSON output
    Then the CLI polls until every run of the batch has stopped
    And exactly one final document carries the per-run results, the tallies and the outcome
    And the exit code is nonzero when any run failed

  @unit
  Scenario: A timed-out wait still emits the machine-readable document
    Given a run whose jobs never complete
    When the wait times out
    Then the final document names the timeout outcome
    And the exit code is nonzero

  @unit
  Scenario: A dead status endpoint still emits the machine-readable document
    Given a run whose status endpoint keeps failing
    When the wait gives up
    Then the final document names the poll failure outcome
    And the exit code is nonzero

  @unit
  Scenario: Waiting in human mode prints no machine document
    When I run "langwatch run-plan run --all --target http:agent_abc --wait" with the default output
    Then the progress and completion lines stay human-readable
    And no JSON document is printed

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
