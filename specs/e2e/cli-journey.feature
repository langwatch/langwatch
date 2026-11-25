Feature: CLI journey

  Someone works a LangWatch project from a terminal with the built `langwatch`
  CLI. Every command is spawned with nothing but `LANGWATCH_API_KEY` and
  `LANGWATCH_ENDPOINT` for credentials — no config file, no device flow — in a
  working directory of its own, and each leg asserts the exit code, the shape
  of what the command printed, and the platform state it changed, read back
  through the SDK.

  The suite runs against a stack it resolves or boots (dev/tests/e2e-stack) on
  port 5610, sharing that stack with the SDK application journey.

  Plan: dev/docs/plans/e2e-platform-plan-2026-09-04.md
  Suite: sdks/typescript/__tests__/e2e/cli/

  Background:
    Given the CLI is built
    And a LangWatch stack and the seeded project's API key

  @e2e
  Scenario: A key in the environment is all a read command needs
    When I list datasets
    Then it exits zero and prints the project's datasets

  @e2e
  Scenario: Without a device session the CLI says I am not signed in
    When I ask who I am
    Then it exits non-zero and tells me how to sign in

  @e2e
  Scenario: A command with no credential says so instead of asking for one
    Given an environment carrying no LangWatch API key
    When I list datasets
    Then it exits non-zero and names the missing credential

  @e2e
  Scenario: A command against an endpoint nothing serves fails by name
    Given an endpoint that answers nothing
    When I list datasets
    Then it exits non-zero rather than hanging

  @e2e
  Scenario: Logging in with an API key writes it to the working directory
    Given an empty working directory
    When I run login with an API key
    Then it exits zero and says where it saved the key
    And a command in that directory then works with no key in its environment

  @e2e
  Scenario: A dataset is created from the terminal and read back
    When I create a dataset
    Then it exits zero and the platform lists that dataset
    When I add a record to it
    Then the platform holds that record
    When I delete the dataset
    Then the platform no longer lists it

  @e2e
  Scenario: An evaluator is created from the catalog and listed
    When I create an evaluator of a catalogued type
    Then it exits zero and listing evaluators names it

  @e2e
  Scenario: An evaluator type the catalog does not hold is refused locally
    When I create an evaluator of a type nothing defines
    Then it exits non-zero naming the offending option, before any request

  @e2e
  Scenario: A scenario is created from the terminal
    When I create a scenario with a situation
    Then it exits zero and the platform holds that scenario under that name

  @e2e
  Scenario: A test suite is created and run from the terminal
    Given a scenario filed in a new test suite
    When I run that test suite against an agent
    Then it exits zero and names the run it scheduled

  @e2e
  Scenario: Simulation runs are listed from the terminal
    When I list simulation runs
    Then it exits zero and prints the runs it found

  @e2e
  Scenario: Agents are listed and read from the terminal
    Given the project holds an agent
    When I list agents
    Then it exits zero and names that agent
    When I get that agent by its id
    Then it exits zero and prints the agent

  @e2e
  Scenario: A trace posted by the SDK is found and read from the terminal
    Given a trace the SDK posted
    When I search traces
    Then it exits zero and the search names that trace
    When I get that trace by its id
    Then it exits zero and prints the trace

  @e2e
  Scenario: A trace's transcript is read from the terminal
    Given a trace the SDK posted
    When I ask for that trace's transcript
    Then it exits zero and prints the transcript

  @e2e
  Scenario: The organization family answers from the terminal
    Given a key the platform accepts for the organization
    When I read the organization
    Then it answers by name — the organization, or the plan this deployment lacks

  @e2e
  Scenario: A command missing its required argument is refused before any request
    When I create a dataset without naming it
    Then it exits non-zero and says which argument is missing
