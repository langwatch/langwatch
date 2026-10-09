@unit
Feature: Deployment modes for a local stack and an e2e run
  As a developer testing SSO and licence flows
  I want each deployment mode to be one named set of env values
  So that haven and the e2e runs in CI start the same deployment

  Background:
    Given the mode definitions live in dev/tests/modes/<mode>.env

  Scenario: Each mode resolves to a named set of env values
    When the saas mode is loaded
    Then its env sets IS_SAAS to true and names the mode saas

  Scenario: A licensed mode names what the developer must supply
    When the sh-licensed mode is loaded
    Then it requires LANGWATCH_LICENSE_KEY and commits no licence value

  Scenario: A mode is refused when a value it requires is not supplied
    Given LANGWATCH_LICENSE_KEY is set neither in the shell nor in .env
    When haven up --mode sh-licensed runs
    Then haven refuses and names LANGWATCH_LICENSE_KEY

  Scenario: An unknown mode is refused listing the valid ones
    When haven up --mode cloud runs
    Then haven refuses and lists every mode in dev/tests/modes

  Scenario: haven up --mode applies the mode on top of the overlay
    Given a stack started with --mode sh-free
    Then the stack's env ends with the sh-free values
    And the mode sticks for the next haven up without --mode

  Scenario: haven status names the effective mode
    Given a stack started with --mode saas
    Then haven status prints "mode saas"

  Scenario: haven says which variable wins when the root .env overrides a mode variable
    Given the root .env sets IS_SAAS to false
    When haven up --mode saas runs
    Then haven warns that IS_SAAS from .env wins over the mode
    And haven status names the effective mode as overridden by IS_SAAS

  Scenario: The e2e guard refuses a journey whose required mode differs from the effective one
    Given the effective mode is sh-free
    When a journey that requires saas starts
    Then the journey is refused naming both modes
