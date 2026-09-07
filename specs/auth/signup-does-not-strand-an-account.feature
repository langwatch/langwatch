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
  # Amended at D13 (ADR-117 §6): under the identifier-first screens the
  # mechanism changes and the guarantee does not. Signing up with an address
  # that already has an account no longer refuses at all - the page quietly
  # becomes the log-in step for that address, with the reset link on the same
  # card - so the door into a half-created account is wider than it was, never
  # narrower.
  #
  # Amended again now the flip is done and the old screens are deleted. Four
  # scenarios here described that screen's recovery: fill the same email and
  # password in a second time and be signed in rather than walled. There is no
  # form to fill in twice any more - the address is confirmed before a password
  # is ever asked for, which is what stops the account being half-created in
  # the first place. They are gone rather than rewritten, because the screen
  # they described is gone; what replaced them is bound in
  # specs/identity/signin-signup-screens.feature ("Sign-up with an address that
  # already has an account becomes a log-in").
  #
  # What remains here is the half nothing about the screens changed: the server
  # refusing, adopting or reviving an address, whoever asked.

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

  @unit
  Scenario: Only the same browser can continue an unfinished passkey sign-up
    Given a passkey sign-up left an unconfirmed account and its browser retained the claim
    When that browser retries with the same normalized address and claim
    Then it adopts the unfinished account and does not create another

  @unit
  Scenario: Another browser cannot claim an unfinished passkey sign-up
    Given a passkey sign-up left an unconfirmed account for another browser
    When a different browser presents a distinct claim for the same address
    Then adoption is refused and the unfinished account is unchanged

  @unit
  Scenario: Legacy unfinished accounts without a claim are not publicly adoptable
    Given an unfinished passkey account predates browser claims
    When any browser presents a claim for its address
    Then adoption is refused and the ordinary recovery path remains available

  @integration
  Scenario: Concurrent browsers cannot both claim one free address
    Given two browsers hold distinct claims for the same free address
    When both complete passkey registration concurrently
    Then exactly one creates and owns the pending account
    And the other is refused without adopting it

  @integration
  Scenario: Client session flags cannot bypass address confirmation
    Given a new local account is awaiting address confirmation
    When a client requests passkey registration with createSession enabled
    Then session creation is refused until a valid emailed proof is consumed

  @integration
  Scenario: Pending password sign-in cannot mint a session
    Given a new password account is awaiting address confirmation
    When its correct password is submitted through the sign-in handler
    Then the handler refuses session creation with no cookie or session row
    And a legacy unverified account not carrying the pending latch keeps its existing behavior

  @unit
  Scenario: Raw password sign-up cannot bypass confirmed registration
    When a client calls BetterAuth's raw password sign-up route
    Then the route is unavailable in favor of the confirmed registration flow

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
