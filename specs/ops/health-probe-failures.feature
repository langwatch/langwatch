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
  #   modules/platform-health/process/src/services/subsystem-probe.service.ts
  #   modules/platform-health/process/src/services/__tests__/subsystem-probe-canary.unit.test.ts

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

  @regression @unit
  Scenario: A canary refused by a pod that is shutting down is sent again
    Given the canary POST is refused by a pod that is shutting down
    And the refusal says no handler saw the request
    When a probe sends it
    Then the probe sends the canary again
    And the probe passes when the next attempt is accepted
    # A rollout drains one pod at a time, and the load balancer can still
    # route to a draining pod for a few seconds. That is not a broken platform.

  @regression @unit
  Scenario: A canary refused by a pod that is shutting down on every attempt still fails
    Given every canary POST is refused by a pod that is shutting down
    When a probe sends it
    Then the probe fails with the health check code after its last attempt

  @regression @unit
  Scenario: A canary refused after a handler ran is not sent again
    Given the canary POST is refused with a 503 a handler answered
    When a probe sends it
    Then the probe sends the canary once
    And the probe fails with the health check code
    # A handler may have stored the canary already; only a refusal no handler
    # saw is safe to resend.

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
