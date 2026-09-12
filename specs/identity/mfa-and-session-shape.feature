Feature: Two-step verification - one setup per person, and organizations that require it
  As a person signing in to LangWatch and as the organization that requires it
  I need one second factor set up on my account and answered every time I sign in
  So that an organization can require its members to hold one, without that
  decision signing anybody out or reaching into the workspaces it does not own

  # D06 (delivery plan Wave 3; dev/docs/identity-platform/D06-mfa-and-session-shape.md).
  # An authenticator code and one-time backup codes. Never a text message.
  #
  # ── It belongs to the PERSON, not to the organization ──────────────────
  #
  # One setup per person, and that is the whole model - it is set up on the
  # account, it is answered at every sign-in from then on, and no
  # organization gets a copy of its own. The consequence is what makes the
  # rest of this small: if a person has it set up, a session of theirs that
  # never answered a challenge cannot exist. There is nothing to step up,
  # because nothing got in without answering.
  #
  # `mfaRequired` on an organization is therefore a MEMBERSHIP condition -
  # "every member of this organization can prove a second factor" - and not
  # a policy evaluated per session. Turning it on ends no session. It holds
  # the members who cannot yet prove one out of THAT organization until they
  # can, and leaves everything else they use untouched. Nobody's personal
  # workspace is stranded by their employer's decision, and setting it up
  # for the employer protects the personal one too.
  #
  #   set up   [*] ──► PENDING ──a correct code confirms──► ENABLED
  #                       └──24h wake, never confirmed──► EXPIRED
  #            ENABLED ──password + a correct code, or an audited
  #                       administrator's reset───────────► DISABLED
  #
  #   require  an admin turns it on for their organization
  #              ├─ members who can prove one  ─► nothing happens to them
  #              └─ members who cannot         ─► held at the enrollment
  #                                               gate for THIS organization
  #                                               alone, until they set it up
  #
  # Three ways a member proves one, and the organization does not care
  # which: a setup on their account; a passkey (D07, `phw`); or an identity
  # provider that asserted a factor when they signed in. That last one is
  # why the session still records anything at all - see the connections
  # section below.
  #
  # ── Turning it off while an organization requires it is refused ────────
  #
  # Decided, over the alternative of letting it quietly cost them access. A
  # person who turns it off and silently loses their employer's data has
  # been handed a bug, not a choice; and a state a member can walk into at
  # will turns the enrollment gate from a step on the way in into a place to
  # live. So the disable is refused while they belong to an organization
  # that requires it, and the screen names the two honest ways out: leave
  # that organization, or - if the authenticator is gone - ask an
  # administrator to reset it, which starts a fresh setup rather than
  # removing the requirement.
  #
  # ── The session, and the column that is not here ───────────────────────
  #
  #   Session  + identifierId   which of the person's sign-in methods minted it
  #            + amr            what was proven, e.g. pwd · otp · saml · phw
  #
  # `mfaVerifiedAt` was in the original design and is deliberately NOT here.
  # It existed to date a step-up so a policy could ask how fresh it was.
  # With the requirement moved onto the account there is no step-up and
  # nothing reads a freshness timestamp, so the column would ship dead.
  # Dropped rather than carried.
  #
  # ── Nobody is signed out ───────────────────────────────────────────────
  #
  # Both columns land NULLABLE, and nothing in this deliverable revokes a
  # session: not the deploy, not an administrator turning the requirement
  # on. The one revoke is sessions carrying the legacy impersonation
  # payload - LangWatch operators, a handful of rows, and starting again is
  # one click.
  #
  # Protocol state stays where better-auth's two-factor plugin puts it -
  # the shared secret and the backup codes at rest in its own table, keyed
  # on the person, never returned by any read, and row-truth for good
  # (ADR-101 R12). The FACTS live in the identity pipeline as an
  # MfaEnrollment aggregate tenanted by the user, and no event ever carries
  # a secret or a code (ADR-101's payload rule).
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
  # off nothing offers a setup, no organization can turn the requirement on,
  # and no sign-in is asked for anything it was not asked for before.

  Background:
    Given an organization "acme" with an admin "ana" and a member "sam"
    And the identity pipeline is registered with the event-sourcing framework
    And two-step verification is available behind its flag

  # ── Setting it up ──────────────────────────────────────────────────────

  @unit
  Scenario: Starting a setup records the fact and never the secret
    When "sam" starts setting up two-step verification
    Then an mfa_enrolled event is appended under tenant "sam"
    And the enrollment is PENDING
    And the event names the method and nothing else about it
    And neither the shared secret nor any backup code appears in any event

  @unit
  Scenario: A correct code finishes the setup
    Given "sam" has a PENDING enrollment
    When "sam" enters a code their authenticator produced
    Then the enrollment becomes ENABLED and the confirmation is an event
    And "sam" is asked for a code at every sign-in from then on

  @unit
  Scenario: One person has one setup, however many organizations they belong to
    Given "sam" belongs to "acme" and to two other organizations
    When "sam" sets up two-step verification
    Then all three organizations see a member who can prove a second factor
    And no organization holds a setup of its own for "sam"

  @unit
  Scenario: A setup left unfinished expires on its own
    Given "sam" started a setup a day ago and never entered a code
    When the expiry wake runs
    Then the enrollment becomes EXPIRED and the expiry is an event
    And the secret issued for it is no longer accepted anywhere

  @unit
  Scenario: Entering a code for an expired setup says so and offers the way forward
    Given "sam"'s enrollment expired unfinished
    When "sam" enters a code for it
    Then the refusal carries the code "identity_mfa_enrollment_expired"
    And the screen tells "sam" to start setting it up again
    And starting again issues a new secret, leaving the expired one in the history

  @unit
  Scenario: Two setup attempts at once leave one setup
    Given "sam" has no enrollment
    When two setup requests for "sam" are handled concurrently
    Then exactly one PENDING enrollment exists
    And the loser is refused rather than issued a second secret

  @unit
  Scenario: Turning it off takes the password and a current code
    Given "sam"'s enrollment is ENABLED and no organization "sam" belongs to requires one
    When "sam" asks to turn two-step verification off with only their password
    Then the request is refused and the enrollment stays ENABLED
    But with the password and a correct code the enrollment becomes DISABLED
    And the disable event records that the person did it themselves

  @unit
  Scenario: An administrator resets it for a member who lost their authenticator
    Given "sam"'s enrollment is ENABLED
    When "ana" resets two-step verification for "sam"
    Then the enrollment becomes DISABLED
    And the event names "ana" as the actor and the action as an administrator's
    And "sam" is told it was reset and who did it
    And "sam" is asked to set it up again rather than let in without one
    But a member who does not administer "acme" cannot reset it for "sam"

  @unit
  Scenario: History survives being turned off
    Given "sam" set one up, confirmed it, used a backup code and turned it off
    When the MfaEnrollment projection is rebuilt from the event log alone
    Then every rebuilt row equals the live row, whole-row
    And no rebuilt row holds a secret or a code

  @integration
  Scenario: The setup screen shows the secret once and says so
    When "sam" opens the two-step verification setup screen
    Then the screen offers a scannable code and the same value to type in
    And the screen says it will not be shown again after the setup finishes
    And nothing on the screen names a table, a service or a plugin

  # ── Backup codes ───────────────────────────────────────────────────────

  @unit
  Scenario: Backup codes are shown once and never given back
    When "sam" finishes setting up two-step verification
    Then a set of backup codes is issued and shown once
    And no read of the stored codes returns anything that can be entered as one
    And no event carries a code

  @unit
  Scenario: A backup code works exactly once
    Given "sam" holds unused backup codes
    When "sam" signs in using one of them
    Then the sign-in succeeds
    And using the same code again is refused
    And the refusal is the same one a wrong code gets

  @unit
  Scenario: Using a backup code is observable without exposing it
    Given "sam" holds unused backup codes
    When "sam" uses one
    Then a backup_code_consumed event records which position was used
    And the event does not carry the code
    And "sam" is told how many codes are left

  @unit
  Scenario: Regenerating replaces every code that was left
    Given "sam" holds unused backup codes
    When "sam" generates a new set
    Then none of the previous codes is accepted afterwards
    And the new set is shown once

  @unit
  Scenario: Running out of backup codes is a named, actionable refusal
    Given "sam" has used every backup code and lost their authenticator
    When "sam" tries to sign in
    Then the refusal carries the code "identity_mfa_backup_codes_exhausted"
    And the screen tells "sam" to ask an administrator to reset it for them

  @integration
  Scenario: The backup codes screen says what they are for in plain words
    When "sam" is shown their backup codes
    Then the screen explains they are for signing in when the authenticator is not available
    And the screen says each one works once and is shown this once only
    And every word on the screen is a word, not a shortening

  # ── Every sign-in answers the challenge ────────────────────────────────

  @unit
  Scenario: Someone who has set it up answers a challenge every time
    Given "sam"'s enrollment is ENABLED
    When "sam" signs in with an email address and a password
    Then the sign-in is not finished until a correct code is entered
    And the session records the password and the code as what it proved
    And the session records which of "sam"'s sign-in methods minted it

  # This is the invariant the whole shape rests on, and it is worth a test
  # of its own: there is no step-up in this deliverable because there is no
  # session that could need one.
  @unit
  Scenario: A session that never answered a challenge cannot exist for them
    Given "sam"'s enrollment is ENABLED
    When every way of minting a session for "sam" is exercised
    Then not one of them produces a session that proved no second factor
    And no code path can mint one

  # ── An organization that requires it ───────────────────────────────────

  @integration
  Scenario: Turning the requirement on ends no session
    Given "acme"'s members hold sessions, some of them minted without a second factor
    When "ana" turns the requirement on for "acme"
    Then not one session is ended
    And every member is still signed in to everything else they use

  @integration
  Scenario: A member who cannot prove one is held out of that organization alone
    Given "sam" belongs to "acme" and to a personal organization
    And "sam" has no enrollment
    When "ana" turns the requirement on for "acme"
    Then "sam" is offered the setup instead of "acme"'s data
    And the refusal on "acme"'s data carries the code "identity_mfa_enrollment_required"
    And the screen names "acme" as the organization asking, and setting it up as the way in
    And "sam"'s personal organization is reachable throughout

  # Bound by `two-step-verification.standing.unit.test.ts`. These are three
  # separate trust-boundary outcomes: the recovery read, the session boundary,
  # and membership privacy.
  @unit
  Scenario: A held member can read the standing needed to recover
    Given "acme" requires two-step verification
    And "sam" is a member who has not enrolled
    When "sam" asks for their standing in "acme"
    Then the answer names "acme" and says the requirement is unsatisfied
    And that answer can paint the enrollment gate without first satisfying it

  @unit
  Scenario: A standing read still requires an authenticated person
    Given "acme" requires two-step verification
    When a caller with no authenticated person asks for standing in "acme"
    Then the request is refused before any organization standing is read

  @unit
  Scenario: A stranger cannot use standing to inspect an organization
    Given "mallory" is authenticated but is not a member of "acme"
    When "mallory" asks for standing in "acme"
    Then the answer does not reveal the organization's name or requirement
    And no account factor is read for "mallory"

  @integration
  Scenario: Setting it up opens the gate on the session they already hold
    Given "sam" is held at the enrollment gate for "acme"
    When "sam" finishes setting two-step verification up
    Then "acme"'s data is reachable on the same session, without signing in again

  @integration
  Scenario: Someone joining an organization that requires it meets the gate on the way in
    Given "acme" requires two-step verification
    And an invited person with no enrollment accepts the invitation
    Then they become a member of "acme"
    And they are held at the enrollment gate until they set one up

  @integration
  Scenario: An administrator can see who has not set one up yet
    Given "acme" requires two-step verification
    And some of its members have set one up and some have not
    When "ana" opens the organization's member list
    Then each member says whether they can prove a second factor
    And "ana" can see at a glance who is still held at the gate
    And nothing on the screen exposes anybody's secret, codes or device

  @unit
  Scenario: Turning the requirement on is recorded with who did it
    When "ana" turns the requirement on for "acme"
    Then the change is audited with "ana" named as the actor
    And every member of "acme" is told the requirement now applies

  @integration
  Scenario: Turning the requirement off lets the held members straight back in
    Given members of "acme" are held at the enrollment gate
    When "ana" turns the requirement off
    Then those members reach "acme"'s data without signing in again
    And the members who did set one up keep it, and are still asked for it

  # ── The requirement is a paid capability ───────────────────────────────

  # Requiring a second factor of every member is sold with the Enterprise
  # plan. The control is never hidden: an administrator who cannot see it
  # cannot want it, and the count of members who cannot prove one is the
  # honest reason to want it. So the card stays, the switch is what locks,
  # and the plan is asked on the server as well — a greyed switch is a
  # courtesy to whoever is reading, not a boundary.

  @integration
  Scenario: The requirement is offered on every plan and locked without one
    Given "acme" is not on a plan that carries the requirement
    When "ana" opens the organization's security settings
    Then the requirement is on screen rather than hidden
    And the switch is greyed out, saying it needs the Enterprise plan
    And the screen points at the plans, or at activating a licence when self-hosted
    And the screen still says how many members cannot prove a second factor
    But once the requirement is already on and the plan has lapsed, "ana" can still turn it off

  @unit
  Scenario: Turning the requirement on without the plan is refused by the server
    Given "acme" is not on a plan that carries the requirement
    When something asks to turn the requirement on for "acme" anyway
    Then the refusal carries the code "identity_mfa_requirement_not_licensed"
    And the setting is left exactly where it was
    And nobody is told about a rule that never started
    But turning the requirement off is never refused for this reason

  @unit
  Scenario: Turning it off is refused while an organization requires it
    Given "sam"'s enrollment is ENABLED
    And "acme" requires two-step verification
    When "sam" asks to turn it off, with the password and a correct code
    Then the refusal carries the code "identity_mfa_required_by_organization"
    And the screen names "acme" as the organization requiring it
    And the screen offers leaving that organization, or asking an administrator to reset it
    But once "sam" is no longer a member of "acme", turning it off succeeds

  # ── Members who sign in through a connection ───────────────────────────

  # An identity provider does its own two-step verification, and a member
  # who signs in through one has no setup here to enable. This is the only
  # reason the session records what it proved: for these people the
  # requirement is satisfied by the sign-in, not by the account.
  @unit
  Scenario: A supported verified provider factor satisfies the requirement
    Given "acme" requires two-step verification
    And "sam" signs in through a supported Auth0 or Okta connection
    When the current cryptographically verified token matches the accepted account subject and asserts a second factor
    Then "sam" reaches "acme"'s data with no setup of their own
    And the session records the factor the provider asserted

  @unit
  Scenario: A supported verified provider that asserts nothing satisfies nothing
    Given "acme" requires two-step verification
    And "sam" signs in through a supported Auth0 or Okta connection
    When its current cryptographically verified token matches the accepted account subject and asserts no second factor
    Then "sam" is held at the enrollment gate like any other member
    And setting one up here is the way through
    And nothing infers a factor the provider did not assert

  # `session-claims.service.unit.test.ts` binds request scoping, subject
  # binding and claim propagation after the verified-token seam. The provider
  # config invariant is in `oidcProviders.test.ts`; these parser-level tokens
  # are not themselves proof of cryptographic verification. The Prisma
  # adapter's exact Auth0/Okta lookup is separately covered by
  # `session-identifiers.prisma.repository.integration.test.ts`.
  @unit
  Scenario: Supported enterprise providers require ID-token verification
    Given the active enterprise connection uses Auth0 or Okta
    When the server mounts its generic OAuth provider
    Then ID-token verification is required before callback claims are trusted

  @unit
  Scenario Outline: An enterprise callback records the exact accepted account
    Given "sam" has an identifier for "<provider>" subject "<subject>"
    And that provider requires cryptographic ID-token verification
    When its accepted callback carries subject "<subject>"
    Then the session records that exact identifier
    And an identifier for another provider or subject is not selected

    Examples:
      | provider | subject        |
      | auth0    | auth0\|sam     |
      | okta     | okta-user-sam |

  @unit
  Scenario: Current verified Auth0 factors are recorded on the new session
    Given Auth0 requires cryptographic ID-token verification
    When the accepted callback for "sam" asserts "pwd otp unknown"
    Then the new session records "oidc pwd otp"
    And the unsupported assertion is omitted

  @unit
  Scenario: A valid signed Auth0 callback reaches account and session creation
    Given Auth0 discovery publishes the issuer, audience and signing key
    When Auth0 returns a correctly signed token with the callback nonce
    Then BetterAuth accepts the callback and writes its Account and Session

  @unit
  Scenario Outline: Invalid Auth0 proof never reaches account or session creation
    Given Auth0 requires cryptographic ID-token verification
    When its callback token carries <invalid proof>
    Then BetterAuth refuses the callback before writing an Account or Session

    Examples:
      | invalid proof        |
      | an unknown signature |
      | the wrong issuer     |
      | the wrong audience   |
      | the wrong nonce      |

  @unit
  Scenario Outline: Invalid callback state reaches no account or session write
    Given an Auth0 sign-in has issued callback state
    When the callback state is <state defect>
    Then BetterAuth refuses the callback before writing an Account or Session

    Examples:
      | state defect                    |
      | missing                         |
      | different from the issued state |

  @unit
  Scenario: Replaying an accepted callback creates no additional account or session
    Given a valid Auth0 callback has created one Account and Session
    When the browser applies the callback response cookies and replays the same callback
    Then BetterAuth refuses the replay
    And no additional Account or Session is written

  @unit
  Scenario: A stored MFA assertion cannot speak for a later callback
    Given an older Auth0 token for "sam" asserted "pwd otp"
    And the current accepted Auth0 callback carries no ID token
    When that callback mints a session
    Then the session is attributed to the accepted Auth0 account
    But the session records no authentication methods

  @unit
  Scenario: Simultaneous provider callbacks cannot exchange evidence
    Given an Auth0 callback for "sam" and an Okta callback for another subject overlap
    When both accepted account writes complete
    Then each request keeps its own provider subject
    And neither request carries authentication methods from the other

  @unit
  Scenario Outline: Unbound token claims earn no authentication credit
    Given a callback token asserts the factor "otp"
    When <unsafe evidence>
    Then the token contributes no authentication methods
    And identifier attribution comes only from the accepted callback account

    Examples:
      | unsafe evidence                                               |
      | the callback provider does not guarantee token verification  |
      | the claims are requested for a different callback provider    |
      | the token subject differs from the accepted provider account  |
      | the token merely appears on a non-callback request             |

  @unit
  Scenario: A held member cannot carry the standing recovery exemption into API-key creation
    Given "sam" is authenticated but held until two-step verification is enrolled
    And "sam" can read the standing needed to recover
    When "sam" tries to create an API key for the organization
    Then the request is refused before membership or API-key persistence

  @integration
  Scenario: An administrator is told when their connection asserts nothing
    Given "acme" requires two-step verification
    And "acme"'s members sign in through a connection that asserts no second factor
    When "ana" opens the organization's security settings
    Then the screen says the connection is not asserting a second factor
    And the screen says members will be asked to set one up here until it does
    And configuring it at the identity provider is named as the alternative

  # ── When the code is wrong ─────────────────────────────────────────────

  @unit
  Scenario: Repeated wrong codes stop the factor answering for a while
    Given "sam"'s enrollment is ENABLED
    When "sam" enters wrong codes up to the limit
    Then the next attempt is refused with the code "identity_mfa_locked_out"
    And the screen tells "sam" how long to wait
    And a correct code entered during the wait is refused too

  @unit
  Scenario: Backup codes are locked out with everything else
    Given "sam" is locked out after repeated wrong codes
    When "sam" enters a valid, unused backup code
    Then it is refused and stays unused
    And the wait is not shortened by trying

  @unit
  Scenario: A correct code before the limit clears the count
    Given "sam" has entered wrong codes but is not yet locked out
    When "sam" enters a correct code
    Then the sign-in succeeds
    And a later run of wrong codes starts counting from nothing

  @unit
  Scenario: The lockout follows the person, not the browser
    Given "sam" is locked out after repeated wrong codes
    When "sam" tries again from a different browser and a different address
    Then the refusal is the same
    And no new session, tab or window resets the wait

  @unit
  Scenario: Every failure is evidence, and none of it is the code
    When "sam" enters a wrong code
    Then a verification-failed event records how many failures have run together
    And no event carries the value that was entered

  @unit
  Scenario: A wrong code and a code for a setup nobody holds answer the same way
    When a code is entered for an ENABLED enrollment and is wrong
    And a code is entered against an enrollment that does not exist
    Then both refusals carry the code "identity_mfa_code_invalid"
    And they are the same refusal, field for field
    And the precise reason goes to the log line instead

  # ── What the session carries ───────────────────────────────────────────

  # This is the scenario that replaces the fleet-wide revoke this
  # deliverable was originally going to do. Landing the change signs nobody
  # out, because the requirement is a condition on an account and no
  # organization has set one yet.
  @unit
  Scenario: Landing the change signs nobody out
    Given sessions exist that record nothing about what they proved
    And no organization requires two-step verification
    When every one of those sessions is used
    Then not one of them is ended or refused
    And no request behaves differently from the way it did before

  @unit
  Scenario: A session can be ended for one sign-in method alone
    Given "sam" holds sessions minted by a password and by an identity provider
    When the sessions for one of those methods are ended
    Then only those sessions end
    And the others keep working untouched

  # Revoke-all on reset is specs/auth/password-reset.feature's guarantee and
  # survives untouched: per-identifier revocation is a narrower instrument
  # beside it, never a replacement for it.
  @unit
  Scenario: Resetting a password still ends every session
    Given "sam" holds several sessions, minted by several methods
    When "sam" completes a password reset
    Then every one of "sam"'s sessions ends, whatever method minted it

  @integration
  Scenario: The session list says how each session signed in
    When "sam" opens the list of their signed-in devices
    Then each entry names the method it signed in with
    And each entry says whether a second factor was proven
    And an entry that proved nothing reads as a normal sign-in, not as a warning

  # ── Impersonation ──────────────────────────────────────────────────────

  @unit
  Scenario: An impersonated session records both people
    When an operator starts impersonating "sam"
    Then the session records the operator as the actor and "sam" as the subject
    And what the session proved is the operator's, never claimed for "sam"
    And nothing is written to the legacy impersonation payload

  @unit
  Scenario: Every authorization decision under impersonation names both people
    Given an operator is impersonating "sam"
    When any authorization decision is made for that session
    Then the decision records the operator and "sam"
    And the audit trail can answer who really did it

  @unit
  Scenario: Impersonating into an organization that requires it takes the operator's own
    Given "acme" requires two-step verification
    And the operator has not set two-step verification up on their own account
    When the operator tries to impersonate "sam"
    Then the request is refused with the code "cannot_impersonate_without_second_factor"
    And the operator is told to set one up on their own account first
    But an operator who has set one up may impersonate "sam"

  # Asking which of somebody's organizations require a factor is a question
  # about one person across many organizations. Asked the wrong way it is a
  # question the tenancy rules refuse to answer at all, and a refusal to
  # answer is not the same as an answer of "no": it took every impersonation
  # down as an unexplained failure, including the ones no organization had
  # any requirement for.
  @unit
  Scenario: Looking up the requirement decides the request rather than failing it
    Given "sam" belongs to organizations that the operator must be checked against
    When the operator tries to impersonate "sam"
    Then the request is decided on the operator's own second factor
    And it never fails as an unexplained error

  # No longer @unimplemented: this branch binds it in
  # `impersonationRevokeMigration.integration.test.ts`.
  @integration
  Scenario: The one revoke at deploy is the impersonating sessions
    Given sessions exist carrying the legacy impersonation payload
    And ordinary sessions exist that proved nothing
    When the deliverable is deployed
    Then the sessions carrying the legacy payload end
    And every ordinary session keeps working
    And the operators whose sessions ended can start impersonating again in one action
    And from then on nothing writes or reads that payload
    # Expand now, contract next release. Migrations run at container start, so
    # dropping the column in the release that stops reading it would drop it
    # while the previous release's pods still select it on every authenticated
    # request — signing everybody out for the length of the rollout.
    And the column itself stays for one release, and is dropped in the next

  # specs/auth/impersonation-banner.feature and
  # specs/ops/dejaview-impersonation-access.feature keep owning this
  # behavior. Only the claims underneath it change.
  @integration
  Scenario: The banner and the way out keep working on the new claims
    Given an operator is impersonating "sam"
    When any page is rendered
    Then the banner appears and names who is being impersonated
    And stopping returns the operator to their own session
    And the operator's own access is decided by who they really are

  # The reason requirement is
  # specs/features/backoffice-user-impersonation-reason.feature's and is
  # inherited whole.
  @integration
  Scenario: Starting an impersonation still takes a reason
    When an operator starts impersonating "sam" without giving a reason
    Then the impersonation is refused
    And with a reason it proceeds, and the reason is recorded beside both people

  # ── Failures read as words ─────────────────────────────────────────────

  # The two rules — a named failure gets copy a first-time reader
  # understands, and an unanticipated one stays unnamed rather than inventing
  # a code for it — are specified once, in
  # specs/identity/passkeys.feature ("Every named failure has copy a
  # first-time reader understands" / "A failure we cannot name stays
  # unnamed"), and apply here to setup, sign-in and impersonation refusals
  # the same way they apply to passkey ceremonies. Not restated to avoid two
  # specs drifting apart on the same rule.

  # ── The flag ───────────────────────────────────────────────────────────

  @unit
  Scenario: With the flag off nothing about two-step verification exists
    Given the two-step verification flag is off
    When "sam" signs in and opens their security settings
    Then no setup is offered and no challenge is presented
    And "ana" cannot turn the requirement on for "acme"

  @unit
  Scenario: Turning the flag off leaves people who set one up signed in
    Given members of "acme" have set two-step verification up
    When the flag is turned off
    Then their sessions keep working
    And nothing they set up is erased
