Feature: Resilient invitations - any verified method gets you in, and expiry is recoverable
  As an organization admin inviting a colleague
  I need the invitation to work however my colleague signs in, and to be
  resendable in one click when it expires
  So that "invited by email, has a Google account, can't get in" stops
  being a support ticket

  # D11 (delivery plan Wave 2; needs only D01's identifiers - no ADR of its
  # own). OrganizationInvite stays a plain Prisma row with guarded
  # transitions - invites are org-admin CRUD with an expiry, not a
  # lifecycle worth a fold.
  #
  #   PENDING ──accept──► ACCEPTED          expiry: createdAt + 14 days
  #      │ └────expire──► EXPIRED ──resend──► PENDING (new code, old
  #      └─────revoke──► REVOKED              code revoked)
  #
  # Acceptance and resend each CLAIM the row with a conditional update on
  # the expected (status, inviteCode) pair, so two racers cannot both win.
  # Membership lands only through the grants ledger, whose attach skips
  # duplicates - a retried acceptance re-applies nothing. With this
  # landed, the WAITING_APPROVAL scenarios in
  # specs/members/update-pending-invitation.feature retire (epic Q13):
  # the state model above is complete, and member-initiated motivation
  # moves to D12's join requests.

  Background:
    Given an organization "acme" with an admin "ana"
    And "ana" invited "sam@acme.com" with role MEMBER

  # ── Identifier-aware acceptance ────────────────────────────────────────

  @integration
  Scenario: Acceptance works through any verified identifier matching the invite
    Given "sam" holds a VERIFIED Google identifier for "sam@acme.com"
    When "sam" signs in with Google and opens the invite
    Then the acceptance succeeds and "sam" becomes a member of "acme"
    And the invite records which identifier accepted it

  @integration
  Scenario: The wrong-method dead end is gone
    Given the invite targeted "sam@acme.com" expecting a password sign-up
    And "sam"'s account holds only a Google identifier for that address
    When "sam" signs in with what they have and opens the invite
    Then the acceptance succeeds without creating a second account

  @integration
  Scenario: A visitor with no account is guided through sign-up first
    Given no account holds "sam@acme.com"
    When "sam" opens the invite signed out
    Then they are guided to sign up with any offered method
    And the invite applies once the address is verified

  @unit
  Scenario: Acceptance requires verification and an exact normalized match
    Given "sam" holds an unverified identifier for "sam@acme.com"
    When "sam" tries to accept the invite
    Then the acceptance is refused until the identifier verifies
    And "Sam.J+x@Acme.com" matches only if it normalizes to the invite's address

  @integration
  Scenario: Membership lands exactly once however often acceptance retries
    Given "sam"'s acceptance already attached membership through the grants ledger
    When the acceptance is retried
    Then the grant tail re-applies nothing that already landed
    And "sam" is a member exactly once

  # ── Explicit states, resend, expiry ────────────────────────────────────

  @integration
  Scenario: An invitation expires visibly after fourteen days
    Given the invite has passed its expiry
    When "ana" views the members page
    Then the invite shows as EXPIRED with its expiry date
    And opening the invite link offers asking for a fresh invitation

  @integration
  Scenario: One click resends an expired invitation
    Given the invite is EXPIRED
    When "ana" resends it
    Then a new invite code is minted with a fresh fourteen-day expiry
    And the invitation goes out again the way this installation delivers invitations
    And the old code is revoked

  @unit
  Scenario: A leaked stale link dies on resend
    Given the invite was resent
    When anyone opens the previous invite link
    Then the old code is refused
    And nothing about the organization is revealed

  @unit
  Scenario: Two racers on one invitation cannot both win
    Given two acceptance attempts hold the same PENDING invite
    When both try to claim the row
    Then exactly one claims it with the conditional update
    And the loser sees a stale-code refusal, not a second membership

  @unit
  Scenario: A revoked invitation ends the journey quietly
    Given "ana" revoked the invite
    When "sam" opens the invite link
    Then the invite is refused without naming the organization or the inviter

  # License seat counting for expired invitations stays owned by
  # specs/licensing/enforcement-members.feature, which D11 aligns to the
  # new state model (delivery-plan amendment table).

  # ── The support pain, replayed ─────────────────────────────────────────

  @integration
  Scenario: The Google-linked invitee support case replays green
    Given the production case: invited by email, account linked to Google, SSO sign-in failing
    When the invitee signs in with their Google account and opens the invite
    Then they become a member without anyone archiving a user

  @integration
  Scenario: The invite-expired-mid-debug support case replays green
    Given the production case: an invite expiring while an account-linking loop was being debugged
    When the inviter resends in one click and the invitee accepts via any verified method
    Then they become a member without an ops action
