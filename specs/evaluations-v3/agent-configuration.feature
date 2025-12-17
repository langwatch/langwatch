@unit
Feature: Agent configuration
  As a user configuring an evaluation
  I want to add and configure agents (LLM prompts or code executors)
  So that I can compare different models and prompts

  Background:
    Given I render the EvaluationsV3 spreadsheet table

  Scenario: Show required indicator when no agents configured
    Given no agents are configured
    Then the "Add Agent" button displays a warning indicator

  Scenario: Open agent config panel
    When I click the "Add Agent" button
    Then the agent configuration panel slides in from the right
    And the panel has a glossy/frosted background
    And the table remains fully visible and interactive behind it

  Scenario: Add LLM agent (default)
    When I click the "Add Agent" button
    Then the agent configuration panel opens with LLM Prompt selected by default
    When I select model "openai/gpt-4o"
    And I enter prompt "You are a helpful assistant. Answer: {{input}}"
    And I click "Save"
    Then a new agent column appears in the table
    And the agent header shows the model icon and name

  Scenario: Switch to code executor agent
    When I click the "Add Agent" button
    Then the agent configuration panel opens with LLM Prompt selected by default
    When I switch the agent type to "Code"
    And I enter the code executor configuration
    And I click "Save"
    Then a new agent column appears in the table
    And the agent header shows a code icon

  Scenario: Add multiple agents for comparison
    Given an agent "GPT-4o" is configured
    When I click "Add Comparison" on the agents header
    And I configure a second agent "Claude Opus"
    Then 2 agent columns are visible in the table
    And both agents can be run for comparison

  Scenario: Edit existing agent configuration
    Given an agent "GPT-4o" is configured
    When I click the settings button on the agent column header
    Then the agent configuration panel opens with the current config
    And I can modify the prompt and save changes

  Scenario: Agent with unmapped required inputs shows warning
    Given an agent with input "userQuestion" is configured
    And the dataset has column "input"
    And "userQuestion" is not mapped to any dataset column
    Then the agent column header shows a warning indicator

  Scenario: Map agent input to dataset column
    Given an agent with input "userQuestion" is configured
    And the dataset has column "input"
    When I open the agent configuration panel
    And I map "userQuestion" to dataset column "input"
    Then the warning indicator disappears from the agent header

  Scenario: Interact with table while panel is open
    When I click the "Add Agent" button
    And the agent configuration panel is open
    Then I can still click and edit cells in the table
    And I can scroll the table

  Scenario: Close panel by clicking X button
    When I click the "Add Agent" button
    And I click the close button on the panel
    Then the agent configuration panel closes
