Feature: Two-step verification, and the session that can prove what it is
  As a person signing in to LangWatch and as the organization that requires it
  I need a second factor I can set up, use, recover from and switch off, and a
  session that records what was actually proven when it was minted
  So that an organization can require two-step verification and have that
  requirement mean something, and so that nobody is signed out to get there

  # D06 (delivery plan Wave 3; dev/docs/identity-platform/D06-mfa-and-session-shape.md).
  # An authenticator code and one-time backup codes. Never a text message.
  #
  # Protocol state stays where better-auth's two-factor plugin puts it -
  # the shared secret and the backup codes at rest in its own table, never
  # returned by any read, and row-truth for good (ADR-101 R12). The FACTS
  # live in the identity pipeline as an MfaEnrollment aggregate
  # tenanted by the user, and no event ever carries a secret or a code
  # (ADR-101's payload rule). What the aggregate records:
  #
  #   [*] ──enroll──► PENDING ──a correct code confirms──► ENABLED
  #                      │                                     │
  #                      └──24h wake, never confirmed──► EXPIRED│
  #                                                             │
  #        password + a correct code, or an audited            │
  #        organization-admin action ─────────────────────► DISABLED
  #
  # The session is what carries the proof, and it gains three columns:
  #
  #   Session  + identifierId   which of the person's sign-in methods minted it
  #            + amr            what was actually proven, e.g. pwd · otp ·
  #                             saml · phw (a passkey, D07)
  #            + mfaVerifiedAt  when a second factor was last proven
  #
  # ── Nobody is signed out to land this ─────────────────────────────────
  #
  # The three columns arrive NULLABLE. A session that records nothing is not
  # untrustworthy; it is untrustworthy *under a policy that asks*, and at the
  # moment the columns land no organization requires anything, so no column
  # nobody reads yet can be read wrongly. Sessions therefore end where the
  # policy begins: when an administrator turns the requirement on for their
  # own organization, that organization's sessions that cannot prove a second
  # factor are stepped up or ended right then. That is a deliberate act by
  # the person who chose it, scoped to the people they administer, and it is
  # the same shape `maxSessionDurationDays` already has in
  # specs/ai-gateway/governance/sessions-and-devices.feature - tightening a
  # policy ends the sessions that no longer satisfy it.
  #
  # One revoke happens at deploy, and it is small: sessions carrying the
  # legacy impersonation payload. Those are LangWatch operators, the payload
  # is being deleted underneath them, and starting again is one click.
  #
  # The requirement itself is evaluated in exactly two places - when a
  # session is minted, and when a step-up completes. How often a proven
  # session is asked again is not decided here; nothing in this spec assumes
  # an answer.
  #
  # Impersonation moves off the legacy `Session.impersonating` payload onto
  # the authz `Principal {actor, subject}`. The anchors survive unchanged -
  # specs/auth/impersonation-banner.feature,
  # specs/ops/dejaview-impersonation-access.feature and
  # specs/features/backoffice-user-impersonation-reason.feature all describe
  # behavior the new claims serve; only the mechanism underneath swaps.
  #
  # Two scenarios in specs/auth/phase-1-better-auth-config.feature retire
  # here (:150-168): the legacy-impersonation pair, and with them the
  # assertion at :166 that generic OAuth is the ONLY registered plugin - the
  # two-factor plugin joins it, and the passkey plugin joins them at D07.
  # The delivery plan cited that block as :119-137; it is :150-168.
  #
  # Everything ships behind MFA_ENROLLMENT_OPEN, which defaults off: with it
  # off nothing offers enrollment, no organization can turn the requirement
  # on, and no session is asked for anything it was not asked for before.

  Background:
    Given an organization "acme" with an admin "ana" and a member "sam"
    And the identity pipeline is registered with the event-sourcing framework
    And two-step verification is available behind its flag

  # ── Enrollment ─────────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: Starting setup records the fact and never the secret
    When "sam" starts setting up two-step verification
    Then an mfa_enrolled event is appended under tenant "sam"
    And the enrollment is PENDING
    And the event names the method and nothing else about it
    And neither the shared secret nor any backup code appears in any event

  @unit @unimplemented
  Scenario: A correct code finishes setup
    Given "sam" has a PENDING enrollment
    When "sam" enters a code their authenticator produced
    Then the enrollment becomes ENABLED and the confirmation is an event
    And "sam" is now asked for a second factor wherever policy asks for one

  @unit @unimplemented
  Scenario: Setup left unfinished expires on its own
    Given "sam" started setup a day ago and never entered a code
    When the expiry wake runs
    Then the enrollment becomes EXPIRED and the expiry is an event
    And the secret issued for it is no longer accepted anywhere

  @unit @unimplemented
  Scenario: Entering a code after the setup expired says so, and offers the way forward
    Given "sam"'s enrollment expired unfinished
    When "sam" enters a code for it
    Then the refusal carries the code "identity_mfa_enrollment_expired"
    And the screen tells "sam" to start setting it up again

  @unit @unimplemented
  Scenario: Starting again after an expiry is a new enrollment, not a resumed one
    Given "sam"'s enrollment expired unfinished
    When "sam" starts setting up two-step verification again
    Then a new PENDING enrollment is recorded with a new secret
    And the expired enrollment stays in the history, unchanged

  @unit @unimplemented
  Scenario: Two setup attempts at once leave one enrollment
    Given "sam" has no enrollment
    When two setup requests for "sam" are handled concurrently
    Then exactly one PENDING enrollment exists
    And the loser is refused rather than issued a second secret

  @unit @unimplemented
  Scenario: Turning it off takes the password and a current code
    Given "sam"'s enrollment is ENABLED
    When "sam" asks to turn two-step verification off with only their password
    Then the request is refused and the enrollment stays ENABLED
    But with the password and a correct code the enrollment becomes DISABLED
    And the disable event records that the person did it themselves

  @unit @unimplemented
  Scenario: An administrator can turn it off for a member, on the record
    Given "sam"'s enrollment is ENABLED
    When "ana" turns two-step verification off for "sam"
    Then the enrollment becomes DISABLED
    And the event names "ana" as the actor and the action as an administrator's
    And "sam" is told it was turned off and who did it

  @unit @unimplemented
  Scenario: A member cannot turn it off for anybody else
    Given "sam"'s enrollment is ENABLED
    When another member of "acme" tries to turn it off for "sam"
    Then the request is refused and the enrollment stays ENABLED

  @unit @unimplemented
  Scenario: History survives being turned off
    Given "sam" enrolled, confirmed, used a backup code and turned it off
    When the MfaEnrollment projection is rebuilt from the event log alone
    Then every rebuilt row equals the live row, whole-row
    And no rebuilt row holds a secret or a code

  @integration @unimplemented
  Scenario: The setup screen shows the secret once and says so
    When "sam" opens the two-step verification setup screen
    Then the screen offers a scannable code and the same value to type in
    And the screen says it will not be shown again after setup finishes
    And nothing on the screen names a table, a service or a plugin

  # ── Backup codes ───────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: Backup codes are shown once and never given back
    When "sam" finishes setting up two-step verification
    Then a set of backup codes is issued and shown once
    And no read of the stored codes returns anything that can be entered as one
    And no event carries a code

  @unit @unimplemented
  Scenario: A backup code works exactly once
    Given "sam" holds unused backup codes
    When "sam" signs in using one of them
    Then the sign-in succeeds
    And using the same code again is refused
    And the refusal is the same one a wrong code gets

  @unit @unimplemented
  Scenario: Using a backup code is observable without exposing it
    Given "sam" holds unused backup codes
    When "sam" uses one
    Then a backup_code_consumed event records which position was used
    And the event does not carry the code
    And "sam" is told how many codes are left

  @unit @unimplemented
  Scenario: Regenerating replaces every code that was left
    Given "sam" holds unused backup codes
    When "sam" generates a new set
    Then none of the previous codes is accepted afterwards
    And the new set is shown once

  @unit @unimplemented
  Scenario: Running out of backup codes is a named, actionable refusal
    Given "sam" has used every backup code and lost their authenticator
    When "sam" tries to sign in
    Then the refusal carries the code "identity_mfa_backup_codes_exhausted"
    And the screen tells "sam" to ask an administrator to reset two-step verification for them

  @integration @unimplemented
  Scenario: The backup codes screen says what they are for in plain words
    When "sam" is shown their backup codes
    Then the screen explains they are for signing in when the authenticator is not available
    And the screen says each one works once and is shown this once only
    And every word on the screen is a word, not a shortening

  # ── Proving it: step-up and what the session records ───────────────────

  @unit @unimplemented
  Scenario: A session records the methods that actually minted it
    When "sam" signs in with an email address and a password
    Then the session records that a password was proven
    And the session records which of "sam"'s sign-in methods it came from
    And the session records no second factor

  @unit @unimplemented
  Scenario: Completing a step-up records the second factor and when
    Given "sam" holds a session that proved only a password
    When "sam" completes a step-up with a code
    Then the session records the second factor alongside the password
    And the session records the moment it was proven

  @unit @unimplemented
  Scenario: The requirement is evaluated when a session is minted
    Given "acme" requires two-step verification
    When "sam" signs in with an email address and a password
    Then the session is not usable for anything but the step-up
    And the refusal on any other action carries the code "identity_mfa_step_up_required"

  @unit @unimplemented
  Scenario: The requirement is read live, not frozen when the session was minted
    Given "sam" holds a session minted before "acme" required anything
    When "acme" turns the requirement on and "sam" makes a request
    Then "sam" is asked to step up on that request
    And completing the step-up makes the same session usable again

  @unit @unimplemented
  Scenario: A step-up is refused if the enrollment stopped being usable meanwhile
    Given "sam" is part-way through a step-up
    When "sam"'s enrollment is turned off by an administrator before it finishes
    Then completing the step-up is refused rather than recorded
    And "sam" is sent to set two-step verification up again

  @unit @unimplemented
  Scenario: An organization that requires nothing asks for nothing
    Given "acme" does not require two-step verification
    And "sam" has no enrollment
    When "sam" signs in
    Then no step-up is asked for and the session works immediately

  # A session is one credential, not one per organization, so a session that
  # could reach one organization's data and not another's is a half-trusted
  # session - the kind of state that grows bugs. The stricter organization
  # therefore decides for the whole session. If that turns out to be too
  # blunt for people who hold a personal organization alongside a strict
  # employer, the place to soften it is here, deliberately.
  @unit @unimplemented
  Scenario: Someone in two organizations answers to the stricter one
    Given "sam" belongs to "acme", which requires two-step verification, and to one that does not
    When "sam" signs in with an email address and a password
    Then a step-up is asked for
    And until it is completed neither organization's data is reachable

  # The maximum session age stays owned by
  # specs/ai-gateway/governance/sessions-and-devices.feature. It is named
  # here only to say that proving a second factor buys no exemption from it.
  @unit @unimplemented
  Scenario: A session that outlives the organization's limit ends whatever it proved
    Given "sam" holds a session that proved a second factor
    When the session reaches the organization's maximum session age
    Then the session ends and "sam" signs in again
    And what it had proven does not extend it by a moment

  @integration @unimplemented
  Scenario: The step-up screen is the same screen from wherever it is reached
    When "sam" is asked to step up from a sign-in, a deep link and an action inside the product
    Then the same screen answers all three
    And completing it returns "sam" to where they were going

  @integration @unimplemented
  Scenario: The session list says how each session signed in
    When "sam" opens the list of their signed-in devices
    Then each entry names the method it signed in with
    And each entry says whether a second factor was proven
    And an entry that proved nothing reads as a normal sign-in, not as a warning

  @unit @unimplemented
  Scenario: A session can be ended for one sign-in method alone
    Given "sam" holds sessions minted by a password and by an identity provider
    When the sessions for one of those methods are ended
    Then only those sessions end
    And the others keep working untouched

  # Revoke-all on reset is specs/auth/password-reset.feature's guarantee and
  # survives untouched: per-identifier revocation is a narrower instrument
  # beside it, never a replacement for it.
  @unit @unimplemented
  Scenario: Resetting a password still ends every session
    Given "sam" holds several sessions, minted by several methods
    When "sam" completes a password reset
    Then every one of "sam"'s sessions ends, whatever method minted it

  # ── Turning the requirement on ─────────────────────────────────────────

  @integration @unimplemented
  Scenario: Turning the requirement on ends only the sessions that cannot answer it
    Given "acme"'s members hold sessions, some of which proved a second factor
    And another organization's members hold sessions that proved none
    When "ana" turns the requirement on for "acme"
    Then "acme"'s sessions that proved a second factor keep working
    And "acme"'s other sessions are asked to step up or are ended
    And the other organization's sessions are untouched

  @integration @unimplemented
  Scenario: A member with nothing set up is sent to set it up, not locked out
    Given "acme" requires two-step verification
    And "sam" has no enrollment
    When "sam" signs in
    Then "sam" can reach the setup screen and nothing else
    And the refusal on anything else carries the code "identity_mfa_enrollment_required"
    And the screen tells "sam" their organization asks for a second step

  @unit @unimplemented
  Scenario: Turning the requirement on is recorded with who did it
    When "ana" turns the requirement on for "acme"
    Then the change is audited with "ana" named as the actor
    And every member of "acme" is told the requirement now applies

  @unit @unimplemented
  Scenario: Turning the requirement off changes nothing about what was proven
    Given "acme" requires two-step verification and its sessions have proven one
    When "ana" turns the requirement off
    Then no session ends and no proof is erased
    And turning it on again asks the same question of the same sessions

  # This is the scenario that replaces the fleet-wide revoke this deliverable
  # was originally going to do. Landing the change signs nobody out, because
  # the only thing that reads what a session proved is a policy no
  # organization has turned on yet.
  @unit @unimplemented
  Scenario: Landing the change signs nobody out
    Given sessions exist that record nothing about what they proved
    And no organization requires two-step verification
    When every one of those sessions is used
    Then not one of them is ended, stepped up or refused
    And no request behaves differently from the way it did before

  # ── When the code is wrong ─────────────────────────────────────────────

  @unit @unimplemented
  Scenario: Repeated wrong codes stop the factor answering for a while
    Given "sam"'s enrollment is ENABLED
    When "sam" enters wrong codes up to the limit
    Then the next attempt is refused with the code "identity_mfa_locked_out"
    And the screen tells "sam" how long to wait
    And a correct code entered during the wait is refused too

  @unit @unimplemented
  Scenario: Backup codes are locked out with everything else
    Given "sam" is locked out after repeated wrong codes
    When "sam" enters a valid, unused backup code
    Then it is refused and stays unused
    And the wait is not shortened by trying

  @unit @unimplemented
  Scenario: A correct code before the limit clears the count
    Given "sam" has entered wrong codes but is not yet locked out
    When "sam" enters a correct code
    Then the sign-in succeeds
    And a later run of wrong codes starts counting from nothing

  @unit @unimplemented
  Scenario: The lockout follows the person, not the browser
    Given "sam" is locked out after repeated wrong codes
    When "sam" tries again from a different browser and a different address
    Then the refusal is the same
    And no new session, tab or window resets the wait

  @unit @unimplemented
  Scenario: Every failure is evidence, and none of it is the code
    When "sam" enters a wrong code
    Then a verification-failed event records how many failures have run together
    And no event carries the value that was entered

  @unit @unimplemented
  Scenario: A wrong code and a code for an enrollment nobody holds answer the same way
    When a code is entered for an ENABLED enrollment and is wrong
    And a code is entered against an enrollment that does not exist
    Then both refusals carry the code "identity_mfa_code_invalid"
    And they are the same refusal, field for field
    And the precise reason goes to the log line instead

  # ── Impersonation ──────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: An impersonated session records both people
    When an operator starts impersonating "sam"
    Then the session records the operator as the actor and "sam" as the subject
    And nothing is written to the legacy impersonation payload

  @unit @unimplemented
  Scenario: Every authorization decision under impersonation names both people
    Given an operator is impersonating "sam"
    When any authorization decision is made for that session
    Then the decision records the operator and "sam"
    And the audit trail can answer who really did it

  @unit @unimplemented
  Scenario: Impersonating into an organization that requires a second factor requires the operator's own
    Given "acme" requires two-step verification
    And the operator's own session has proven no second factor
    When the operator tries to impersonate "sam"
    Then the request is refused with the code "cannot_impersonate_without_second_factor"
    And the operator is told to complete their own step-up first
    But once the operator has proven one, the impersonation proceeds

  @unit @unimplemented
  Scenario: The operator's proof is the operator's, never the subject's
    Given an operator who has proven a second factor impersonates "sam"
    When the impersonated session is inspected
    Then the second factor on it is recorded as the operator's
    And nothing claims "sam" proved anything during the impersonation

  @unit @unimplemented
  Scenario: The legacy impersonation payload is retired outright
    When the deliverable lands
    Then no code writes the legacy impersonation payload
    And no code reads it
    And the column is dropped once nothing reads it

  @integration @unimplemented
  Scenario: The one revoke at deploy is the impersonating sessions
    Given sessions exist carrying the legacy impersonation payload
    And ordinary sessions exist that proved nothing
    When the deliverable is deployed
    Then the sessions carrying the legacy payload end
    And every ordinary session keeps working
    And the operators whose sessions ended can start impersonating again in one action

  # specs/auth/impersonation-banner.feature and
  # specs/ops/dejaview-impersonation-access.feature keep owning this
  # behavior. Only the claims underneath it change.
  @integration @unimplemented
  Scenario: The banner and the way out keep working on the new claims
    Given an operator is impersonating "sam"
    When any page is rendered
    Then the banner appears and names who is being impersonated
    And stopping returns the operator to their own session
    And the operator's own access is decided by who they really are

  # The reason requirement is
  # specs/features/backoffice-user-impersonation-reason.feature's and is
  # inherited whole.
  @integration @unimplemented
  Scenario: Starting an impersonation still takes a reason
    When an operator starts impersonating "sam" without giving a reason
    Then the impersonation is refused
    And with a reason it proceeds, and the reason is recorded beside both people

  # ── Failures read as words ─────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Every named failure has copy a first-time reader understands
    When a step-up, an enrollment or an impersonation is refused with a named code
    Then the screen shows the copy registered for that code
    And the screen never shows the code itself or an internal error
    And no message names a table, an environment variable or a service

  @unit @unimplemented
  Scenario: A failure we cannot name stays unnamed
    When a step-up fails for a reason nothing anticipated
    Then no invented code is attached to it
    And the screen says the step did not go through, with a trace identifier
    And the real cause is logged

  # ── The flag ───────────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: With the flag off nothing about two-step verification exists
    Given the two-step verification flag is off
    When "sam" signs in and opens their security settings
    Then no setup is offered and no step-up is asked for
    And "ana" cannot turn the requirement on for "acme"

  @unit @unimplemented
  Scenario: Turning the flag off leaves enrolled people signed in
    Given members of "acme" hold sessions that proved a second factor
    When the flag is turned off
    Then those sessions keep working
    And nothing they proved is erased
