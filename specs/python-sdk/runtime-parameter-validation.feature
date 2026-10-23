Feature: Python SDK runtime parameter validation
  The observability SDK must report invalid caller input without breaking the
  application or sending a payload that the LangWatch endpoint will reject.

  @regression @unit
  Scenario: A trace with string labels warns and is not exported
    Given a Python SDK trace whose metadata labels are a string
    When the trace finishes
    Then the caller receives a warning that labels must be a list of strings
    And the invalid trace is not exported

  @unit
  Scenario: A trace with a list of string labels is exported normally
    Given a Python SDK trace whose metadata labels are a list of strings
    When the trace finishes
    Then the trace is exported without a parameter warning
