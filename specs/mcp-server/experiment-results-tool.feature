@integration
Feature: MCP Experiment Results Tool
  As a coding agent debugging an evaluation
  I want to fetch per-row experiment-run results via the MCP server
  So that I can inspect evaluator scores and diagnose failed rows from Claude Code

  Background:
    Given the MCP server is configured with a valid API key
    And the LangWatch project has at least one completed evaluation run

  @unimplemented
  Scenario: Agent fetches results for a completed run
    When the agent calls platform_evaluation_results with the run id of a completed run
    Then the response includes per-row entries with their evaluator scores
    And the response notes the total number of rows in the run
    And the response is capped to protect the agent's context window

  @unimplemented
  Scenario: Agent filters to only the failed rows
    Given a completed run with both passing and failing rows
    When the agent calls platform_evaluation_results with filter "failed"
    Then the response includes only rows that errored or failed an evaluation
    And passing rows are omitted from the response

  @unimplemented
  Scenario: Agent narrows the response to a single evaluator
    Given a completed run with multiple evaluators
    When the agent calls platform_evaluation_results with an evaluator name
    Then the response includes only evaluations from that evaluator
    And other evaluators are omitted from the response

  @unimplemented
  Scenario: Agent requests a run that is still running
    Given a run that has not finished yet
    When the agent calls platform_evaluation_results with that run id
    Then the response explains that results are not yet available
    And the response suggests polling platform_evaluation_status

  @unimplemented
  Scenario: Agent requests a missing run
    Given no run exists for the given id
    When the agent calls platform_evaluation_results with that run id
    Then the response surfaces a clear "not found" message
    And the response does not crash the MCP server
