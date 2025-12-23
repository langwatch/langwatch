@unit
Feature: Evaluation execution
  As a user running an evaluation
  I want to execute agents and evaluators on my dataset
  So that I can see results inline in the spreadsheet

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And the dataset has 3 rows with test data
    And an agent "GPT-4o" is configured and mapped
    And agent "GPT-4o" has evaluator "Exact Match" configured and mapped

  Scenario: Run evaluation button is enabled when ready
    Then the "Evaluate" button is enabled

  Scenario: Run evaluation button is disabled when not ready
    Given an agent has unmapped required inputs
    Then the "Evaluate" button is disabled
    And a tooltip explains what needs to be configured

  Scenario: Execute evaluation shows loading skeletons
    When I click the "Evaluate" button
    Then the "Evaluate" button changes to a "Stop" button
    And all agent output cells show loading skeleton bars
    And the evaluator chips inside agent cells show loading state

  Scenario: Results stream in as they complete
    Given an evaluation is running
    When the first row completes processing
    Then the skeleton in row 0 agent cell is replaced with the actual output
    And the evaluator chips in row 0 update with their results
    And the other rows still show loading skeletons

  Scenario: Evaluator chips show pass status
    When I run the evaluation
    And row 0 passes the "Exact Match" evaluator
    Then the "Exact Match" chip in row 0 shows a success indicator (green checkmark)

  Scenario: Evaluator chips show fail status
    When I run the evaluation
    And row 0 fails the "Exact Match" evaluator
    Then the "Exact Match" chip in row 0 shows a failure indicator (red X)

  Scenario: Expand evaluator chip to see details
    When I run the evaluation
    And results are displayed
    And I click on the "Exact Match" evaluator chip in row 0
    Then the chip expands to show full result details
    And I see the score, reasoning, or other evaluator-specific output

  Scenario: Show error in cell when execution fails
    When I run the evaluation
    And row 0 encounters an error
    Then the agent output cell for row 0 shows an error state
    And I can click to see the error details

  Scenario: Stop running evaluation
    When I click the "Evaluate" button
    And the evaluation is in progress
    And I click the "Stop" button
    Then the evaluation stops
    And completed results are preserved

  Scenario: Edit dataset while viewing results
    When I run the evaluation
    And results are displayed
    And I double-click a dataset cell
    Then I can edit the cell value
    And the corresponding agent cell shows as stale or clears

  Scenario: Run evaluation on selected rows only
    Given rows 0 and 2 are selected via checkboxes
    When I click the "Run" button in the selection toolbar
    Then only rows 0 and 2 show loading skeletons
    And row 1 remains unchanged

  Scenario: Multiple agents with different evaluators
    Given agents "GPT-4o" and "Claude Opus" are configured
    And agent "GPT-4o" uses evaluator "Exact Match"
    And agent "Claude Opus" uses evaluator "LLM as Judge"
    When I run the evaluation
    Then "GPT-4o" cells show "Exact Match" chip results
    And "Claude Opus" cells show "LLM as Judge" chip results

  Scenario: Same global evaluator on multiple agents
    Given agents "GPT-4o" and "Claude Opus" are configured
    And a global evaluator "Exact Match" exists
    And both agents reference evaluator "Exact Match"
    When I run the evaluation
    Then each agent cell shows its own "Exact Match" result
    And results are keyed by "{agentId}.{evaluatorId}" in the DSL execution
    And I can compare pass rates between agents

  Scenario: Results mapped back using DSL node naming
    Given agents "GPT-4o" and "Claude Opus" are configured
    And both agents reference evaluator "Exact Match"
    When the evaluation runs
    Then DSL creates nodes "GPT-4o.Exact Match" and "Claude Opus.Exact Match"
    And results for "GPT-4o.Exact Match" appear in GPT-4o's cell
    And results for "Claude Opus.Exact Match" appear in Claude Opus's cell
