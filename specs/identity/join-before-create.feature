Feature: Join before create - the choice happens before an organization is minted
  As a person finishing sign-up with a work email
  I need to be offered my colleagues' organization before I am handed a fresh
  empty one
  So that nobody ends up alone in a workspace they never chose, and the long
  tail of abandoned single-person organizations stops growing

  # D12 filling the hook D13 left (ADR-117 §"Sign-up is verification-first").
  # specs/identity/signin-signup-screens.feature owns the screen and the
  # hook's contract - verified address in, interstitial decision out, nothing
  # rendered when there is nothing to offer. What is bound HERE is the
  # decision's content and the invariant that gives this deliverable its
  # second name.
  #
  #   verify address ──► what is open to it?
  #                        │
  #                        ├─ nothing ─────► create a workspace (as today)
  #                        ├─ automatic ───► already a member; no interstitial
  #                        └─ ask ─────────► JOIN <org>            (primary)
  #                                          create a new organization (secondary)
  #                                             │
  #                                          asked ──► waiting screen, and
  #                                                    creating one anyway is
  #                                                    still available, explicitly
  #
  # The invariant, and the reason this file exists apart from the lifecycle:
  # NO organization is created for anybody who did not choose to create one.
  # Today every sign-up mints one unconditionally, which is why production
  # carries thousands of single-person workspaces people abandoned the moment
  # they found their real team. This is the step that stops the bleeding; the
  # ones already there are a separate question.
  #
  # On for everybody — the JOIN_REQUESTS flag is retired (see
  # specs/identity/join-requests.feature) — and rendered by the sign-up
  # screen, which is now the only one.

  Background:
    Given the first-party sign-up screen
    And "sam" is signing up with "sam@acme.com"

  # ── The order of the two offers ────────────────────────────────────────

  @integration
  Scenario: Sign-up offers the team before offering a workspace
    Given an organization "acme" open to requests from "acme.com"
    When "sam" completes verification
    Then joining "acme" is the leading action
    And creating a new organization is there as the explicit secondary choice
    And "acme" is named with a rounded count of colleagues, nothing more

  @integration
  Scenario: With nothing to offer, sign-up continues exactly as before
    Given no organization is open to "acme.com"
    When "sam" completes verification
    Then the step renders nothing and "sam" continues to create a workspace

  @integration
  Scenario: Automatic joining skips the step entirely
    Given "acme" admits verified colleagues on "acme.com" automatically
    When "sam" completes verification
    Then "sam" is already a member of "acme" when the next screen paints
    And no join offer and no workspace creation step is shown

  @unit
  Scenario: The step never runs before the address is verified
    Given "sam" has typed the address but not verified it
    When the sign-up flow reaches this point
    Then nothing is looked up and nothing is offered
    And no organization name has been sent to the browser

  # ── An invitation that was already waiting ─────────────────────────────
  #
  # An administrator who invited somebody has already decided the seat and
  # the teams. Until now that decision only reached the person through the
  # link in the mail: somebody who signed up from the sign-in screen, or from
  # `langwatch login`, never saw it, asked to join instead, and the admin
  # answered a question they had already answered. The welcome screen now
  # looks for a pending invitation on the account's VERIFIED addresses and
  # leads with it. Accepting runs the invitation's own acceptance, so the
  # seat is the one the invitation names and the open request, if any, is
  # withdrawn the way it always was.
  #
  # Only on the welcome screen, which has no organization in view. The same
  # takeover sits on every dashboard, and an invitation offer or an automatic
  # admission there would cover a page somebody is working on, or quietly add
  # a member of one organization to another. Only VERIFIED addresses count,
  # with no fall-back to the session address: the invitation code is the
  # secret from the mail, and it is handed over only to somebody who has
  # proved they hold the address it was sent to. On an installation where
  # accounts are created by invitation only, the invitation screen already
  # runs before the welcome screen (specs/auth/sign-up-restriction.feature),
  # and nothing here is reached.

  @integration
  Scenario: A pending invitation is offered before asking to join
    Given "ana" invited "sam@acme.com" to "acme" as a Developer
    And "acme" is also open to requests from "acme.com"
    When "sam" completes verification and reaches the welcome screen
    Then accepting the invitation to "acme" is the leading action, naming the seat
    And asking to join is not offered beside it

  @integration
  Scenario: A pending invitation leads even while a request to join is open
    Given "sam" already asked to join "acme" and is waiting for an administrator
    And "ana" invited "sam@acme.com" to "acme" as a Developer
    When "sam" reaches the welcome screen
    Then accepting the invitation to "acme" is the leading action
    And the waiting screen does not stand in front of it

  @integration
  Scenario: Accepting the invitation from the welcome screen lands the invited seat
    Given "ana" invited "sam@acme.com" to "acme" as a Developer
    When "sam" accepts it from the welcome screen
    Then the invitation's own acceptance runs, so "sam" is a Developer in "acme"
    And the screen stays where it is and lets the welcome redirect carry on, the terminal's continuation included

  @integration
  Scenario: The invitation can be set aside without accepting it
    Given "ana" invited "sam@acme.com" to "acme"
    And "acme" admits verified colleagues on "acme.com" automatically
    When "sam" reaches the welcome screen and chooses to create a new organization instead
    Then the invitation screen steps aside and the welcome screen beneath is reachable
    And "sam" is not admitted to "acme" behind the invitation, which still stands

  @integration
  Scenario: A failed invitation lookup neither asks nor admits
    Given "acme" is open to "acme.com" by request or automatically
    And the lookup for "sam"'s pending invitations fails
    When "sam" reaches the welcome screen
    Then "sam" is neither offered to ask to join nor admitted to "acme"
    And the welcome screen beneath is reachable

  @integration
  Scenario: An invitation is only offered to somebody who proved the address
    Given "ana" invited "sam@acme.com" to "acme"
    And "sam" signed in with an account whose "sam@acme.com" address is not verified
    When "sam" reaches the welcome screen
    Then no invitation is offered

  @integration
  Scenario: The welcome screen honours an automatic door
    Given "acme" admits verified colleagues on "acme.com" automatically
    When "sam" signs up from "langwatch login" and reaches the welcome screen
    Then "sam" is admitted to "acme" without being offered anything
    And the request records that it was made from the terminal
    And a dashboard that already has an organization in view admits nobody

  # ── The invariant ──────────────────────────────────────────────────────

  @integration
  Scenario: No organization is created for somebody who did not ask for one
    Given an organization "acme" open to requests from "acme.com"
    When "sam" completes verification and asks to join "acme"
    Then "sam" belongs to no organization while the request is open
    And no workspace was created on "sam"'s behalf at any point

  @integration
  Scenario: A waiting requester can still create a workspace, deliberately
    Given "sam" has a PENDING request to join "acme"
    When "sam" signs in
    Then the screen says the request is waiting on "acme"'s admins
    And creating an organization anyway is offered as a plain, explicit choice
    And taking it creates exactly one organization and leaves the request open

  @integration
  Scenario: Approval reaches somebody who created a workspace while waiting
    Given "sam" created an organization while a request to "acme" was open
    When "ana" approves the request
    Then "sam" is a member of both
    And "sam" is told, and lands in "acme"

  # ── Existing users ─────────────────────────────────────────────────────

  @integration
  Scenario: An existing user is offered their colleagues once, and can dismiss it
    Given "sam" already has an account and a verified "acme.com" address
    And "acme" is open to requests from that domain
    When "sam" signs in
    Then the offer appears once for that domain
    And dismissing it stops it appearing again for that domain

  @integration
  Scenario: A pending join request can be left by signing out
    Given "sam" has a pending request to join "acme"
    When "sam" chooses to sign out from the waiting screen
    Then the application starts the normal sign-out flow

  @integration
  Scenario: A pending request for another organization does not block the current organization
    Given "sam" can access "acme" and has a pending request to join "ana"
    When "sam" opens "acme"
    Then "sam" can use "acme" without seeing the waiting screen

  @integration
  Scenario: Creating an organization on a matching domain is nudged, never blocked
    Given "sam" is an existing user whose domain matches "acme"
    When "sam" opens the create-organization screen
    Then a soft notice says "acme" is already here and offers joining instead
    And creating the organization is still available and still completes

  @integration
  Scenario: The step waits for its own answer before sending anybody anywhere
    Given "sam" has a verified "acme.com" address
    And the lookup for that domain has not answered yet
    When the join step is reached
    Then nothing is offered and nothing is decided
    And "sam" is not sent on to workspace creation
    And the offer appears as soon as the answer arrives

  @integration
  Scenario: A lookup that failed is not read as having found nothing
    Given "sam" has a verified "acme.com" address
    And the lookup for that domain fails
    When the join step is reached
    Then "sam" is told the check could not be made
    And creating an organization stays available as an explicit choice
    And "sam" is not sent on to workspace creation automatically

  # ── What the operator can see ──────────────────────────────────────────

  @unit
  Scenario: Organizations nobody meant to create are countable across the change
    Given organizations created by people who joined another organization on
      the same domain within thirty days
    When the sign-up health reporting is read
    Then those organizations are reported as the rate this step exists to reduce
    And the rate is readable for the period before this step existed
