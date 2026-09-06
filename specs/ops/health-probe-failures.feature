Feature: A health probe that fails says what broke

  The /api/health probes POST a canary through our own public boundary and
  wait for it to come back. When that round trip does not complete, the answer
  goes to an external monitor — so it has to carry enough for the alert to name
  the broken half, and it has to arrive at all.

  Both failure shapes are ours, never the caller's: a network-level refusal
  (connection refused, DNS, a wedged upstream that never answers) and a
  non-ok response from our own boundary. They used to leave as an anonymous
  500 with nothing attached, or as a hand-written JSON body with no code in it.

  # Bindings:
  #   platform/app/src/server/routes/health-checks.ts
  #   platform/app/src/server/routes/__tests__/health-checks.unit.test.ts

  @unit
  Scenario: A canary the collector never answers is reported as our failure
    Given the canary POST fails at the network level
    When a probe sends it
    Then the probe fails with the health check code
    And the failure is attributed to the platform
    And the record names the probe and the transport that broke

  @unit
  Scenario: A canary our own boundary refuses names the status it was refused with
    Given the canary POST comes back not ok
    When a probe sends it
    Then the probe fails with the health check code
    And the upstream status is carried for the alert to read

  @unit
  Scenario: A canary that hangs is not waited on forever
    Given an upstream that never answers
    When a probe sends the canary
    Then the request is abandoned rather than held open indefinitely

  @unit
  Scenario: The cause of a transport failure survives in the log
    Given the canary POST fails at the network level
    When a probe sends it
    Then the underlying cause is logged
    So that it is not lost to the wire's masking of unhandled causes
