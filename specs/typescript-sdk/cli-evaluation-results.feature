Feature: CLI evaluation results command
  As an engineer or coding agent debugging an evaluation
  I want to fetch per-row results for a completed run from the CLI
  So that I can inspect evaluator scores and missed rows without leaving my terminal

  Background:
    Given I have a valid API key configured
    And the LangWatch API is reachable

  @integration @unimplemented
  Scenario: User views the results of a completed run as a table
    Given a completed evaluation run with several rows
    When I run `langwatch evaluation results <runId>`
    Then the CLI prints a table with one row per dataset entry
    And each row shows the row index and the key evaluator scores
    And the table is truncated to the default row limit
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: User filters the table to only failed rows
    Given a completed run with both passing and failing rows
    When I run `langwatch evaluation results <runId> --filter failed`
    Then the CLI prints only rows that errored or failed an evaluation
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: User narrows the table to a specific evaluator
    Given a completed run with multiple evaluators
    When I run `langwatch evaluation results <runId> --evaluator quality`
    Then the table only displays the "quality" evaluator's column
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: User pipes the full payload as JSON
    When I run `langwatch evaluation results <runId> --format json`
    Then the CLI writes the full results payload as JSON to stdout
    And the JSON output is valid and parseable
    And the CLI exits with status 0

  @integration @unimplemented
  Scenario: User requests a run that is still running
    Given an evaluation run that has not finished yet
    When I run `langwatch evaluation results <runId>`
    Then the CLI prints a clear message that results are not yet available
    And the CLI suggests checking status first
    And the CLI exits with status 1

  @integration @unimplemented
  Scenario: User requests a missing run
    Given no run exists for the given id
    When I run `langwatch evaluation results <runId>`
    Then the CLI prints a clear "not found" error
    And the CLI exits with status 1
