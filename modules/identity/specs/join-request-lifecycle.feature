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
