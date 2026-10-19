Feature: SDK application journey

  An application built only on the published `langwatch` surface — the client,
  `langwatch/observability/node` and `langwatch/agent` — drives a local
  LangWatch platform end to end, and reads every result back through the
  platform's own read side rather than through the request that made it.

  The suite runs against a stack it resolves or boots (dev/tests/e2e-stack) on
  port 5610, with the seeded project and its key, so each leg exercises the
  SDK, the API process, the worker and the NLP engine together.

  Plan: dev/docs/plans/e2e-platform-plan-2026-09-04.md
  Suite: sdks/typescript/__tests__/e2e/sdk-app/

  Background:
    Given a LangWatch stack and the seeded project's API key
    And an application configured with that key and that endpoint

  @e2e
  Scenario: An LLM span reaches the platform and is searchable
    Given observability is set up against the platform
    When the application records an LLM span with input, output, metrics and a customer id
    And it shuts observability down so the span is flushed
    Then the trace becomes readable within the ingest budget
    And the span carries the input, the output and the token counts the pipeline computed

  @e2e
  Scenario: A trace that never arrives fails the leg rather than hanging
    Given observability is set up against the platform
    When the application asks for a trace id nothing ever posted
    Then the read gives up inside its own timeout with a named failure

  @e2e
  Scenario: An evaluation recorded on a span is readable on the trace
    Given observability is set up against the platform
    When the application records an evaluation result on an LLM span
    Then the trace carries that evaluation under the name the application gave it

  @e2e
  Scenario: An evaluator created from code answers when it is called by slug
    Given the application has created a code evaluator through the client
    When it evaluates a piece of data against that evaluator's slug
    Then the result names a status and the evaluator's own verdict

  @e2e
  Scenario: Calling an evaluator slug that does not exist is refused by name
    When the application evaluates against a slug no evaluator holds
    Then the call fails with the platform's own error, not a generic one

  @e2e
  Scenario: A prompt is created, fetched under each policy, compiled and deleted
    When the application creates a prompt with a handle and one message
    Then it can fetch that prompt by handle
    And it can fetch it again while insisting on a fresh copy from the platform
    And compiling the prompt fills its variables
    And deleting the prompt removes it from the platform's list

  @e2e
  Scenario: Compiling a prompt with a missing variable is refused
    Given the application holds a prompt whose message names a variable
    When it compiles that prompt strictly without supplying the variable
    Then the compile is refused rather than emitting an empty value

  @e2e
  Scenario: A prompt version is tagged
    Given the application holds a prompt
    When it defines a tag and assigns it to the prompt's version
    Then the tag is listed among the organization's tags
    And the platform reports the assignment against that version

  @e2e
  Scenario: A prompt handle that does not exist is refused by name
    When the application fetches a prompt handle nothing holds
    Then the fetch fails with the platform's own not-found error

  @e2e
  Scenario: A dataset is created, filled, amended and deleted
    When the application creates a dataset with two columns
    And it adds two records to that dataset
    Then listing the dataset's records returns both
    When it amends one record
    Then the amended value is what the platform returns
    When it deletes the dataset
    Then the dataset is no longer listed

  @e2e
  Scenario: Adding a record whose columns do not match the dataset is refused
    Given the application holds a dataset with two columns
    When it adds a record naming a column the dataset does not have
    Then the platform refuses the record

  @e2e
  Scenario: An agent defined in code is reachable and answers a simulation run
    Given the application has connected an agent over the HTTP transport
    And a scenario and a test suite that target that agent
    When the application runs the test suite
    Then the simulation run reaches a terminal status within the run budget
    And the agent's own handler was invoked at least once

  @e2e
  Scenario: An experiment logs its results and reads them back
    When the application initialises an experiment and evaluates one row
    Then the experiment's run is listed with the result that was logged

  @e2e
  Scenario: The management families answer at their canonical addresses
    Given a key the platform accepts for the organization
    When the application reads the organization, the roles and the SCIM tokens
    Then each family answers at its /api/v1 address rather than 404

  @e2e
  Scenario: A workflow evaluates and returns its result
    Given the project holds a workflow
    When the application asks that workflow to evaluate a row
    Then the platform runs the evaluation and answers with its result
