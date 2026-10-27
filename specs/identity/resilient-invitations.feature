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

  @unit @regression
  Scenario: Accepted invitation grants name the original sender
    Given an invitation records its authenticated sender
    When the invitee accepts
    Then the access grants name the sender as their actor
    And an older invitation with no recorded sender uses the service actor

  @integration @regression
  Scenario: Admin invitations retain the authenticated sender across resend
    When an authenticated administrator creates an invitation
    Then the stored sender is that administrator
    And resending rotates the code without changing the sender
    And invitations created by a service without a user keep a null sender

  @integration
  Scenario: Organization-only member invitations persist without a team assignment
    When an authenticated administrator invites a member without naming a team
    Then one pending organization invitation is created
    And the invitation carries no team assignment

  @integration
  Scenario: Teamless external invitations are refused
    When an authenticated administrator invites an external member without naming a team
    Then no invitation is created

  @unit @regression
  Scenario: Invitations use the configured email provider
    Given SMTP is configured without a SendGrid key
    When invitations become ready to send
    Then the configured mail provider receives each invitation

  @unit
  Scenario: Invitation RPCs have one dedicated namespace
    When a client discovers the invitation procedures
    Then create, revoke, resend, list, and accept are available under "invite"
    And those procedures are not available under "organization"
    And the retired approval-request procedures are not restored

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

  # ── Buying time without minting a link ─────────────────────────────────

  # Extending and resending both keep an invitation usable, and they are not
  # the same act. A resend ROTATES the code, which is what kills a link that
  # leaked. An extension deliberately does not: it moves the deadline on the
  # link already in somebody's inbox, so the person who has been waiting does
  # not have to be sent anything new. Because the old link stays live, an
  # administrator reaching for this to deal with a leak has reached for the
  # wrong verb — so the difference is written down rather than left for
  # somebody to infer from an expiry date.

  @unit
  Scenario: Extending an invitation moves the deadline and leaves the link alone
    Given "sam" holds a pending invitation that runs out tomorrow
    When "ana" extends it
    Then the invitation runs for the full fourteen days again
    And the link already in "sam"'s inbox still works, because no new code was minted

  @unit
  Scenario: Extending is not how a leaked link is dealt with
    Given an invitation whose link has leaked
    When "ana" extends it
    Then the leaked link is still live, because extending mints nothing
    And killing it takes a resend, which rotates the code

  @unit
  Scenario: Only an invitation still waiting can be extended
    Given an invitation that was already accepted, revoked or expired
    When "ana" tries to extend it
    Then it answers as though there were no such invitation
    And which of the three it was is not revealed

  @unit
  Scenario: Two administrators extending at once extend it once
    Given "ana" and a colleague extend the same invitation at the same moment
    When the second one lands after the first has already changed it
    Then the second is refused rather than overwriting what the first did
    And the invitation carries one deadline, not the last one written

  # ── Signed in as somebody else ─────────────────────────────────────────

  # An invitation names an address. Somebody already signed in as a
  # different account is not refused for good - they are told which
  # account to use, in terms that help them recognize it without handing
  # the address to whoever is holding the link.

  @integration
  Scenario: The wrong account is told which account the invitation wants
    Given "sam" is signed in as "sam@personal.example"
    When "sam" opens the invite sent to "sam@acme.com"
    Then the invitation is not accepted
    And "sam" is told the invitation was sent to a different account
    And "sam" is offered a way to sign out and continue as the invited one

  @unit
  Scenario: The hint recognizes the address without spelling it out
    Given an invitation sent to "sam@acme.com"
    When somebody signed in as another account is shown the mismatch
    Then the hint keeps the domain and the first character
    And the rest of the address is hidden

  @integration
  Scenario: Signing out from the mismatch returns to the same invitation
    Given "sam" is signed in as the wrong account and sees the mismatch
    When "sam" takes the offered way out
    Then "sam" arrives at the auth screens with the invitation still in hand
    And accepting as the invited account makes "sam" a member

  # ── Asking again ───────────────────────────────────────────────────────

  @integration
  Scenario: The invitee can ask for a fresh invitation when theirs expired
    Given the invite expired
    When "sam" opens the invite link and asks for a new one
    Then the admins who can invite are told "sam" is waiting
    And "sam" is told the request reached them, without naming who they are

  @unit
  Scenario: Asking again is throttled per invitation
    Given "sam" already asked for a fresh invitation
    When "sam" asks again within the throttle window
    Then the second ask is refused as too soon
    And no second notification goes out

  @unit
  Scenario: Resending is throttled per invitation
    Given "ana" resent the invitation
    When "ana" resends the same invitation again within the throttle window
    Then the resend is refused as too soon
    And the invitation keeps the code the first resend minted

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

  # ── Two addresses, one person ──────────────────────────────────────────
  #
  # Somebody invites their own work address to the organization their
  # personal account founded, or the other way round. The two addresses are
  # one person the moment both are proven, so an invitation is matched
  # against every proven identifier the account holds rather than against
  # the one column a User row happens to carry. Nobody merges two accounts:
  # there was only ever one.

  @unit
  Scenario: An invitation reaches the person, not the address
    Given somebody holds more than one proven address
    When an invitation is sent to any one of them
    Then it matches that person
    And accepting it needs no second account and no merge
