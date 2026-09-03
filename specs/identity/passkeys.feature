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
  # There is no setting. The plugin is mounted on every deployment, because a
  # deployment where the button exists and the endpoint does not is a state
  # nobody could be in on purpose.

  Background:
    Given an organization "acme" with a member "sam"
    And the identity pipeline is registered with the event-sourcing framework
    And passkeys are available

  # ── Registering ────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Registering a passkey from settings adds a way in
    Given "sam" is signed in
    When "sam" registers a passkey from their security settings
    Then the passkey appears in "sam"'s list of sign-in methods
    And "sam" can sign in with it from then on

  # The settings page starts the ceremony with no address attached: the
  # person is signed in, and the account is the one they are signed into.
  # Reading a sign-up context anyway refused the passkey they had just
  # created, on a page showing the very address it said was missing.
  @unit
  Scenario: Adding a passkey while signed in attaches it to that account
    Given "sam" is signed in
    When "sam" completes a passkey ceremony from their security settings
    Then the passkey is attached to "sam"'s account
    And no account is created and no address is asked for

  # ONE offer, two halves (D06 follow-up). A person is asked once about their
  # ACCOUNT rather than once about a passkey and again about two-step
  # verification: two dialogs on the way in is a nag whatever each one says,
  # and somebody who declines the first has answered the question the second
  # would ask. Each half keeps its own gate, and one dismissal covers both.
  @unit
  Scenario: The offer covers whichever of the two the person lacks
    Given "sam" holds no passkey and has not set up two-step verification
    And both are offered on this deployment
    When the signed-in shell asks what to offer "sam"
    Then both a passkey and two-step verification are offered
    And they are offered together, as one question about the account

  @unit
  Scenario: Each half disappears once the person has it
    Given "sam" has set up two-step verification but holds no passkey
    And both are offered on this deployment
    When the signed-in shell asks what to offer "sam"
    Then a passkey is offered and two-step verification is not

  @unit
  Scenario: Only what the deployment offers is offered
    Given two-step verification is offered here and passkeys are not
    And "sam" has neither
    When the signed-in shell asks what to offer "sam"
    Then two-step verification is offered and a passkey is not

  @unit
  Scenario: One dismissal answers the whole offer
    Given "sam" holds neither and has just said not now
    When the signed-in shell asks again the same day
    Then nothing is offered, about either of them
    But once the interval has passed the offer comes back

  # ADR-120's rule is that a passkey is offered where it REPLACES a password.
  # Somebody who just signed in through their employer's identity provider did
  # not type one and cannot stop typing one, and somebody who signed in with a
  # passkey already has the thing being offered — so the offer would be a
  # dialog in the way of the product with nothing behind it. What the session
  # recorded it proved (D06) is the answer, and a session that recorded nothing
  # is not read as a password.
  @integration
  Scenario: The passkey offer follows a password, not a federated sign-in
    Given "sam" holds no passkey and the offer is theirs to see
    When "sam" reaches the product having signed in with a password
    Then the offer is on screen
    But it is not shown at all when the sign-in was a passkey or an identity provider
    And it is not shown for a session that recorded no method

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

  @unit
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

  @integration
  Scenario: Cancelling the device prompt is not a dead end
    Given "sam" chose the passkey method
    When "sam" dismisses the device prompt
    Then the picker is still on screen with every other method usable
    And nothing tells "sam" they have failed at anything

  # The offer waiting in the address field has no abort handle, so a screen on
  # its way out cannot cancel the ceremony it started — and going away is
  # exactly what a sign-in that WORKED does. The tear-down is reported as a
  # refusal carrying the status that means "the server looked at this
  # credential and said no", so the last thing somebody saw after typing the
  # right password was a passkey they had never picked being turned down.
  @integration
  Scenario: Leaving the sign-in screen does not read as a passkey failure
    Given the passkey offer is waiting in the address field of the sign-in screen
    When "sam" signs in with their password and the screen navigates away
    Then the abandoned passkey ceremony shows no error
    And nothing about the sign-in that worked says anything went wrong

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

  @integration
  Scenario: Every named failure has copy a first-time reader understands
    When registering, signing in with, or removing a passkey is refused with a named code
    Then the screen shows the copy registered for that code
    And the screen never shows the code itself or an internal error
    And no message names a credential identifier, a table or a service

  @unit
  Scenario: A failure we cannot name stays unnamed
    When a passkey ceremony fails for a reason nothing anticipated
    Then no invented code is attached to it
    And the screen says it did not go through, with a trace identifier
    And the real cause is logged

  # ── Always there ───────────────────────────────────────────────────────

  @unit
  Scenario: A passkey is offered on every deployment, not on some of them
    Given any installation of LangWatch
    When the method picker is rendered and the security settings are opened
    Then a passkey can be registered and accepted
    And the endpoint behind every passkey button is mounted

  # A passkey is bound to a relying party at the moment it is created, and the
  # browser offers it back only to that one - which is exactly what makes it
  # unphishable, and exactly what breaks when we name the wrong one. Behind a
  # reverse proxy, and on every preview host, the address we dial ourselves on
  # is not the address the person's browser typed. The public one is the only
  # one the browser ever signed for.
  @unit
  Scenario: The passkey relying party is the deployment's public address
    Given a deployment whose internal address differs from its public one
    When better-auth's passkey plugin is configured
    Then the relying party id and origin are the public address
    And a passkey registered on the public host is recognized there
