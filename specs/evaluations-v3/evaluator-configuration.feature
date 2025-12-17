@unit
Feature: Evaluator configuration
  As a user configuring an evaluation
  I want to add and configure evaluators per agent
  So that I can assess the quality of each agent's outputs

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And an agent "GPT-4o" is configured

  Scenario: Add evaluator to agent
    When I click "+ Add evaluator" inside the "GPT-4o" agent cell
    And I select category "Expected Answer"
    And I select evaluator "Exact Match"
    Then the evaluator chip appears inside the agent cell
    And the chip shows the evaluator name "Exact Match"

  Scenario: Add multiple evaluators to same agent
    Given agent "GPT-4o" has evaluator "Exact Match"
    When I click "+ Add evaluator" inside the "GPT-4o" agent cell
    And I select evaluator "LLM as Judge"
    Then 2 evaluator chips are visible in the "GPT-4o" agent cell

  Scenario: Evaluator chips show compact status
    Given agent "GPT-4o" has evaluator "Exact Match"
    And the evaluation has been run
    Then the evaluator chip shows a pass/fail indicator
    And the chip shows the evaluator name

  Scenario: Expand evaluator chip for details
    Given agent "GPT-4o" has evaluator "Exact Match"
    And the evaluation has been run
    When I click on the "Exact Match" evaluator chip
    Then the chip expands to show result details
    And I see an "Edit Configuration" button

  Scenario: Open evaluator configuration panel
    Given agent "GPT-4o" has evaluator "Exact Match"
    When I click on the "Exact Match" evaluator chip
    And I click "Edit Configuration"
    Then the evaluator configuration panel opens
    And I can see input mapping options

  Scenario: Configure evaluator settings
    When I click "+ Add evaluator" inside the "GPT-4o" agent cell
    And I select evaluator "LLM as Judge"
    Then the evaluator settings form is displayed
    And I can configure the judge model and criteria

  Scenario: Map evaluator inputs from dataset
    Given agent "GPT-4o" has evaluator "Exact Match"
    And the evaluator requires inputs "output" and "expected_output"
    When I open the evaluator configuration panel
    Then I can map "expected_output" to dataset column "expected_output"

  Scenario: Map evaluator inputs from agent outputs
    Given agent "GPT-4o" has evaluator "Exact Match"
    And the evaluator requires input "output"
    When I open the evaluator configuration panel
    Then I can map "output" to agent "GPT-4o" output "response"
    And the mapping is scoped to this specific agent

  Scenario: Evaluator with unmapped required inputs shows warning
    Given agent "GPT-4o" has evaluator "Exact Match"
    And required input "output" is not mapped
    Then the evaluator chip shows a warning indicator

  Scenario: Each agent has independent evaluators
    Given agents "GPT-4o" and "Claude Opus" are configured
    And agent "GPT-4o" has evaluator "Exact Match"
    When I look at the "Claude Opus" agent cell
    Then no evaluators are shown for "Claude Opus"
    And I can add evaluators separately to "Claude Opus"

  Scenario: Copy evaluator configuration to another agent
    Given agents "GPT-4o" and "Claude Opus" are configured
    And agent "GPT-4o" has evaluator "Exact Match" with mappings
    When I click the global "Evaluators" button in the toolbar
    And I click "Add to all agents" for "Exact Match"
    Then agent "Claude Opus" now has evaluator "Exact Match"
    And the mappings are adjusted for "Claude Opus" outputs

  Scenario: Access global evaluators button
    When I look at the page toolbar (top right)
    Then I see an "Evaluators" button
    And clicking it opens a panel to manage evaluator instances
