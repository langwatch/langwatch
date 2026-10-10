Feature: Workflow run output presentation
  @integration
  Scenario: Run failures show a readable alert and copyable details
    Given a failed code node execution with a Python traceback
    When its outputs panel opens
    Then an error alert names the exception and message
    And the full traceback is available in a scrollable highlighted view with copying

  @integration
  Scenario: Structured output preserves all JSON values
    Given a successful execution returning nested JSON
    When its outputs panel opens
    Then a highlighted JSON view shows the complete value with copying

  @integration
  Scenario: Privacy restrictions hide error details and copying
    Given output privacy hides a failed execution
    When its outputs panel opens
    Then neither the failure content nor its copy action is exposed
