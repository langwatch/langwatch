@unit
Feature: Evaluator configuration
  As a user configuring an evaluation
  I want to add and configure global evaluators and assign them to agents
  So that I can assess the quality of each agent's outputs

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And an agent "GPT-4o" is configured

  @unimplemented
  Scenario: Add evaluator to agent
    When I click "+ Add evaluator" inside the "GPT-4o" agent cell
    And I select category "Expected Answer"
    And I select evaluator "Exact Match"
    Then a global evaluator "Exact Match" is created
    And the evaluator chip appears inside the agent cell
    And the chip shows the evaluator name "Exact Match"

  @unimplemented
  Scenario: Add same evaluator to multiple agents
    Given agents "GPT-4o" and "Claude Opus" are configured
    And a global evaluator "Exact Match" exists
    When I click "+ Add evaluator" inside the "GPT-4o" agent cell
    And I select the existing "Exact Match" evaluator
    And I click "+ Add evaluator" inside the "Claude Opus" agent cell
    And I select the existing "Exact Match" evaluator
    Then both agents reference the same global evaluator
    And each agent has independent mappings for the evaluator

  @unimplemented
  Scenario: Evaluator chips show compact status
    Given agent "GPT-4o" has evaluator "Exact Match"
    And the evaluation has been run
    Then the evaluator chip shows a pass/fail indicator
    And the chip shows the evaluator name

  @unimplemented
  Scenario: Expand evaluator chip for details
    Given agent "GPT-4o" has evaluator "Exact Match"
    And the evaluation has been run
    When I click on the "Exact Match" evaluator chip
    Then the chip expands to show result details
    And I see an "Edit Configuration" button

  @unimplemented
  Scenario: Configure global evaluator settings
    When I click "+ Add evaluator" inside the "GPT-4o" agent cell
    And I select evaluator "LLM as Judge"
    Then the evaluator settings form is displayed
    And I can configure the judge model and criteria
    And these settings apply to all agents using this evaluator

  @unimplemented
  Scenario: Map evaluator inputs from dataset
    Given agent "GPT-4o" has evaluator "Exact Match"
    And the evaluator requires inputs "output" and "expected_output"
    When I open the evaluator configuration panel for agent "GPT-4o"
    Then I can map "expected_output" to dataset column "expected_output" from the active dataset
    And the mapping includes the dataset ID (sourceId) for multi-dataset support
    And the mapping is stored specifically for agent "GPT-4o"

  @unimplemented
  Scenario: Map evaluator inputs from agent outputs
    Given agent "GPT-4o" has evaluator "Exact Match"
    And the evaluator requires input "output"
    When I open the evaluator configuration panel for agent "GPT-4o"
    Then I can map "output" to agent "GPT-4o" output "response"
    And the mapping is scoped to this specific agent

  @unimplemented
  Scenario: Each agent has independent mappings for shared evaluator
    Given agents "GPT-4o" and "Claude Opus" are configured
    And a global evaluator "Exact Match" exists
    And both agents use evaluator "Exact Match"
    When I map "output" to "GPT-4o.response" for agent "GPT-4o"
    Then the mapping for agent "Claude Opus" remains unchanged
    And results are computed independently for each agent

  @unimplemented
  Scenario: Modify global evaluator settings affects all agents
    Given agents "GPT-4o" and "Claude Opus" are configured
    And both agents use evaluator "Exact Match"
    When I open the global evaluators panel
    And I change "Exact Match" settings
    Then the settings change applies to both agents

  @unimplemented
  Scenario: DSL generates unique evaluator nodes per agent
    Given agents "GPT-4o" and "Claude Opus" are configured
    And both agents use evaluator "Exact Match"
    When the workflow DSL is generated
    Then evaluator nodes are named "GPT-4o.Exact Match" and "Claude Opus.Exact Match"
    And results can be mapped back to the correct agent
