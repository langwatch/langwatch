Feature: Ops agent access approval
  An operator's coding agent asks for one hour of access to production. The operator approves
  each request with a passkey on a page that shows exactly what the signature approves. The
  agent redeems once with its PKCE verifier and its requester key. ADR-202.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia holds the platform-operator grant and has a passkey
    And the organization "ACME" exists with a project "acme-support"

  @integration
  Scenario: The surface is hidden unless cloud ops and the flag are both on
    Given the flag "ops_agent_access_enabled" is off
    When an agent asks for access with a requester key
    Then the request answers 404 not_found
    And the agents page procedures answer not found

  @integration
  Scenario: An operator without a passkey cannot enrol an agent
    Given Pedro holds the platform-operator grant and has no passkey
    When Pedro asks for the enrolment ceremony
    Then it is refused with "passkey_required"
    And no requester key exists for Pedro

  @integration
  Scenario: An operator enrols an agent with a passkey and gets a 90 day requester key
    When Olivia completes the enrolment ceremony with her passkey for "laptop agent"
    Then a requester key starting "lwsr_" is shown once
    And it expires in 90 days
    And every other platform operator is emailed

  @integration
  Scenario: A requester key can only create requests
    Given Olivia enrolled "laptop agent"
    When the requester key is presented to a trace read
    Then it is refused as no credential

  @integration
  Scenario: A request needs a valid shape
    Given Olivia enrolled "laptop agent"
    When the agent asks with no scope, or an org scope without an organization, or a reason longer than 500 characters
    Then the request is refused with a validation error and nothing is stored

  @integration
  Scenario: An agent asks for access and gets an approval URL that lasts ten minutes
    Given Olivia enrolled "laptop agent"
    When the agent asks for "org:content" on "ACME" with a reason and a PKCE challenge
    Then it receives a request id and an approval URL under "/ops/agents/approve/"
    And the request expires in ten minutes

  @integration
  Scenario: A sixth request in one hour is refused
    Given the agent made five requests in the last hour
    When it asks again
    Then it is refused 429 with "staff_access_rate_limited"

  @integration
  Scenario: A request is refused when the deployment has no public base URL
    Given the deployment sets no BASE_HOST
    When the agent asks for access
    Then it is refused 503 with "staff_access_not_configured"

  @integration
  Scenario: The approval page opens only for the requester's owner
    Given the agent of Olivia has a pending request
    When Pedro, another platform operator, opens the approval
    Then he is answered not found
    And when Olivia opens it she sees the organization, scopes, reason, machine, IP and expiry

  @integration
  Scenario: Content access needs the organization name typed
    Given a pending request for "org:content" on "ACME"
    When Olivia asks for the approval ceremony with the typed name "ACME Corp"
    Then it is refused with "organization_name_mismatch"

  @integration
  Scenario: Support needs the organization name typed, with or without spend
    Given a pending request for "org:support" on "ACME"
    When Olivia types no organization name, with or without the spend tick
    Then the ceremony is refused with "organization_name_mismatch"
    And with the name typed it is offered

  @integration
  Scenario: The passkey signs a hash of exactly what is shown
    Given a pending request for "org:support" on "ACME"
    When Olivia approves with spend off but the assertion was made over the challenge with spend on
    Then the approval is refused with "passkey_assertion_refused"
    And the request stays pending

  @integration
  Scenario: Approval needs user verification
    Given a pending request
    When Olivia approves with an assertion whose user verification flag is off
    Then the approval is refused with "passkey_assertion_refused"
    And the request stays pending

  @integration
  Scenario: An approval lands in the customer's audit log and notifies the other operators
    Given a pending request for "org:support" on "ACME" with reason "fix ACME's broken evaluator"
    When Olivia approves it with her passkey
    Then ACME's audit log holds a "staffAccess.approved" row naming LangWatch Support, Olivia and the reason
    And every other platform operator is emailed

  @integration
  Scenario: An approval the customer audit log did not take is ended
    Given a pending request for "org:content" on "ACME"
    And ACME's audit log refuses writes
    When Olivia approves it with her passkey
    Then it is refused with "staff_access_audit_unavailable"
    And a redeem is refused with "request_not_approved"
    And no key is minted

  @integration
  Scenario: An expired request cannot be approved or redeemed
    Given a request created eleven minutes ago
    When Olivia approves it
    Then it is refused with "request_expired"
    And a redeem is refused with "request_expired"

  @integration
  Scenario: A denied request cannot be redeemed
    Given Olivia denied a pending request
    When the agent redeems it
    Then it is refused with "request_not_approved"

  @integration
  Scenario: Redeem needs the right verifier and does not spend the request on a wrong one
    Given an approved request
    When the agent redeems with a verifier that does not match the challenge
    Then it is refused with "invalid_code_verifier"
    And a redeem with the right verifier still succeeds

  @integration
  Scenario: Redeem needs the requester key that made the request
    Given an approved request made by Olivia's agent
    When another requester key redeems it with the right verifier
    Then it is refused as not found

  @integration
  Scenario: A request is redeemed once and the key lasts one hour
    Given an approved request for "org:content" on "ACME"
    When the agent redeems it
    Then it receives an API key named "LangWatch Staff Read" that expires in one hour
    And a second redeem is refused with "already_redeemed"

  @integration
  Scenario: Ops read alone mints no organization key
    Given an approved request for "ops:read" only
    When the agent redeems it
    Then it receives an ops token starting "lwsa_" and no API key

  @integration
  Scenario: Redeem must come from the address the operator approved
    Given an approved request made from 203.0.113.7
    When the agent redeems it from 198.51.100.9
    Then it is refused with "staff_access_ip_mismatch"
    And no key is minted
    And a redeem from 203.0.113.7 still succeeds

  @integration
  Scenario: A request or redeem with no client address is refused
    Given Olivia enrolled "laptop agent"
    When the agent asks for access from a connection with no client address
    Then it is refused with "staff_access_ip_mismatch"
    And a redeem with no client address is refused with "staff_access_ip_mismatch"

  @integration
  Scenario: Other operators are told when an agent redeems
    Given an approved request
    When the agent redeems it
    Then every other platform operator is emailed that a session started

  @integration
  Scenario: An approval whose approver lookup fails is ended
    Given a pending request for "org:metadata" on "ACME"
    And the approver's user record cannot be read
    When Olivia approves it with her passkey
    Then it is refused with "staff_access_audit_unavailable"
    And a redeem is refused with "request_not_approved"
    And ACME's audit log holds no approval row

  @integration
  Scenario: An approval stays unredeemable when its audit row and its revoke both fail
    Given a pending request for "org:metadata" on "ACME"
    And ACME's audit log refuses writes and the request store refuses the revoke
    When Olivia approves it with her passkey
    Then it is refused with "staff_access_audit_unavailable"
    And a redeem is refused with "request_not_approved"
    And the agent reads the request as pending until it expires

  @integration
  Scenario: A crash between the approval claim and its audit row leaves nothing redeemable
    Given a pending request whose approval was claimed but whose audit row was never written
    When the agent redeems it
    Then it is refused with "request_not_approved"
    And after it lapses the customer's audit log still holds nothing for it

  @integration
  Scenario: An approval whose confirm fails after its audit row is ended and the end is audited
    Given a pending request for "org:metadata" on "ACME"
    And the request store fails to confirm the approval after ACME's audit row is written
    When Olivia approves it with her passkey
    Then it is refused with "staff_access_audit_unavailable"
    And a redeem is refused with "request_not_approved"
    And the next sweep writes one "staffAccess.revoked" row after the approval row

  @integration
  Scenario: A revoke whose audit row fails is retried by the sweep
    Given a live session on "ACME"
    And ACME's audit log refuses writes
    When Pedro revokes it
    Then the revoke fails and a second revoke answers "staff_access_already_ended"
    And once the audit log takes writes the sweep writes one "staffAccess.revoked" row naming Olivia as approver and Pedro as revoker

  @integration
  Scenario: A revoke whose key revoke fails is retried by the sweep
    Given a live session on "ACME"
    And the key store refuses the key revoke
    When Pedro revokes it
    Then the key is already refused at the gate as revoked
    And the next sweep revokes the key and writes one "staffAccess.revoked" row

  @integration
  Scenario: A natural expiry whose audit row fails is retried by the sweep
    Given a session past its hour
    And ACME's audit log refuses writes
    When the sweep runs
    Then nothing is marked audited
    And a later sweep writes one "staffAccess.expired" row

  @integration
  Scenario: An approval that was never redeemed is audited when it lapses
    Given Olivia approved a request on "ACME" that the agent never redeemed
    When its ten minutes pass and the sweep runs
    Then ACME's audit log holds a "staffAccess.expired" row for it

  @integration
  Scenario: The kill switch reports how many sessions ended and how many failed
    Given two live sessions and the key store refuses one key revoke
    When Pedro revokes all agent access
    Then the answer counts one ended and one failed
    And the next sweep finishes the failed one

  @integration
  Scenario: Revoking an agent ends its live sessions and requests
    Given Olivia's agent holds a live session on "ACME" and a pending request
    When Olivia revokes the agent
    Then its key is refused as revoked
    And the pending request can no longer be approved
    And ACME's audit log holds a "staffAccess.revoked" row with cause "requester_revoked"
    And every other platform operator is emailed

  @integration
  Scenario: A real passkey approval lands in the audit log and the agent redeems it
    Given a signed-in operator with a passkey on the live api
    When the agent asks, the operator signs the approval with the passkey and approves
    Then ACME's audit log holds a real "staffAccess.approved" row
    And a redeem from another address is refused with "staff_access_ip_mismatch"
    And a redeem from the request's address answers an API key

  @integration
  Scenario: Staff access procedures refuse a person without the operator grant
    Given a signed-in person with no platform-operator grant
    When they call the agents page procedures
    Then each is refused and nothing changes
