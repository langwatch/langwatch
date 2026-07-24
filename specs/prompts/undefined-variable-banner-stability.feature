@integration
Feature: Prompt playground stays stable when a prompt references undefined variables
  When a message uses a variable that is not declared as an input, the editor
  flags it with an "Undefined variables" warning so the author can create it.

  Surfacing that warning must never destabilise the editor. The prompt re-renders
  constantly (as the author types, switches tabs, or a playground conversation
  streams), and the warning must survive those re-renders without throwing the
  whole page to the top-level error boundary.

  Background:
    Given a prompt open in the playground

  Scenario: An undefined variable is flagged without crashing the page
    Given the message references a variable that is not declared as an input
    When the prompt re-renders repeatedly while the author works
    Then the editor shows an "Undefined variables" warning naming that variable
    And the playground keeps rendering the prompt instead of showing the error boundary

  Scenario: The undefined-variables warning stays clear of the prompt after a resize
    Given the message references a variable that is not declared as an input
    When the editor is resized so the warning wraps onto more lines
    Then the warning still does not cover the last line of the prompt

  Scenario: A prompt with a running conversation re-opens without crashing
    Given the prompt has a conversation whose assistant turn references a trace that no longer exists
    When the prompt tab is re-opened
    Then the conversation is rendered
    And the playground does not crash to the error boundary
