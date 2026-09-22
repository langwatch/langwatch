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
  # On for everybody. The JOIN_REQUESTS flag is retired — see "The flag is
  # retired" at the foot of this file for what replaced it.

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

  @integration
  Scenario: A pending request for another organization does not take over a dashboard that is still loading
    Given "sam" has a pending request to join "ana"
    And "sam" opens "acme", whose own organization read has not answered yet
    When the dashboard renders
    Then the waiting screen for "ana" is not shown
    And no offer to ask to join is shown either
    And the "acme" dashboard renders as it normally would

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

  @unit
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

  # ── A request nobody clicked ───────────────────────────────────────────

  # Everywhere above, a request exists because a person pressed a button.
  # There is a second door: somebody signs in through a connection whose
  # answer is that arrivals WAIT, and a request appears because an account
  # row did. The difference matters in four places, and each is a scenario
  # here — most of all the cool-down, because a request nobody chose to make
  # is one an administrator could otherwise watch reappear for ever.

  @unit
  Scenario: Somebody an identity provider admits but does not let straight in waits in the queue
    Given "acme"'s connection proved "acme.com" and answers that arrivals wait for approval
    When "sam" signs in through it for the first time
    Then a PENDING request for "sam" is waiting for an administrator
    And the administrators are told somebody is waiting

  @unit
  Scenario: The request a sign-in made is attributed to the system, not to the person
    Given "acme"'s connection answers that arrivals wait for approval
    When "sam" signs in through it for the first time
    Then the request records the system as what made it
    And nobody is recorded as having asked, because "sam" pressed nothing

  # REGRESSION-SHAPED. A request through this door is made because an account
  # row appeared, which happens on a provider rotation, on an unlink, and on
  # the account reconcile beside it — none of which "sam" chose. Without the
  # cool-down an administrator who explicitly said no would watch the same
  # person climb back into the queue, repeatedly, for reasons neither of them
  # caused.
  @unit
  Scenario: Somebody already rejected does not climb back into the queue when their account is touched
    Given "ana" rejected "sam" and the cool-down has not run out
    When "sam"'s account row is touched again by a sign-in through the connection
    Then no new request is made
    And the administrators are not told anything

  @unit
  Scenario: A sign-in never fails because the queue would not take the request behind it
    Given "sam" already has a PENDING request to join "acme"
    When "sam" signs in through the connection again
    Then the sign-in succeeds and the account is exactly as it was
    And the duplicate was declined quietly rather than raised at the person signing in

  # The two doors ask different questions of different populations. An
  # organization that is closed to strangers off the internet has said
  # nothing about its own staff, and re-asking its join policy here would be
  # asking the wrong door about the wrong people.
  @unit
  Scenario: An arrival is not re-asked the question the organization answered about strangers
    Given "acme" is closed to people asking to join off the internet
    And its connection proved "acme.com" and answers that arrivals wait
    When "sam" signs in through that connection
    Then a request is still made, because the connection already decided they may come in
    And the organization's join policy was never consulted

  @unit
  Scenario: Somebody who is already a member is nothing to admit and nothing to ask about
    Given "ana" is already a member of "acme"
    When she signs in through the connection to test it
    Then no request is made and nothing is sent to anybody
    And her membership is exactly as it was

  # The failure that has to stay findable. An administrator whose queue is
  # empty is told to look for the line saying an arrival was not admitted —
  # so the routine outcomes must not be filed as that same kind of problem,
  # or the one line worth reading is buried under thousands that are not.
  @unit
  Scenario: An arrival already in the queue is recorded as routine, not as a failure
    Given "sam" already has a PENDING request to join "acme"
    When "sam" signs in through the connection again
    Then it is recorded as an ordinary outcome rather than as something that went wrong
    But an arrival that failed for a reason nobody expected is still recorded as a failure

  # ── An offer that is over ──────────────────────────────────────────────

  @unit
  Scenario: Saying no thanks is remembered for that domain and no other
    Given "sam" was offered "acme" on their "acme.com" address and dismissed it
    When "sam" is offered somewhere on a different verified address
    Then that other offer still stands
    And only "acme.com" is remembered as dismissed

  # A dismissed offer must answer with the same nothing every other closed
  # door answers with. Anything distinguishable would tell somebody which
  # domains have an organization behind them.
  @unit
  Scenario: A dismissed offer reads exactly like no offer at all
    Given "sam" dismissed the offer to join on their "acme.com" address
    When the offer is looked for again
    Then there is nothing to show
    And it is the same nothing a domain with no organization behind it answers with

  # ── Where an admin answers ─────────────────────────────────────────────

  @integration
  Scenario: Requests wait beside invitations in the members area
    Given "acme" has pending invitations and "sam"'s pending request
    When "ana" opens the members area
    Then the pending requests and the pending invitations are in one panel
    And each request shows who is asking and when they asked

  # An empty panel is not the same as a panel that failed to load, and from
  # the browser they look identical. A tab somebody opened on purpose owes
  # them a sentence either way.
  @integration
  Scenario: An empty request list says it is empty
    Given "acme" has nobody waiting to join
    When "ana" opens the members area
    Then the panel says nobody is waiting rather than rendering blank
    And there is nothing to approve or reject

  @unit
  Scenario: Answering a request needs the authority that already gates inviting
    Given a member of "acme" who cannot invite colleagues
    When they try to approve or reject "sam"'s request
    Then the attempt is refused for lack of permission
    And no new permission had to be granted to anybody for approvals to work

  # ── The flag is retired ────────────────────────────────────────────────
  #
  # `JOIN_REQUESTS` gated the whole deliverable through its bake and is gone.
  # What it actually turned off was an offer that had already passed every
  # other gate — a verified address, a company domain, an organization that
  # opted in and that the caller is not already in — so keeping it meant a
  # second, blunter answer to a question the matching rules answer precisely.
  # The rollback lever customers have is the setting on their own Access page,
  # which is where it belongs.
