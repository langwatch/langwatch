Feature: Authentication settings - every way in, in one place, with the guards visible
  As somebody who signs in to LangWatch
  I need to see which addresses my account is reachable at, add another one,
  and take one away
  So that I always hold a second way in, and the screen tells me before it
  refuses rather than after

  # Wave 3, the auth-screen remainder. The page is
  # /settings/security; the identifiers behind it are D01's
  # (`specs/identity/identifier-model.feature`), the detach guards are
  # `packages/identity-server/src/guards.ts`'s, and the passkeys beside them
  # are D07's (`specs/identity/passkeys.feature`).
  #
  # Two rules govern the whole surface.
  #
  # The first: an account is never left with one way in (ADR-119). The guard
  # that enforces it already exists and already refuses; what did not exist
  # was the DOOR its refusal points at. Its remediation copy says "add a
  # verified email address first", and until now there was nowhere to do
  # that. Adding one is therefore the same slice as surfacing the refusal.
  #
  # The second: a refusal a screen can predict is shown BEFORE the click, not
  # after it. Remove stands down, with the guard's own registered words on it,
  # where detaching would be refused. The guard is still the authority - the
  # route refuses whatever the screen drew - and the screen is only ever the
  # guard read out loud.
  #
  #   add      settings ──► attach (unverified) ──► emailed ceremony ──► VERIFIED
  #   confirm  the link completes only where it was started (PKCE, D01)
  #   remove   the detach guards decide, and the button says so first
  #   unlink   a confirmation naming what stays behind
  #
  # Nothing here invents an identifier state, a guard or a refusal code. Every
  # refusal on this page is one the identity model already carries.

  Background:
    Given an organization "acme" with a member "sam"
    And "sam" is signed in and opens their authentication settings

  # ── How the page is divided ────────────────────────────────────────────

  # A band per SUBJECT, not per feature. Passkeys and two-step verification
  # are one subject because our own model says so - a passkey satisfies an
  # organization's two-step requirement - and the addresses and the linked
  # accounts are one subject because the identity model holds both as
  # identifiers and the detach guard reasons across the whole set.
  @integration
  Scenario: The page is four sections, one per subject
    When the authentication settings are shown
    Then the page runs from what "sam" is known by, through the two proofs, to
    the password

  # The addresses and the providers are one species to the model - both are
  # identifiers, and the detach guard reasons across the whole set, so the same
  # refusal can come from either. One list and one row of offers; sub-headings
  # over each half split a list whose rows already say what they are, and made
  # one offer look like two.
  @integration
  Scenario: Email addresses and linked accounts sit under one heading
    When the authentication settings are shown
    Then the addresses and the identity providers are one section
    And adding an address and connecting a provider are offered on one row

  # ── One way in, said before it is too late ─────────────────────────────

  # The detach guard's own reasoning, read forwards. The guard refuses to
  # remove the last way in, which is help arriving at the worst moment: "sam"
  # is already down to one and only finds out on trying to tidy up. The same
  # fact, said in advance, is early enough to act on — and it is said inside
  # the section whose halves are the remedy, not in a summary of its own.
  @integration
  Scenario: An account with one way in is told so, where the remedy is
    Given the only way into "sam"'s account is one of them
    When the authentication settings are shown
    Then the section that adds another way in says so
    And it names what to add

  @integration
  Scenario: An account with more than one way in is told nothing
    Given "sam" holds two ways in
    When the authentication settings are shown
    Then nothing warns about being locked out

  # ── What the page says about an address ────────────────────────────────

  @integration
  Scenario: Each email address says whether it has been confirmed
    Given "sam" holds a confirmed address and an unconfirmed one
    When the sign-in addresses are listed
    Then the confirmed one is shown as confirmed
    And the unconfirmed one is shown as not confirmed yet

  @integration
  Scenario: An unconfirmed address offers to send its link again
    Given "sam" holds an address that has never been confirmed
    When "sam" asks for the link to be sent again
    Then the row says the link is on its way and names the address it went to
    And the row does not look the same afterwards as it did before

  @integration
  Scenario: A confirmed address offers nothing to resend
    Given every address "sam" holds is confirmed
    When the sign-in addresses are listed
    Then nothing offers to send a confirmation link

  # ── Adding another address ─────────────────────────────────────────────

  @integration
  Scenario: Adding a second address starts a confirmation rather than a sign-in method
    When "sam" adds a second email address
    Then a confirmation link is sent to it
    And the address appears in the list as not confirmed yet
    And nothing about the account can be recovered through it until it is

  @unit
  Scenario: A newly added address is attached unverified, and only the ceremony verifies it
    When "sam" adds a second email address
    Then an identifier is attached for it under tenant "sam"
    And it arrives unverified, because nothing has been proved about it yet
    And no verification event is appended until the emailed ceremony completes

  @unit
  Scenario: Adding an address already on the account changes nothing
    Given "sam" already holds an address
    When "sam" adds the same address again
    Then no second identifier is created for it
    And the account is told it is already there

  @integration
  Scenario: The confirmation link only completes where the ceremony was started
    Given "sam" added an address and a confirmation link went out
    When the link is opened in a browser that did not start the ceremony
    Then nothing is confirmed
    And the screen says to return to the window the request came from

  # Attaching is not claiming. An unverified identifier blocks nobody, so
  # refusing here would buy no protection and would answer "does an account
  # exist for this address" to anybody holding an account. The check belongs
  # at verification, where the same refusal is not an oracle.
  @unit
  Scenario: An address another account holds is not refused at the door
    Given another account already holds the address "sam" is adding
    When "sam" adds it
    Then nothing "sam" is told says whether anybody holds it
    And it can never become verified, because verifying is where that is decided

  # ── Removing an address ────────────────────────────────────────────────

  @integration
  Scenario: Removing an address that is not the last way in
    Given "sam" holds two confirmed addresses
    When "sam" removes one of them
    Then it disappears from the list
    And the other one still signs "sam" in

  @integration
  Scenario: Removing the last confirmed address is refused before it is clicked
    Given the only confirmed way in "sam" holds is one address
    When the sign-in addresses are listed
    Then removing it is not offered
    And the reason given is the words registered for "identity_detach_strands_user"

  @integration
  Scenario: Removing is refused where only passkeys and no address would be left
    Given "sam" holds one confirmed address and two passkeys
    When the sign-in addresses are listed
    Then removing the address is not offered
    And the reason names adding a verified email address as the way forward

  @integration
  Scenario: An address nobody could have signed in with stays removable
    Given "sam" holds one confirmed address and one that was never confirmed
    When the sign-in addresses are listed
    Then removing the unconfirmed one is offered
    And removing the confirmed one is not

  @integration
  Scenario: The primary address says it is demoted before it is removed
    Given "sam"'s primary address is not their only confirmed one
    When "sam" removes the primary address
    Then the screen says another address becomes primary first
    And both happen as one action from "sam"'s side

  # The guard is the authority and the button is only its echo, so the
  # ENDPOINT has to refuse whatever the screen happens to have drawn. Bound at
  # the route rather than at the guard, because a guard nobody reached is not
  # a guard.
  @integration
  Scenario: The detach route refuses the last way in whatever the screen drew
    Given the only confirmed way in "sam" holds is one address
    When a detach request for it reaches the route directly
    Then the route refuses it with the code "identity_detach_strands_user"
    And the copy the screen would show comes from that code

  # Tagged honestly rather than bound: a passkey has no mirror `Identifier`
  # row yet. D07 says one is maintained by the fold from the passkey ceremony's
  # events, and that wiring does not exist — no hook turns
  # `/passkey/verify-registration` into an attach or `/passkey/delete-passkey`
  # into a detach, and better-auth's `databaseHooks` cover its own models
  # rather than a plugin's. So the guard cannot see a passkey to refuse over,
  # and this route currently deletes the last one. The sibling scenario above
  # is bound, because the detach route DOES reach the guard.
  @integration @unimplemented
  Scenario: The passkey removal route refuses the last way in the same way
    Given "sam"'s only confirmed sign-in method is a passkey
    When a delete-passkey request reaches the route directly
    Then the route refuses it with the code "identity_detach_strands_user"
    And the passkey still signs "sam" in

  # ── The password, on its own ───────────────────────────────────────────

  # The password and the identity providers shared one section for as long as
  # both were rows of one database table. That is a fact about our storage and
  # never a fact about the person reading: a password is something you choose
  # and change, and a linked account is something you connect and disconnect.
  @integration
  Scenario: The password and the linked accounts are separate sections
    Given "sam" holds a password and signs in through single sign-on too
    When the authentication settings are shown
    Then the password is a section of its own
    And the identity providers are another, with nothing about a password in it

  @integration
  Scenario: An account with no password is offered one rather than a change
    Given "sam" signs in without a password
    When the password section is shown
    Then it offers to set a first password
    And it offers nothing to remove, because there is nothing there to give up

  @integration
  Scenario: Removing the password is refused before it is clicked where it is the last way in
    Given the password is the only confirmed way in "sam" holds
    When the password section is shown
    Then removing it is not offered
    And the reason given is the words registered for "identity_detach_strands_user"

  @integration
  Scenario: Removing the password asks first and says what stays
    Given "sam" holds a password and another confirmed way in
    When "sam" asks to remove the password
    Then the confirmation names the ways in that stay behind
    And nothing is removed until "sam" confirms

  # ── Unlinking single sign-on ───────────────────────────────────────────

  @integration
  Scenario: Unlinking a single sign-on method asks first and says what stays
    Given "sam" signs in through single sign-on and holds a confirmed address
    When "sam" asks to unlink the single sign-on method
    Then the confirmation names the ways in that stay behind
    And nothing is unlinked until "sam" confirms

  @integration
  Scenario: A member of an organization that enforces single sign-on is told it comes back
    Given "sam" belongs to an organization that enforces single sign-on
    When "sam" asks to unlink the single sign-on method
    Then the confirmation says signing in that way links it again
    And the unlink is allowed, because nothing is lost that does not return

  @unit
  Scenario: A passkey on its own does not make unlinking safe
    Given the only other way in "sam" holds is a passkey
    When unlinking the single sign-on method is considered
    Then it is refused, because no message could reach "sam" to recover them
    And the words are the ones registered for "identity_detach_strands_user"

  @integration
  Scenario: Unlinking a primary single sign-on method demotes it first
    Given "sam"'s single sign-on identifier is the primary one
    When "sam" confirms unlinking it
    Then the confirmation said another way in becomes primary first
    And the unlink completes as one action
