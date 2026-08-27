Feature: Signing up never strands an account
  As someone joining a colleague's LangWatch
  I want a sign-up that half-succeeded to still let me in
  So that I am not locked out of an account I cannot see, sign into, or report

  # Creating an account is two server calls: one writes the User row and its
  # password, the second exchanges those credentials for a session. Only the
  # first one is durable. When the second fails (a rate limit, an installation
  # set up for another address, a blip) the account exists and the person is
  # told nothing they can act on. Every retry then hits "that email is already
  # registered", which reads as a wall rather than as the door it actually is:
  # their own account, with the password they just chose. Meanwhile they hold no
  # organization membership, so the admin inviting them cannot find them on the
  # members list either, and neither side can move.
  #
  # The account is not the problem. Dead-ending on it is.
  #
  # Amended at D13 (ADR-117 §6): under the identifier-first auth screens the
  # mechanism changes and the guarantee does not. Signing up with an address
  # that already has an account no longer refuses at all - the page quietly
  # becomes the log-in step for that address, with the reset link on the same
  # card - so the door into a half-created account is wider than it was, never
  # narrower. The scenarios below stay bound to the screens that answer before
  # the flip; the new screen's behavior is bound in
  # specs/identity/signin-signup-screens.feature ("Sign-up with an address
  # that already has an account becomes a log-in").

  Background:
    Given a credentials installation
    And I am on the sign-up screen

  @integration
  Scenario: A sign-up whose second leg fails still says what happened
    Given creating my account succeeds
    But signing me in afterwards fails for a reason the screen has no wording for
    Then the screen tells me the account was created and to sign in
    And the screen never replaces that with a fixed "failed to sign up" line

  @integration
  Scenario: Submitting the same details again signs me in
    Given my previous attempt created my account and failed to sign me in
    When I fill the form in again with the same email and password
    Then I am signed in and continue to where I was heading
    And I am not told the email is already registered

  # An invite lands a signed-out visitor on the sign-in screen. Someone who was
  # a member before (removed, then invited back) still has their account, and
  # reaches for "Sign up" because that is what the invite asked them to do.
  @integration
  Scenario: An email that belongs to an account I cannot open points at the way in
    Given an account already exists for that email
    When I fill the form in with a password that is not its password
    Then the screen tells me an account with that email already exists
    And the screen offers me signing in and resetting my password
    And the screen never shows an internal error code

  # The recovery sign-in rides the same endpoint and rate limit as the sign-in
  # screen, so a refusal there is not a password problem and must not be
  # answered as one. Guessing is not cheaper through this door.
  @integration
  Scenario: A rate-limited recovery says to wait, not to reset the password
    Given an account already exists for that email
    When the sign-in attempt is refused for too many attempts
    Then the screen tells me to wait before trying again
    And the screen does not send me to reset my password

  @unit
  Scenario: The refusal carries a code the screen can act on
    When the server refuses a sign-up because the email is already registered
    Then it answers with the "email_already_registered" code
    And the code carries the wording a customer reads

  # Sign-in lowercases the address on every lookup, so an account stored as
  # typed, capitals and all, is one that sign-in can never find, no matter the
  # password. Autocapitalised addresses locked people out this way.
  # Signing up with a passkey is two server calls with a browser prompt
  # between them, and the account is written in the second. Nothing spans
  # them, so a failure after that write leaves a User row holding the
  # placeholder credential and no passkey: an account with no way in, that
  # nobody has ever signed into. Treating that row as "registered" burned the
  # address — sign-up called it taken while the sign-in screen said no account
  # existed, and both were reading the same row. The recovery for a write that
  # cannot be undone is one that can be repeated.
  @unit
  Scenario: A sign-up that died mid-ceremony leaves the address usable
    Given a passkey sign-up for my address wrote the account and then failed
    When I sign up with a passkey for that address again
    Then the ceremony starts rather than telling me the address is taken
    And finishing it signs me in to the account the first attempt left behind
    And I am counted as having signed up once, not twice

  # The other side of that boundary, and the reason the first one is safe:
  # an account anybody can reach holds a credential, and is still refused.
  @unit
  Scenario: An address whose account can be signed into is still refused
    Given an account for that address holds a password, a passkey, or a provider
    When somebody starts a passkey sign-up for it
    Then the ceremony is refused before any prompt opens

  @unit
  Scenario: A capitalised email creates an account sign-in can find
    When I sign up with "Joel.During@example.com"
    Then the account is stored with the lowercased address
    And a later sign-up for any casing of that address says it is already registered
