Feature: Default input variable
  As a user configuring prompts
  I want the default "input" variable to behave like any other variable
  So that prompts that take different inputs (response, context, ...) are
  not forced to carry an unused "input"

  # Customer context: an LLM-judge prompt only needed "response" and
  # "context". Removing the default "input" was blocked with "it's
  # required", forcing the same upstream value to be mapped into both
  # "input" and "response". The engine has no such contract: template
  # turns referencing an unfilled variable render empty and are
  # dropped, and the no-messages path falls back across
  # question/prompt/input/all-inputs.

  Background:
    Given a new prompt with default configuration
    And the prompt has an "input" variable

  @integration
  Scenario: Input variable can be deleted like any other
    When I view the Variables section
    Then the "input" variable has a delete button
    When I delete the "input" variable
    Then the prompt only keeps the variables I defined

  @integration
  Scenario: Input variable can be renamed
    When I rename the "input" variable to "response"
    Then the variable list shows "response"
    And no locked variable behavior applies

  Scenario: Input variable has info tooltip explaining its purpose
    When I hover over the info icon next to "input"
    Then I see a tooltip explaining "This is the user message input. It will be sent as the user message to the LLM."

  # Evaluations V3 / Drawer Context
  Scenario: Input variable mapping in Evaluations V3
    Given I am editing a prompt in Evaluations V3
    When I view the Variables section
    Then the "input" variable shows a mapping dropdown
    And I can map "input" to a dataset column

  # Playground Context - Special Behavior
  Scenario: Input variable mapping disabled in Playground
    Given I am editing a prompt in the Playground
    When I view the Variables section
    Then the "input" variable does not show a mapping dropdown
    And the "input" variable shows an info icon
    And hovering shows "This value comes from the Conversation tab input"

  Scenario: Playground conversation provides input value
    Given I am in the Playground with a prompt
    When I type "Hello world" in the conversation input
    And I send the message
    Then the "input" variable is populated with "Hello world"
    And the user message "{{input}}" becomes "Hello world"
