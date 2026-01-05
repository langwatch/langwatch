Feature: Mandatory Input Variable
  As a user configuring prompts
  I want the "input" variable to be mandatory and clearly explained
  So that I understand how user messages work with my prompt

  Background:
    Given a new prompt with default configuration
    And the prompt has an "input" variable

  # Locked Variable Behavior
  Scenario: Input variable cannot be deleted
    When I view the Variables section
    Then the "input" variable does not have a delete button
    And other variables I add can be deleted

  Scenario: Input variable has info tooltip explaining its purpose
    When I hover over the info icon next to "input"
    Then I see a tooltip explaining "This is the user message input. It will be sent as the user message to the LLM."

  Scenario: Adding additional variables alongside input
    Given I have the locked "input" variable
    When I add a new variable "context"
    Then I have both "input" and "context" variables
    And "input" still cannot be deleted
    And "context" can be deleted

  # Evaluations V3 / Drawer Context
  Scenario: Input variable mapping in Evaluations V3
    Given I am editing a prompt in Evaluations V3
    When I view the Variables section
    Then the "input" variable shows a mapping dropdown
    And I can map "input" to a dataset column
    And the info icon tooltip says "This is the user message input. It will be sent as the user message to the LLM."

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

  # Edge Cases
  Scenario: Existing prompt with custom variable names
    Given I open an existing prompt with variable "question" instead of "input"
    Then "question" is not locked (can be deleted)
    And there is no special locked variable behavior
    # Only the default "input" variable is locked

  Scenario: Deleting all messages still preserves input variable
    Given I am in Messages mode
    When I remove the user message containing "{{input}}"
    Then the "input" variable is still present and locked
    And I can re-add a user message with "{{input}}"

  Scenario: Renaming input variable is not allowed
    Given I view the Variables section
    When I try to edit the "input" variable name
    Then the name field is read-only or disabled
    # The input variable name cannot be changed
