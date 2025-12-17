@unit
Feature: Evaluator configuration
  As a user configuring an evaluation
  I want to add and configure evaluators
  So that I can assess the quality of agent outputs

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And an agent "GPT-4o" is configured

  Scenario: Add evaluator
    When I click the "Add Evaluator" button
    And I select category "Expected Answer"
    And I select evaluator "Exact Match"
    Then a new evaluator column appears in the table
    And the evaluator header shows the evaluator name

  Scenario: Add multiple evaluators
    Given an evaluator "Exact Match" is configured
    When I click the "Add Evaluator" button
    And I configure evaluator "LLM as Judge"
    Then 2 evaluator columns are visible in the table

  Scenario: Configure evaluator settings
    When I click the "Add Evaluator" button
    And I select evaluator "LLM as Judge"
    Then the evaluator settings form is displayed
    And I can configure the judge model and criteria

  Scenario: Map evaluator inputs from dataset
    Given an evaluator "Exact Match" is configured
    And it requires inputs "output" and "expected_output"
    When I open the evaluator configuration overlay
    Then I can map "expected_output" to dataset column "expected_output"

  Scenario: Map evaluator inputs from agent outputs
    Given an evaluator "Exact Match" is configured
    And it requires input "output"
    When I open the evaluator configuration overlay
    Then I can map "output" to agent "GPT-4o" output "response"

  Scenario: Evaluator with unmapped required inputs shows warning
    Given an evaluator "Exact Match" is configured
    And required input "output" is not mapped
    Then the evaluator column header shows a warning indicator

  Scenario: Evaluator mapping with multiple agents
    Given agents "GPT-4o" and "Claude Opus" are configured
    And an evaluator "Exact Match" is configured
    When I open the evaluator configuration overlay
    Then I see mapping options for both agents
    And I can map the same evaluator to run against both agent outputs
