Feature: A monitor's sample rate decides which traces it evaluates

  A monitor with a sample rate below 1 evaluates only part of the traces it matches. The
  decision comes from a hash of the trace id and the monitor id, not a random draw, so a retry
  or a redelivery of the same evaluation makes the same decision, and each monitor samples
  on its own.

  @unit
  Scenario: Sampling applies correctly
    Given a monitor with sample rate 0.5
    When 100,000 traces are processed
    Then about half of them are evaluated, within half a percentage point

  @unit
  Scenario: A retried or redelivered evaluation makes the same sampling decision
    Given a monitor with sample rate 0.5
    When the same trace is processed for that monitor again
    Then it is evaluated again if it was evaluated the first time, and skipped again if not

  @unit
  Scenario: Monitors sample the same traces independently
    Given two monitors with sample rate 0.5
    When the same 100,000 traces are processed
    Then the monitors agree on about half the traces, not all of them

  @unit
  Scenario: Sample rates of 0 and 1 are exact
    Given a monitor with sample rate 0
    Then no trace is evaluated
    Given a monitor with sample rate 1
    Then every trace is evaluated
