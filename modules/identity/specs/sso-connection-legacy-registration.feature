Feature: A connection registration stored before the arrival policy existed still reads

  Between 2026-08-25 and 2026-09-21 a connection registration stated whether an
  unknown person signing in may be provisioned, as a yes or no, and stated no
  arrival policy (ADR-117 §3 replaced the one with the other). The event log is
  immutable history, so every read of such a registration, by identity's own
  fold, a peer's fold or a projection replay, reads it as the policy it meant.

  # The version 1 schema and transform live in the contract
  # (contract/src/features/sso-connection/sso-connection-registration-v1.ts); the upcast in
  # process/src/features/sso-connection/rules/sso-connection-registration-upcast.rules.ts is declared
  # on the connection pipeline with `.withUpcasts`, and every read seat reads through it.

  @unit
  Scenario: A registration that let unknown people in reads as admitting them
    Given a stored registration that provisioned unknown people and states no arrival policy
    When it is read
    Then its arrival policy is "admit"

  @unit
  Scenario: A registration that kept unknown people out reads as refusing them
    Given a stored registration that provisioned nobody and states no arrival policy
    When it is read
    Then its arrival policy is "refuse"

  @unit
  Scenario: A registration that states neither reads as the default policy
    Given a stored registration that states no arrival policy and no provisioning answer
    When it is read
    Then its arrival policy is "refuse", the default a connection nobody has decided about holds

  @unit
  Scenario: A registration that states an arrival policy reads as written
    Given a stored registration stating the arrival policy "request"
    When it is read
    Then its arrival policy is "request"
    And a registration stating a policy outside the three answers is still refused
