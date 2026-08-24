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

  # Confirming the address does NOT gate the app (revises ADR-117 §6, which
  # had the link come first and the account exist only once it came back).
  # Waiting on an inbox to get in is a wall in front of the thing somebody came
  # to do, and it is a wall that pays for nothing: the address is still
  # unproven either way, and everything that actually TRUSTS the address is
  # gated on the identifier being verified rather than on the account existing.
  # Domain auto-join is the one that matters, and it already refuses an
  # unverified address (specs/identity/domain-auto-join.feature).
  #
  # So the account is made at sign-up and the confirmation follows it out.
  @integration
  Scenario: Sign-up creates the account and confirms the address afterwards
    When I sign up with my work email and choose a password
    Then my account is created and I am signed in
    And a confirmation link is sent without my having to wait for it

  # A passkey is a way to CREATE an account, not only a way back into one
  # (Passkey Central, "New account creation with a passkey"). The credential
  # step offers both, and the passkey sits above the password fields because it
  # is the better thing to leave with — beside them rather than in front of
  # them, so declining costs a glance and the other way on is already drawn.
  #
  # Creating the account only once the ceremony succeeds is what keeps an
  # abandoned attempt free: asking for options writes nothing down.
  @unit
  Scenario: Signing up with a passkey creates the account and the session together
    Given I have typed an address that has no account
    When I create a passkey instead of choosing a password
    Then my account is created and the passkey belongs to it
    And I am signed in without a second system prompt
    And a confirmation link is sent without my having to wait for it

  # THE one that matters. Registration without a session is what lets somebody
  # sign up with a passkey at all, and the same opening would otherwise let
  # anyone attach their own passkey to anybody's account by naming the address.
  @unit
  Scenario: A passkey is never registered against an address that already has an account
    Given the address I named already has an account
    When a passkey registration is started for it
    Then it is refused before any ceremony begins
    And no system prompt opens for it

  @unit
  Scenario: Declining the passkey leaves the password fields where they were
    When I dismiss the passkey prompt
    Then nothing is reported as having gone wrong
    And I can still finish by choosing a password

  # The address is the only personal data on these screens, and a query string
  # is written down by every hop it passes: access logs, proxies, error
  # reports, and the `Referer` of whatever is loaded next. The fragment is the
  # one part of a URL the browser keeps to itself.
  @unit
  Scenario: An address carried between the two screens never reaches the server
    Given I typed my address on the log-in screen
    When I follow the link to sign up instead
    Then the address is carried in the URL fragment, not the query
    And the sign-up screen prefills it and takes it back out of the address bar

  # The nudge and its resend live in the signed-in shell rather than the front
  # door, so they are a slice of their own. Tagged honestly until that slice
  # lands: an untagged scenario would report itself bound and enforce nothing.
  @unimplemented
  Scenario: An unconfirmed address is named in the app, with a way to resend
    Given I signed up and have not opened the confirmation link
    Then the app tells me the address is unconfirmed
    And it offers to send the link again

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

  # The password is chosen ONCE, on the screen the confirmed link lands on,
  # where it is typed twice and held to a length. The log-in form's password
  # field is spelled `current-password` and asked for once; banking whatever
  # was typed into it meant the same account could be created two ways, and
  # the log-in way took a single character and never asked twice.
  @integration
  Scenario: A password typed at the log-in door never becomes an account's password
    Given I enter an address nobody holds an account for
    When I submit a password on the log-in screen
    Then only my address is sent to start the sign-up
    And I choose my password after the address is confirmed, like every sign-up

  # The commonest reason to be staring at "check your email" is that the
  # address on it is wrong. The step lives in memory rather than in the URL,
  # so the browser's own back button is not a way out of it.
  @integration
  Scenario: Going back from a sent link returns to the address step
    Given a confirmation link has been sent to the address I typed
    When I say the address was wrong
    Then I am returned to the address step, not to the password step
    And the link that went out simply expires unopened

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
