Feature: Storage billing — measure-time tripwire (ADR-027, Phase 4.5)
  As the storage-billing pipeline
  I want each billed measurement shadow-compared against an independent reference
  So that a wrong value is caught and logged before it bills, without ever risking the measure path

  # The tripwire is purely observational: behind its own flag, it computes an independent reference
  # for the same hour and logs a capped warning when the measurement diverges beyond tolerance. It
  # must never alter the billed value and never throw into the measure/report path — every failure is
  # swallowed. Given `_size_bytes` aggregation caused two prod OOMs, a bad value must be visible early.

  @unit
  Scenario: A disabled tripwire does nothing
    Given the tripwire flag is off for the organization
    When a measurement is checked
    Then no reference is computed and nothing is logged

  @unit
  Scenario: No reference means no comparison
    Given the tripwire is enabled but no reference is available
    When a measurement is checked
    Then nothing is logged

  @unit
  Scenario: A measurement within tolerance is silent
    Given a measurement within the tolerance of its reference
    When it is checked
    Then nothing is logged

  @unit
  Scenario: A divergent measurement is warned once
    Given a measurement that diverges beyond the tolerance
    When it is checked
    Then a divergence warning is logged

  @unit
  Scenario: Divergence logging is capped so a broken reference can't flood logs
    Given repeated divergent measurements past the log cap
    When they are checked
    Then no more than the capped number of warnings are logged

  @unit
  Scenario: The log cap resets each window so later divergence isn't silenced forever
    Given the log cap was reached in one window
    When a divergent measurement is checked after the window elapses
    Then a warning is logged again

  @unit
  Scenario: The tripwire never throws into the measure path
    Given the reference computation fails
    When a measurement is checked
    Then the check resolves without throwing and logs no divergence
