Feature: A process that dies of an unhandled failure says so at fatal
  As the on-call engineer
  I want an uncaught exception or unhandled rejection logged at level fatal
  So that the "Fatal Errors" alert, which matches that level, fires before the process exits

  # The fatal handlers logged at error and then exited 1, so every crash was
  # invisible to the alert that exists to catch it.

  @unit
  Scenario: An unhandled rejection is logged at fatal before the process exits
    Given a server that owns its process
    When a promise rejection goes unhandled
    Then one line is written at level fatal naming the event and the reason
    And the process exits with code 1

  @unit
  Scenario: An uncaught exception is logged at fatal before the process exits
    Given a server that owns its process
    When an exception goes uncaught
    Then one line is written at level fatal naming the event and the error
    And the process exits with code 1
