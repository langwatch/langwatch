Feature: Unified Prompt Defaults
  As a user creating new prompts
  I want consistent defaults across all contexts
  So that my prompts behave predictably regardless of where I create them

  Background:
    Given the default prompt configuration has:
      | inputs  | input                           |
      | outputs | output                          |
      | system  | You are a helpful assistant.    |
      | user    | {{input}}                       |

  # Playground Context
  Scenario: Creating a new prompt in the Playground
    Given I am in the Prompt Playground
    When I create a new prompt
    Then the prompt has an "input" variable of type "str"
    And the prompt has an "output" output of type "str"
    And the system message is "You are a helpful assistant."
    And the user message is "{{input}}"

  # Evaluations V3 Context
  Scenario: Creating a new prompt from Evaluations V3
    Given I am in Evaluations V3
    When I click to add a new runner prompt
    Then the prompt has an "input" variable of type "str"
    And the prompt has an "output" output of type "str"
    And the system message is "You are a helpful assistant."
    And the user message is "{{input}}"

  # Optimization Studio Context
  Scenario: Dragging a new LLM node in Optimization Studio
    Given I am in Optimization Studio
    When I drag a new LLM Signature node onto the canvas
    Then the node has an "input" input field of type "str"
    And the node has an "output" output field of type "str"
    And the instructions parameter is "You are a helpful assistant."
    And the messages parameter has a user message with "{{input}}"

  # Edge Cases
  Scenario: Project has custom default model
    Given my project has a default model of "anthropic/claude-sonnet-4-20250514"
    When I create a new prompt in the Playground
    Then the prompt uses "anthropic/claude-sonnet-4-20250514" as the model
    And the prompt still has the standard input/output defaults

  Scenario: New prompt temperature defaults based on model
    Given the default model is "openai/gpt-5"
    When I create a new prompt
    Then the temperature is set to 1
    # GPT-5 models require temperature 1
