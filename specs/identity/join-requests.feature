Feature: Join requests - asking to join the organization your colleagues already built
  As a person who signed up with a work email
  I need a way to ask my colleagues' organization to let me in, and an admin
  needs one click to say yes
  So that "I signed up and my company was invisible" stops being the reason
  people end up alone in a workspace nobody meant to create

  # D12 (ADR-117; matching and reveal rules in
  # specs/identity/join-matching-and-privacy.feature, the automatic path in
  # specs/identity/domain-auto-join.feature, the sign-up placement in
  # specs/identity/join-before-create.feature). Aggregate join_request in the
  # identity pipeline, tenanted by the organization, because the people who
  # read a request are its admins.
  #
  #   [*] ──request──► PENDING ──admin approves──► APPROVED
  #                       │    └─policy approves──► APPROVED  (auto-join)
  #                       │    └─invite answers it► APPROVED  (D11 supersedes)
  #                       ├────admin rejects─────► REJECTED
  #                       ├────14 days silent────► EXPIRED   (admins woken at day 7)
  #                       └────requester cancels─► WITHDRAWN
  #
  #   PENDING is the only state anything can be done from. Every other state
  #   is terminal, and the four terminal states are told apart only by who
  #   ended it and when.
  #
  # Membership itself is never written here. An approval dispatches an attach
  # on the grants ledger, exactly as accepting an invitation does, and the
  # ledger fact carries the join request as its provenance - so a customer
  # reading their audit page sees who let this person in and on what basis.
  # Join approvals are auditable by default and stay that way: only the
  # migration and read-through-mint sources are ever hidden from that page,
  # and neither is this one.
  #
  # Approvals live in the existing members area beside D11's pending
  # invitations, one panel with two directions. They need no new permission:
  # inviting a colleague is already gated on managing the organization, and
  # answering a request is the same authority pointed the other way. That is
  # also why this deliverable does not wait on the org-admin surface - when
  # that surface arrives it absorbs this panel the way it absorbs invitations.
  #
  # There is no role picker. An approval - by an admin or by policy - grants
  # the organization's default role and nothing else; an admin who wants to
  # hand over more answers with a formal invitation instead, which is the flow
  # that owns roles and teams. Least privilege by construction.
  #
  # Ships behind JOIN_REQUESTS. Flag off, none of this exists.

  Background:
    Given an organization "acme" whose members hold verified addresses on "acme.com"
    And "acme" accepts requests to join from that domain
    And "sam" holds a VERIFIED identifier for "sam@acme.com" and belongs to no organization
    And "ana" administers "acme"

  # ── Asking, and being let in ───────────────────────────────────────────

  @integration
  Scenario: A verified colleague asks to join and the admins are told
    When "sam" asks to join "acme"
    Then the request is PENDING
    And every admin of "acme" is told "sam" is waiting, by email and in the product
    And "sam" is told the request reached them, without naming who they are

  @integration
  Scenario: One click makes the requester a member
    Given "sam" has a PENDING request to join "acme"
    When "ana" approves it
    Then the request is APPROVED and records that "ana" resolved it
    And "sam" is a member of "acme" with the organization's default role
    And "sam" is told they are in, by email and in the product

  @integration
  Scenario: Membership lands through the same ledger an invitation uses
    Given "sam" has a PENDING request to join "acme"
    When "ana" approves it
    Then the membership arrives as a grant, not as a row somebody wrote by hand
    And the grant names the join request as what authorized it
    And "acme"'s audit page shows the approval with "ana" as the actor

  @unit
  Scenario: Approval never carries a role choice
    Given "sam" has a PENDING request to join "acme"
    When "ana" approves it
    Then the only role on offer is the organization's default one
    And raising "sam" above it is a separate, later act

  @integration
  Scenario: A replayed approval attaches membership exactly once
    Given "ana"'s approval already attached "sam"'s membership
    When the approval is retried
    Then nothing that already landed is applied a second time
    And "sam" is a member exactly once

  @unit
  Scenario: Approving somebody who is already a member resolves the request and adds nothing
    Given "sam" joined "acme" by invitation while the request was open
    When "ana" approves the request
    Then the request resolves as APPROVED
    And no second membership is attached

  # ── The other four endings ─────────────────────────────────────────────

  @unit
  Scenario: A rejection ends the request without asking for a reason
    Given "sam" has a PENDING request to join "acme"
    When "ana" rejects it
    Then the request is REJECTED and records that "ana" resolved it
    And "sam" is told the request was not approved, with no reason and no rejector named

  @unit
  Scenario: The requester can withdraw and stop bothering anybody
    Given "sam" has a PENDING request to join "acme"
    When "sam" withdraws it
    Then the request is WITHDRAWN
    And it leaves the admins' panel
    And no reminder and no expiry wake follows

  @unit
  Scenario: Fourteen days of silence expires the request
    Given "sam" has a PENDING request to join "acme"
    When fourteen days pass with nobody answering
    Then the request is EXPIRED
    And "sam" is told it lapsed and may ask again

  @unit
  Scenario: The seventh day reminds the admins once
    Given "sam" has a PENDING request to join "acme"
    When seven days pass with nobody answering
    Then the admins are reminded exactly once
    And a second reminder is not sent before the request expires

  @unit
  Scenario: Every ending is terminal
    Given "sam"'s request was rejected, expired or withdrawn
    When anyone tries to approve or reject it
    Then the attempt is refused with code join_request_not_pending and status 409
    And the request keeps the ending it already had

  @unit
  Scenario: A request from another organization is not there to answer
    Given a request to join an organization "ana" does not administer
    When "ana" tries to approve it
    Then the attempt is refused with code join_request_not_found and status 404
    And nothing about the other organization is revealed

  # ── Anti-abuse ─────────────────────────────────────────────────────────

  # A request costs an admin attention, so the cheapest attack is volume. Two
  # limits do the work: at most one open request per person per organization,
  # and the same rate limiting the sign-in endpoints already carry.

  @unit
  Scenario: One open request per person per organization
    Given "sam" has a PENDING request to join "acme"
    When "sam" asks to join "acme" again
    Then the attempt is refused with code join_request_already_pending and status 409
    And no second notification goes out

  @unit
  Scenario: Asking is rate limited the way signing in is
    Given "sam" has asked to join as often as the installation allows for now
    When "sam" asks again
    Then the attempt is refused with code join_request_throttled and status 429
    And the refusal says how long is left, from the answer it got

  @unit
  Scenario: A rejected person cannot immediately ask again
    Given "ana" rejected "sam"'s request
    When "sam" asks again within the cool-down
    Then the attempt is refused with code join_request_throttled and status 429
    And asking after the cool-down opens a fresh PENDING request

  @unit @unimplemented
  Scenario: Every refusal reaches the person as words
    When any of these refusals is shown to a person
    Then the screen shows the customer copy registered for that code
    And the screen never shows the code itself or an internal error

  # ── Two directions with invitations (D11) ──────────────────────────────

  # One panel, two directions. specs/identity/resilient-invitations.feature
  # owns the invitation's own lifecycle; what is bound here is only the
  # crossing points, so a person can never hold both at once.

  @integration
  Scenario: An invitation answers a pending request and supersedes it
    Given "sam" has a PENDING request to join "acme"
    When "ana" sends "sam" a formal invitation while the request is open
    Then the request resolves as APPROVED and records the invitation as what resolved it
    And "sam" holds one invitation and no open request
    And the role and teams on that invitation are the ones the invitation carried

  @integration
  Scenario: Accepting any invitation withdraws the same person's pending request
    Given "sam" has a PENDING request to join "acme"
    And "sam" holds a separate invitation to "acme" sent before the request
    When "sam" accepts the invitation
    Then the request is WITHDRAWN because the invitation was accepted
    And "sam" is a member exactly once

  @unit
  Scenario: A pending request never blocks an invitation
    Given "sam" has a PENDING request to join "acme"
    When "ana" invites "sam" to "acme"
    Then the invitation is created
    And the duplicate-request limit had nothing to say about it

  # ── Where an admin answers ─────────────────────────────────────────────

  @integration
  Scenario: Requests wait beside invitations in the members area
    Given "acme" has pending invitations and "sam"'s pending request
    When "ana" opens the members area
    Then the pending requests and the pending invitations are in one panel
    And each request shows who is asking and when they asked

  @unit
  Scenario: Answering a request needs the authority that already gates inviting
    Given a member of "acme" who cannot invite colleagues
    When they try to approve or reject "sam"'s request
    Then the attempt is refused for lack of permission
    And no new permission had to be granted to anybody for approvals to work

  # ── The flag ───────────────────────────────────────────────────────────

  @unit
  Scenario: With the flag off nothing here exists
    Given the join-requests flag is off
    When "sam" signs up with a work email
    Then no request can be made and no panel appears
    And sign-up proceeds exactly as it did before
