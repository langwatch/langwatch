Feature: Passkeys - the fastest way in, and the one phishing cannot take
  As a person signing in to LangWatch
  I need to sign in with the passkey my device already holds, name it, and
  remove it when the device goes
  So that the quickest sign-in is also the strongest one, and an organization
  that requires a second step does not have to ask me for one

  # D07 (delivery plan Wave 3; dev/docs/identity-platform/D07-passkeys.md).
  # A passkey is a FIRST factor here, never a second one. Ceremonies belong
  # to the WebAuthn plugin; we never reimplement the verification.
  #
  #   register   settings ──► the device performs the ceremony ──► verified
  #                             └──► Identifier row, provider "passkey"
  #   sign in    email ──► method picker ──► passkey
  #              no email ──► the device offers whatever it already holds
  #   remove     settings ──► the identifier detach guards decide
  #
  # Protocol state lives in the plugin's own table (credential id, public
  # key, counter, transports, whether it is backed up). The mirror
  # `Identifier` row is pure event-truth like every other identifier: it is
  # written by the fold from the ceremony's events, never by a handler, and
  # replay rebuilds it whole-row (specs/identity/identifier-model.feature).
  # The identity vocabulary already carries "passkey" as a provider and the
  # sign-in router already treats it as a local method, so nothing about
  # routing changes - only that the method now exists.
  #
  # ── Open Q4 is decided: a passkey satisfies a two-step requirement ─────
  #
  # `mfaRequired` is a membership condition - "every member of this
  # organization can prove a second factor" (D06) - and a passkey is one of
  # the three ways to prove one, beside a setup on the account and an
  # identity provider that asserts a factor. A person who signs in with a
  # passkey is never held at the enrollment gate.
  #
  # A passkey is something you have, and it cannot be handed to a convincing
  # website - which is precisely the attack the requirement exists to stop,
  # and precisely the attack an authenticator code does NOT stop. A passkey
  # synced across a person's devices is weaker than one bound to a single
  # piece of hardware, and still at least as strong as a code typed off a
  # screen, so it does not change the answer.
  #
  # It satisfies the requirement per SIGN-IN, not for the account: the
  # passkey proved itself on the session it minted, and a password sign-in
  # by the same person is a different sign-in that proves nothing extra. So
  # a person whose only second factor is a passkey still meets the gate when
  # they sign in another way - and signing in with the passkey is the
  # shortest way through it.
  #
  # Out of scope until somebody asks for it: an organization-level "keys
  # bound to one device only" refinement. Nothing here forecloses it - the
  # session already records what was proven, so the refinement is a policy
  # reading a claim that exists.
  #
  # Everything ships behind PASSKEYS_ENABLED, which defaults off. The
  # rollback is the flag; nothing about it is one-way.

  Background:
    Given an organization "acme" with a member "sam"
    And the identity pipeline is registered with the event-sourcing framework
    And passkeys are available behind their flag

  # ── Registering ────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Registering a passkey from settings adds a way in
    Given "sam" is signed in
    When "sam" registers a passkey from their security settings
    Then the passkey appears in "sam"'s list of sign-in methods
    And "sam" can sign in with it from then on

  @unit @unimplemented
  Scenario: A registered passkey becomes an identifier like every other method
    When "sam" completes a passkey registration ceremony
    Then an identifier_attached event is appended under tenant "sam" for a passkey
    And the fold applies it to the Identifier projection
    And the identifier is VERIFIED, because the ceremony is the proof

  @unit @unimplemented
  Scenario: Nothing the ceremony produced enters the event log
    When "sam" completes a passkey registration ceremony
    Then no event carries the public key, the raw credential identifier or anything the device signed
    And what the plugin stores stays in the plugin's own table

  @unit @unimplemented
  Scenario: Replay rebuilds the passkey identifiers identically
    Given "sam" registered two passkeys and removed one
    When the Identifier projection is rebuilt from the event log alone
    Then every rebuilt row equals the live row, whole-row

  @integration @unimplemented
  Scenario: A passkey is named, and the name can be changed
    When "sam" registers a passkey
    Then a name is suggested from what the device reported
    And "sam" can replace that name with their own
    And the list shows the name, when it was added and when it was last used

  @unit @unimplemented
  Scenario: Registering the same passkey twice does not make a second one
    Given "sam" already registered a passkey on this device
    When the same credential is registered again
    Then "sam" still holds exactly one identifier for it
    And nothing is duplicated in the list

  @integration @unimplemented
  Scenario: Both kinds of authenticator register, and the list says which
    When "sam" registers a passkey held by the device itself
    And "sam" registers a passkey held by a separate security key
    Then both appear in the list
    And each says whether it lives on this device or travels separately

  @unit @unimplemented
  Scenario: A ceremony that does not complete leaves nothing behind
    When "sam" starts registering a passkey and the ceremony fails
    Then no identifier is created and no event is appended
    And the refusal carries the code "identity_passkey_ceremony_failed"
    And "sam" is told to try again or use another way in

  @integration @unimplemented
  Scenario: A browser that cannot do the ceremony says so instead of failing silently
    Given "sam" is on a browser with no passkey support
    When "sam" opens their security settings
    Then registering a passkey is not offered
    And the screen names the other ways "sam" can sign in

  # ── Signing in ─────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A passkey is one of the methods the picker offers
    When an email with no identity provider behind it reaches the method picker
    Then a passkey is one of the offered methods
    And it sits alongside the other methods the instance offers

  # The no-oracle guarantee is specs/identity/signin-router.feature's and
  # specs/identity/signin-signup-screens.feature's; adding a method must not
  # be the thing that breaks it.
  @integration @unimplemented
  Scenario: The picker offers a passkey whether or not an account exists
    When two visitors enter a registered and an unregistered email
    Then both pickers offer a passkey, identically, from the same one request
    And nothing about the offer says whether an account exists

  @integration @unimplemented
  Scenario: Signing in with a passkey from the picker
    Given "sam" holds a registered passkey
    When "sam" enters their email and chooses the passkey method
    Then the device performs the ceremony and "sam" is signed in

  @integration @unimplemented
  Scenario: Signing in with no email typed at all
    Given "sam" holds a registered passkey on this device
    When "sam" asks to sign in with a passkey before entering any email
    Then the device offers what it already holds for LangWatch
    And choosing it signs "sam" in without an email ever being typed

  @unit @unimplemented
  Scenario: A passkey sign-in mints a session that records what was proven
    When "sam" signs in with a passkey
    Then the session records that a phishing-resistant method was proven
    And the session records which of "sam"'s sign-in methods minted it

  @unit @unimplemented
  Scenario: A passkey nobody holds is refused without telling anyone anything
    When a sign-in is attempted with a credential no user holds
    Then the refusal carries the code "identity_passkey_not_recognized"
    And the refusal is the same whatever the credential was
    And the precise reason goes to the log line instead

  @unit @unimplemented
  Scenario: A detached passkey stops signing anybody in
    Given "sam" removed a passkey and its identifier is a tombstone
    When a sign-in is attempted with that credential
    Then it is refused
    And the tombstone still resolves for anyone reading "sam"'s history

  @integration @unimplemented
  Scenario: Cancelling the device prompt is not a dead end
    Given "sam" chose the passkey method
    When "sam" dismisses the device prompt
    Then the picker is still on screen with every other method usable
    And nothing tells "sam" they have failed at anything

  # ── A passkey and an organization that requires two steps ──────────────

  @unit
  Scenario: A passkey satisfies an organization's two-step requirement
    Given "acme" requires two-step verification
    And "sam" has no two-step verification set up on their account
    When "sam" signs in with a passkey
    Then "acme"'s data is reachable immediately
    And "sam" is not held at the enrollment gate

  @unit
  Scenario: A passkey held on the person's own devices satisfies it the same way
    Given "acme" requires two-step verification
    And "sam"'s passkey is one their devices keep in sync
    When "sam" signs in with it
    Then "acme"'s data is reachable immediately, exactly as any other passkey's is

  # The gate itself belongs to
  # specs/identity/mfa-and-session-shape.feature. Named here to say that
  # deciding a passkey is enough does not weaken anything else.
  @unit
  Scenario: Holding a passkey does not carry over to a password sign-in
    Given "acme" requires two-step verification
    And "sam" holds a passkey and a password, and has set nothing up on their account
    When "sam" signs in with the password instead
    Then "sam" is held at the enrollment gate for "acme"
    And signing in with the passkey is offered as the shorter way through
    And setting two-step verification up on the account is the other way

  @unit
  Scenario: A passkey is never asked for as a second step
    Given "sam" has two-step verification set up on their account
    When "sam" signs in and is challenged
    Then the challenge asks for an authenticator code or a backup code
    And a passkey is not one of the things it asks for
    And registering a passkey never counts as setting two-step verification up

  # ── Removing ───────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Removing a passkey from settings
    Given "sam" holds a passkey and another verified way in
    When "sam" removes the passkey
    Then it disappears from the list
    And "sam"'s other ways in keep working

  @unit
  Scenario: Removing the last way in is refused
    Given "sam"'s only verified sign-in method is a passkey
    When "sam" tries to remove it
    Then the refusal carries the code "identity_detach_strands_user"
    And the screen tells "sam" to add another way in first
    And the passkey still works

  @unit
  Scenario: Removing is refused when nothing is left to recover with
    Given "sam" holds two passkeys and no verified email address
    When "sam" tries to remove one of them
    Then the removal is refused because losing the other would leave no way back
    And the screen names adding a verified email address as the way forward

  # An account whose only way in is one device is one lost phone from a
  # support ticket, and the recovery that would rescue it does not work on its
  # own: password reset updates a credential row in place, so an account that
  # never had a password matched nothing and was told the reset had worked.
  #
  # Setting a first password is therefore part of holding a passkey, not an
  # argument against it.
  @unit
  Scenario: An account with no password can set a first one
    Given "sam" signed up with a passkey and has never had a password
    When "sam" opens their sign-in methods
    Then they are offered a password to set, not a password to change
    And setting one asks for no current password, because there is none

  # The refusal that makes the offer safe to make. Setting a password takes no
  # proof beyond the session, so it must never be able to REPLACE one: that
  # would turn a stolen session into a credential that survives revoking it.
  @unit
  Scenario: Setting a password can never overwrite one
    Given "sam" already has a password
    When a request tries to set a first password anyway
    Then it is refused and the existing password is untouched

  @unit
  Scenario: A new password ends every other session
    Given "sam" is signed in on two devices and has no password
    When "sam" sets one
    Then the other device is signed out

  # The detach guards are specs/identity/identifier-model.feature's. A
  # passkey is an identifier, so it gets no guard of its own.
  @unit
  Scenario: Removal follows the same guards as every other identifier
    When a passkey is removed
    Then the guards that govern every identifier are the ones that decide it
    And no guard has a passkey-shaped exception in it

  @unit @unimplemented
  Scenario: A removed passkey leaves a tombstone, not a hole
    Given "sam" holds a passkey and another verified way in
    When "sam" removes the passkey
    Then the identifier stays as DETACHED with the moment it was removed
    And the plugin's own record of the credential goes with it

  @integration @unimplemented
  Scenario: Removing a passkey does not end the session it minted
    Given "sam" signed in with a passkey and holds another way in
    When "sam" removes that passkey
    Then "sam" stays signed in
    And ending the session is offered as a separate, explicit action

  # ── Failures read as words ─────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Every named failure has copy a first-time reader understands
    When registering, signing in with, or removing a passkey is refused with a named code
    Then the screen shows the copy registered for that code
    And the screen never shows the code itself or an internal error
    And no message names a credential identifier, a table or a service

  @unit @unimplemented
  Scenario: A failure we cannot name stays unnamed
    When a passkey ceremony fails for a reason nothing anticipated
    Then no invented code is attached to it
    And the screen says it did not go through, with a trace identifier
    And the real cause is logged

  # ── The flag ───────────────────────────────────────────────────────────

  @unit
  Scenario: With the flag off, passkeys do not exist
    Given the passkey flag is off
    When the method picker is rendered and the security settings are opened
    Then no passkey is offered, registered or accepted
    And every other sign-in method behaves exactly as it did before

  @unit @unimplemented
  Scenario: Turning the flag off leaves registered passkeys alone
    Given members of "acme" registered passkeys
    When the flag is turned off
    Then no passkey is deleted and no identifier is detached
    And turning it back on offers the same passkeys again
