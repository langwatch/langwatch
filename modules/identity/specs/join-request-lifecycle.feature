@identity
Feature: Join request lifecycle

  @unit
  Scenario: An expired join request tells its requester
    Given a join request that has expired
    When its lapse is dispatched
    Then the requester is told their request lapsed

  # Organization names the invitees who hold an account on its batch fact;
  # identity answers their open requests from its own side (§9, R7).
  @unit
  Scenario: Identity answers a pending request from organization's invitation fact
    Given "sam" has a PENDING request to join "acme"
    When organization records an invitation batch naming "sam" as an invitee
    Then identity resolves "sam"'s request as APPROVED by that invitation

  @unit
  Scenario: A batch fact that names no invitees resolves nothing
    Given "sam" has a PENDING request to join "acme"
    When organization records an invitation batch that names no invitees
    Then "sam"'s request stays PENDING

  @unit
  Scenario: A redelivered invitation batch resolves the pending request once
    Given "sam" has a PENDING request to join "acme"
    When organization's invitation batch fact is delivered twice
    Then both deliveries share one deduplication id keyed by the batch
    And the request is resolved once

  @unit
  Scenario: Single sign-on records the arrival it admitted
    Given "acme"'s connection admits arrivals on "acme.com"
    When "ivy" first signs in through it and single sign-on creates her membership
    Then a join request for "ivy" is recorded, approved by the "sso-arrival" policy
    And it names the connection she came in through
    And no second membership is attached and no administrator is mailed
    And a failure to record it still leaves her a member
