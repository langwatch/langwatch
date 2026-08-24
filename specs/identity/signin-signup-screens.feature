Feature: The first-party sign-in and sign-up screens - the front door is ours
  As a person arriving at LangWatch signed out
  I need every screen I can touch to be first-party, honest about failures,
  and to offer joining my team before creating a workspace
  So that no journey depends on Auth0-hosted pages and no organization is
  minted that nobody meant to create

  # D13 (ADR-117). The screens render the router's decisions and never
  # contain routing logic: every screen state is keyed by a routing reason
  # code, the same vocabulary the ops surface reads. Ships dark behind
  # IDENTITY_ROUTER_V2 and appears at the enforce flip together with D03.
  #
  #   /auth/signin            email step → routed outcome (picker | redirect)
  #   /auth/signin?local=1    self-hosted break-glass local login
  #   /auth/signup            email → verification → method → join-before-create
  #   /auth/reset[/<token>]   password reset request + completion
  #   /auth/verify/<token>    verification states (sent · verified · expired)
  #   /invite/<code>          invitation acceptance (logic from D11)
  #   /auth/join              join-before-create interstitial (content from D12)
  #
  # Unified email-first funnel: logging in and signing up are ONE flow, and a
  # dead end in either converts to the other door rather than refusing. Signing
  # up with an address that already has an account quietly becomes logging in;
  # a password typed for an address nobody holds becomes a sign-up, confirmed
  # by email. The account-existence no-oracle is therefore retired at the
  # SCREEN level (ADR-117 §6, Revision 2026-08-24): the router decision stays
  # existence-independent, and the picker still renders the same methods for
  # any address, because both are instance and organization data.
  #
  # Anchors that keep holding on the new screens:
  # specs/auth/sign-in-failure-messages.feature (failures say why),
  # specs/auth/signup-does-not-strand-an-account.feature (half-created
  # accounts stay reachable; sign-up may say an email is registered - the
  # no-oracle invariant is scoped to sign-in and reset, epic Q12).

  Background:
    Given the identifier-first router and screens are enforced

  # ── Sign-in ────────────────────────────────────────────────────────────

  @integration
  Scenario: The email step renders the routed outcome
    When I enter my email on the sign-in screen
    Then a domain-routed decision sends me to my identity provider
    And any other decision shows the method picker the decision named

  # Scoped to the PICKER, which is instance and organization data: the methods
  # offered, and the one request that fetches them, cannot differ by address.
  # What happens after a method is used may converge to the other journey, and
  # the two scenarios below say so.
  @integration
  Scenario: The picker looks the same whether or not my account exists
    When two visitors enter a registered and an unregistered email
    Then both see the same picker, with the same methods, from the same one request
    And the picker itself says nothing about whether an account exists

  @integration
  Scenario: A deny decision explains itself in words from the registry
    When my sign-in is refused with a routing reason code
    Then the screen shows the customer copy registered for that code
    And the screen never shows the code itself or an internal error

  # The no-loop and IdP-sign-out recovery guarantees stay owned by
  # specs/auth/sso-wrong-provider-recovery.feature; this screen renders them.
  @integration
  Scenario: Wrong-method guidance points at the method my account holds
    Given my account belongs to my organization's SSO provider
    When I try to sign in with a different method for the same email
    Then the screen names my organization's sign-in method as the way in

  # ── Sign-up ────────────────────────────────────────────────────────────

  @integration
  Scenario: Sign-up verifies the email before any method is chosen
    When I start sign-up with my work email
    Then I am asked to verify the address before choosing a method
    And the method choice reuses the same picker the sign-in screen shows

  # The interstitial's CONTRACT ships with D13 and is bound below (verified
  # email in, decision out, nothing rendered when there is nothing to offer).
  # Which organizations will take an address, and the words that go with them,
  # are D12's - so this stays parked until D12 fills the seam.
  @integration @unimplemented
  Scenario: Sign-up offers my team before offering a new workspace
    Given my verified domain matches an organization that allows joining
    When I complete verification
    Then joining that organization is the leading action
    And creating a new organization is the explicit secondary choice

  @integration
  Scenario: With no match, sign-up proceeds to workspace creation
    Given my verified domain matches no organization
    When I complete verification
    Then the interstitial renders nothing and I continue to create a workspace

  # ── No dead ends: the two doors converge ───────────────────────────────

  @integration
  Scenario: Sign-up with an address that already has an account becomes a log-in
    Given I start signing up with an address that already has an account
    When the address step resolves
    Then the page becomes the log-in step with my address already in it
    And no notice, banner or refusal about an existing account is shown

  @integration
  Scenario: Signing in without an account creates it through verification
    Given I enter an address nobody holds an account for
    When I submit a password on the log-in screen
    Then I am told a link is on its way to finish setting up my account
    And a wrong password for an address that does have one still says so

  # ── The screens are one surface ────────────────────────────────────────

  @integration
  Scenario: The method last used on this device is badged, never reordered
    Given I signed in on this browser before
    When the picker renders
    Then the method I used is badged as the last one used
    And the methods stay in the order the decision named

  @integration
  Scenario: The address and password fields cooperate with password managers
    When I move from the address step to the method step
    Then the address is still in the form, spelled as a username
    And the password field says whether it is a current or a new password

  @integration
  Scenario: A rejected field says what to fix, next to the field
    When a value I typed is refused
    Then the complaint appears next to the field that caused it
    And it says what to change rather than that something went wrong

  @integration
  Scenario: A rate-limited log-in says how long, and stops asking
    Given the installation has stopped accepting attempts for now
    When my sign-in is refused for it
    Then the screen says how long is actually left, from the answer it got
    And the submit stands down until the wait is over

  # The surrounding panel is the hosted product's case, and it is composed
  # AROUND the card rather than into it: the component that authenticates a
  # person is the same one on every installation, and an installation with
  # nothing to sell renders none of it. Below the split it collapses to the
  # headline, because a tagline and a logo row above a log-in form on a phone
  # are two screens of scrolling in front of the thing the person came to do.
  @integration
  Scenario: The hosted front door makes its case beside the card, never inside it
    Given a hosted deployment
    When the front door renders
    Then the headline and its tagline stand in their own panel beside the card
    And a company's own installation shows the card with nothing beside it

  # The card is live from the first frame; the entrance only decides what is
  # painted while the first keystroke is being typed, and when focus is taken.
  @integration
  Scenario: The entrance plays once, and never in front of a keystroke
    When the front door paints for the first time after the loading screen
    Then the mark it was showing arrives in the card and the rows rise behind it
    And it plays once for the page, not once per screen
    And nothing moves at all when less motion has been asked for

  # ── Password reset and verification states ─────────────────────────────
  # The reset flow's no-oracle response and revoke-all-sessions guarantees
  # stay owned by specs/auth/password-reset.feature; the half-created-account
  # recovery stays owned by specs/auth/signup-does-not-strand-an-account.feature.
  # Both anchors bind to the new screens unchanged.

  # Bound at the screen, which is where the deployment used to decide: the
  # reset is offered on an installation that signs in through a provider, and
  # the response is the same neutral sentence either way. That the reset then
  # completes, revokes every session and expires after one use is
  # password-reset.feature's, bound there and unchanged by the flip.
  @integration
  Scenario: Reset follows the identifier, not the deployment mode
    Given my account holds a password identifier on a cloud installation
    When I request a password reset
    Then the reset completes and my sessions are revoked
    And the reset link is single-use and expires

  @integration
  Scenario: An expired verification link offers a resend, nothing else
    When I open an expired verification link
    Then the screen says the link expired and offers to send a fresh one
    And the expired token verifies nothing

  # ── Invitation acceptance (renders D11's rules) ────────────────────────

  @integration
  Scenario: An invite landing shows who is asking and every way in
    When I open a valid invite link signed out
    Then I see the organization, the inviter, and the method picker
    And signing in or signing up carries the invite through untouched

  @integration
  Scenario: A signed-in visitor confirms and joins
    Given I am already signed in with a verified identifier matching the invite
    When I open the invite link
    Then I am asked to confirm joining, and confirming makes me a member

  @integration
  Scenario: An expired invite offers to ask for a new one
    When I open an expired invite link
    Then the screen offers to ask the inviter for a fresh invitation
    And a revoked invite ends the journey without naming details

  # ── The surface is ours ────────────────────────────────────────────────

  # Swept over the ENFORCED screens only, on purpose: the legacy path still
  # exists until the bake ends and still redirects to whatever provider the
  # deployment names, so sweeping it would fail on behavior the flag is meant
  # to keep. An identity provider is reached by dialling it from our own
  # origin; its pages are never rendered or linked.
  @integration
  Scenario: No unauthenticated journey touches an Auth0-hosted page
    When every unauthenticated journey is walked
    Then no page, asset, or redirect resolves to an Auth0-hosted surface

  @integration
  Scenario: The legacy screens return untouched when the flag is off
    Given the flag is turned off during the bake
    When the sign-in page is requested
    Then the legacy screens answer exactly as before the flip
