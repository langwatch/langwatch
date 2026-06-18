# @unimplemented while this PR is in flight: the regression scenarios are
# bound (and the @unimplemented tag dropped) when the nlpgo cut lands. Go
# bindings target services/nlpgo/.
@unimplemented
Feature: The nlpgo engine no longer runs the evaluation loop
  As the platform consolidating onto one execution path
  I want the evaluation orchestration to live entirely in the TypeScript orchestrator
  So that the Go engine only runs single workflows or components and there is no duplicate loop.

  # Evaluations-v3 drives the loop in TypeScript and calls the engine per row.
  # The old server-side execute_evaluation loop is removed.

  @integration
  Scenario: The engine still runs a whole workflow once
    When the engine receives an execute_flow request
    Then it runs the workflow and returns the end-node outputs and node states

  @integration
  Scenario: The engine still runs a single component
    When the engine receives an execute_component request
    Then it runs that component and returns its state

  @integration
  Scenario: The engine no longer handles the evaluation loop
    When the engine receives an execute_evaluation request
    Then the request is not handled as an evaluation loop

  @integration
  Scenario: The batch results ingest endpoint remains available
    When a client posts batch evaluation results to the platform
    Then the results are accepted
    # The Python SDK batch path still posts here; only the Go engine's caller is removed.
