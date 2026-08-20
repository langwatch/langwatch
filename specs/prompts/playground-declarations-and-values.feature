Feature: Declaring a prompt and running one
  As someone working on a prompt
  I want what the prompt declares to sit with the prompt, and what one run
  supplies to sit with the run
  So that I can find both, and never wonder which of two fields a run will use

  # The playground has two panes. The left one is where a prompt is written:
  # its messages, and everything they reference — the variables a message
  # writes as {{name}}, the parameters saved onto the version, the
  # demonstrations. The right one is one run of that prompt.
  #
  # Those declarations used to sit behind sub-tabs on the conversation, which
  # both hid them and implied they belonged to the run. Moving them left leaves
  # the conversation with no sub-tabs at all.
  #
  # A value is the other half: it belongs to a run, so it is set at the message
  # box and nowhere else. "input" is the exception that proves it — the message
  # box IS the field for "input", so "input" is never offered one of its own.

  Background:
    Given I am authenticated in project "my-project"

  @integration
  Scenario: Variables and parameters are reachable without leaving the prompt
    When I view a prompt in the playground
    Then the editor shows the prompt's variables and its parameters
    And neither is behind a tab I have to open first

  @integration
  Scenario: A variable's value is not settable where it is declared
    Given a prompt that declares a variable "topic"
    When I view the prompt in the playground
    Then the editor lets me name "topic" and choose its type
    And the editor offers no field for what "topic" is worth

  @integration
  Scenario: The conversation pane offers no sub-tabs
    When I view a prompt in the playground
    Then the conversation pane shows the conversation and nothing to switch between

  @integration
  Scenario: The prompt's variables are visible on the message box
    Given a prompt that declares variables "topic" and "tone"
    When I view the prompt in the playground
    Then the message box names both variables
    And I can set either of them without leaving the conversation

  @integration
  Scenario: A variable with no value yet stands out from one already set
    Given a prompt that declares variables "topic" and "tone"
    And "topic" has been given a value
    When I look at the message box
    Then "topic" shows the value it holds
    And "tone" shows that it is still empty

  @integration
  Scenario: The message box is the only field for the input variable
    Given a prompt that declares the variable "input"
    When I view the prompt in the playground
    Then "input" is listed among the prompt's variables
    And the message box offers no separate field for "input"
    And the message the user sends is what the run substitutes for "input"
