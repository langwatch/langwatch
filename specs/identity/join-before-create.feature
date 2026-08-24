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
  # Ships behind JOIN_REQUESTS, rendered by screens behind IDENTITY_ROUTER_V2.

  Background:
    Given the first-party sign-up screens are enforced
    And "sam" is signing up with "sam@acme.com"

  # ── The order of the two offers ────────────────────────────────────────

  @integration @unimplemented
  Scenario: Sign-up offers the team before offering a workspace
    Given an organization "acme" open to requests from "acme.com"
    When "sam" completes verification
    Then joining "acme" is the leading action
    And creating a new organization is there as the explicit secondary choice
    And "acme" is named with a rounded count of colleagues, nothing more

  @integration @unimplemented
  Scenario: With nothing to offer, sign-up continues exactly as before
    Given no organization is open to "acme.com"
    When "sam" completes verification
    Then the step renders nothing and "sam" continues to create a workspace

  @integration @unimplemented
  Scenario: Automatic joining skips the step entirely
    Given "acme" admits verified colleagues on "acme.com" automatically
    When "sam" completes verification
    Then "sam" is already a member of "acme" when the next screen paints
    And no join offer and no workspace creation step is shown

  @unit @unimplemented
  Scenario: The step never runs before the address is verified
    Given "sam" has typed the address but not verified it
    When the sign-up flow reaches this point
    Then nothing is looked up and nothing is offered
    And no organization name has been sent to the browser

  # ── The invariant ──────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: No organization is created for somebody who did not ask for one
    Given an organization "acme" open to requests from "acme.com"
    When "sam" completes verification and asks to join "acme"
    Then "sam" belongs to no organization while the request is open
    And no workspace was created on "sam"'s behalf at any point

  @integration @unimplemented
  Scenario: A waiting requester can still create a workspace, deliberately
    Given "sam" has a PENDING request to join "acme"
    When "sam" signs in
    Then the screen says the request is waiting on "acme"'s admins
    And creating an organization anyway is offered as a plain, explicit choice
    And taking it creates exactly one organization and leaves the request open

  @integration @unimplemented
  Scenario: Approval reaches somebody who created a workspace while waiting
    Given "sam" created an organization while a request to "acme" was open
    When "ana" approves the request
    Then "sam" is a member of both
    And "sam" is told, and lands in "acme"

  # ── Existing users ─────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: An existing user is offered their colleagues once, and can dismiss it
    Given "sam" already has an account and a verified "acme.com" address
    And "acme" is open to requests from that domain
    When "sam" signs in
    Then the offer appears once for that domain
    And dismissing it stops it appearing again for that domain

  @integration @unimplemented
  Scenario: Creating an organization on a matching domain is nudged, never blocked
    Given "sam" is an existing user whose domain matches "acme"
    When "sam" opens the create-organization screen
    Then a soft notice says "acme" is already here and offers joining instead
    And creating the organization is still available and still completes

  # ── What the operator can see ──────────────────────────────────────────

  @unit @unimplemented
  Scenario: Organizations nobody meant to create are countable before the flag flips
    Given organizations created by people who joined another organization on
      the same domain within thirty days
    When the sign-up health reporting is read
    Then those organizations are reported as the rate this step exists to reduce
    And the rate is readable for the period before the flag was turned on
