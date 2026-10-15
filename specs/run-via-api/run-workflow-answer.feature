@unit
Feature: Running a workflow via the API answers with what the engine reports
  As an agent or script calling POST /api/workflows/:workflowId/run
  I want the trace id, cost, timing, node results and any error the engine reports
  So that I can find the run's trace and tell why a failed run failed

  Scenario: A finished run answers with its trace id, cost, timing and node results
    Given the engine finishes a run with a trace id, a total cost, a duration and node results
    When the agent calls POST /api/workflows/:workflowId/run
    Then the response carries the trace id, total cost, duration and node results

  Scenario: A failed run answers with the engine's error and the failing node
    Given the engine fails a run at one node with an error type and message
    When the agent calls POST /api/workflows/:workflowId/run
    Then the response has status "error"
    And the response carries the error type, message and node id
