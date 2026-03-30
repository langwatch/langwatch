@regression @integration
Feature: LLM config validation errors visible when popover is closed

  Background:
    Given a prompt editor form with an LLM configuration field

  Scenario: Error indicator shows on trigger when config has validation errors
    Given the LLM configuration has a validation error
    When the config popover is closed
    Then the trigger element displays a red border

  Scenario: Error text shows below trigger when popover is closed
    Given the LLM configuration has a validation error
    When the config popover is closed
    Then the error message text is visible below the trigger element

  Scenario: Error text hides when popover is open
    Given the LLM configuration has a validation error
    When the config popover is open
    Then the error message text is not visible below the trigger element
    And the error is shown inside the popover content instead

  Scenario: No error indicator when config is valid
    Given the LLM configuration has no validation errors
    When the config popover is closed
    Then the trigger element displays a normal border
    And no error text is shown below the trigger
