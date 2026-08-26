Feature: Directory sync per connection - one token, one connection, and a deprovision that proves itself
  As an enterprise wiring its identity provider to LangWatch
  I need each directory token to reach exactly the connection it was issued
  for, and a removal to leave nothing behind
  So that a directory push can never touch another organization, and
  offboarding a leaver is a fact somebody can check rather than a hope

  # D08 (delivery plan Wave 3). The SCIM protocol surface does not change -
  # this is about what a token may reach, whose identity a push is about, and
  # what a removal has to prove. Group mapping keeps its own file
  # (specs/features/scim-group-mapping.feature); the mint and revoke contract
  # keeps its own (specs/organizations/scim-tokens-rest-api.feature).
  #
  # SCIM becomes a COMMAND PRODUCER. The endpoints answer the same protocol
  # to the same identity providers, but behind them a push no longer writes
  # rows: it issues commands into the identity pipeline, each landing an
  # event, and every membership consequence goes through the grants service -
  # the one that runs the offboard proof - rather than straight at the
  # ledger. That is the whole deliverable in one line, and it is what makes
  # a removal checkable, a failure visible, and a replay free.
  #
  #   [*] ──token minted for a connection──► TOKEN_ISSUED
  #        TOKEN_ISSUED ──first push──────► SYNCING
  #        SYNCING ⇄ ERROR                 (apply failed / retried with backoff)
  #        SYNCING ──revoked or torn down─► REVOKED
  #        ERROR   ──revoked or torn down─► REVOKED
  #
  # Two facts about one person, kept apart on purpose:
  #
  #   WHO the directory means      the connection plus the directory's own
  #                                identifier for them - a pair. The address
  #                                is not identity: people change theirs, and
  #                                the same person carries different
  #                                identifiers on two different connections.
  #
  #   WHO made the write           one directory principal, globally. The
  #                                actor stamped on a membership fact is NOT
  #                                the connection: system principals are a
  #                                closed, named set that no call site may
  #                                invent a member of, and a connection id is
  #                                a per-customer value. Which connection
  #                                pushed a change is recorded on the sync's
  #                                own history, where it belongs. Nothing is
  #                                lost by this: cross-organization safety
  #                                comes from what the TOKEN may reach, not
  #                                from what the actor stamp says.
  #
  # Membership consequences are grants, never rows written by hand, and they
  # are stamped as directory-sourced so a customer's audit page shows them.
  # Nothing a push does may leave a membership behind that no event explains.
  #
  # CALIBRATION on the deprovisioning scenarios below. Today a deprovision
  # marks the person deactivated and leaves their grants in place, and
  # deactivation does block sign-in and API-key verification - so what is
  # being fixed here is LATENT retained authority, not an open door. It
  # matters because latent authority comes back without a decision: today
  # reactivating somebody silently restores every permission they held on
  # the day they left. The scenarios below are written against that risk,
  # not against a live breach.
  #
  # Ships behind SCIM_V2_GRANTS; the previous write path returns with the flag.

  Background:
    Given an organization "acme" on the Enterprise plan, administered by "ana"
    And "acme" has an ACTIVE SSO connection "okta-primary" and a second one "entra-contractors"
    And directory sync is enabled for "acme"

  # ── A token reaches one connection ─────────────────────────────────────

  # Needs Postgres: a stored token row read back through verifyEntitled,
  # and a push authenticated with it landing a sync fact that names the
  # connection. Attribution cannot be observed without a real push.
  @integration
  Scenario: A token is issued against exactly one connection
    When a directory token is minted for "okta-primary"
    Then the token names "okta-primary" as the connection it was issued for
    And pushes authenticated with it are attributed to that connection

  @unit
  Scenario: A token cannot exist without a connection to belong to
    When a directory token is minted without naming a connection
    Then the request is refused with code scim_connection_required and status 422

  @unit
  Scenario: A token cannot be issued against another organization's connection
    Given a connection belonging to a different organization
    When a directory token is minted for it
    Then the request is refused with code scim_connection_not_found and status 404
    And nothing about the other organization is revealed

  # Needs Postgres: a ScimExternalId row held by the other connection, and
  # the person's rows read back UNCHANGED after the refusal. A mock proves
  # no write was attempted, which is a weaker claim than nothing moved.
  @integration @unimplemented
  Scenario: One connection's token cannot touch another connection's people
    Given a person provisioned through "entra-contractors"
    When a push authenticated with "okta-primary"'s token tries to change them
    Then the push is refused with code scim_write_outside_connection and status 403
    And that person is unchanged

  # Needs Postgres: the connection's ScimToken rows gone, its ScimSyncState
  # folded to REVOKED, and the other connection's token still verifying.
  @integration
  Scenario: Tearing a connection down ends its tokens
    Given "okta-primary" has a working directory token
    When "okta-primary" is torn down
    Then its sync is REVOKED
    And a push authenticated with that token is refused
    And "entra-contractors" keeps syncing untouched

  # ── Who the directory means ────────────────────────────────────────────

  @unit
  Scenario: A blank external identifier is read as none rather than refused
    Given a provisioning client that has no external identifier for a person
    And it sends the field anyway, empty
    When it pushes that person
    Then the person is accepted with no external identifier
    And the push is not refused over a field nothing required

  @unit
  Scenario: A person keeps their place when their address changes
    Given a person provisioned through "okta-primary"
    When the directory pushes them again with a new email address and the same directory identifier
    Then the same LangWatch account is updated
    And no second account is created

  @unit
  Scenario: The same person on two connections is two directory identities, one account
    Given a person is provisioned through "okta-primary"
    When "entra-contractors" pushes the same person under its own directory identifier
    Then both directory identities resolve to the one LangWatch account
    And neither connection's identifier overwrites the other's

  @unit
  Scenario: The same directory identifier on two connections is two different people
    Given "okta-primary" and "entra-contractors" both push the directory identifier "u-1"
    When both pushes are applied
    Then each resolves within its own connection
    And neither push resolves to the other's person

  @unit
  Scenario: A push naming a person no connection knows provisions within that connection only
    When "okta-primary" pushes an unknown directory identifier
    Then the person is created and recorded under "okta-primary"
    And "entra-contractors" still does not know them

  # ── A push is a command, and membership is a grant ─────────────────────

  # Needs Postgres and the HTTP boundary: a full push, group and deactivate
  # cycle replayed against the real routes, compared response by response.
  @integration @unimplemented
  Scenario: The protocol is unchanged and the writes underneath are not
    Given an identity provider configured against "acme" before the flip
    When it runs its usual push, group and deactivate cycle unchanged
    Then every request is answered exactly as it was before
    And nothing in its configuration had to change

  # Needs Postgres and the event store: the appended event read back, and the
  # grant row carrying it as its cause. Nothing reads that causation link
  # yet - building the read is what unblocks this.
  @integration @unimplemented
  Scenario: A push asserts membership through a command, not by writing a row
    When "okta-primary" pushes a new person into "acme"
    Then the push issued a command and the command landed an event
    And their membership arrives as a grant carrying that event as its cause
    And the grant is stamped as directory-sourced
    And no membership row was written outside that path

  @unit
  Scenario: Membership is no longer a fixed role written beside the grant
    When "okta-primary" pushes a new person into "acme"
    Then the role they hold is the one the directory's mapping asserts
    And no membership is created with a role nothing asserted

  @unit
  Scenario: Every membership a directory push causes is explained by an event
    Given "acme" has been synced through a full push, group and removal cycle
    When "acme"'s memberships are read back against the events that caused them
    Then every one of them names the event that caused it
    And none of them is a row nothing in the history accounts for

  @unit
  Scenario: The fact records which connection pushed it, and one directory actor
    When "okta-primary" pushes a membership change
    Then the sync's history names "okta-primary" as the connection that pushed it
    And the membership fact's actor is the one directory principal, the same on every connection
    And no per-customer value is used as an actor

  @unit
  Scenario: Directory-sourced membership changes stay on the customer's audit page
    When "okta-primary" pushes people in and out of "acme"
    Then each change appears on "acme"'s audit page
    And it is told apart from a change an administrator made by hand

  # Needs Postgres: the grant row's actor column after a settings-page write,
  # and the group's scimSource still refusing hand edits.
  @integration @unimplemented
  Scenario: An administrator mapping a directory group is attributed to the administrator
    Given a directory group "engineering" received from "okta-primary"
    When "ana" gives that group a role at a scope from the settings page
    Then the mapping arrives as a grant with "ana" as the actor, not the directory
    And the access it gives the group's members resolves the ordinary way
    And the group keeps its directory provenance, so it stays uneditable by hand

  # ── Removal, and what it has to prove ──────────────────────────────────

  # A removal is the highest-stakes thing a directory does, because the
  # customer's reason for doing it is usually that somebody left under a
  # cloud. "We deleted some rows" is not an answer. The postcondition is.

  @integration
  Scenario: Deprovisioning leaves no effective permission anywhere
    Given a person in "acme" holding organization membership, group memberships and direct role bindings
    When "okta-primary" deprovisions them
    Then the removal is proved to have left nothing that resolves for them in "acme"
    And a permission check for them in "acme" answers no, everywhere

  # Deactivation used to be the quiet case: it set a flag that stopped
  # sign-in and left every grant in place. Nobody could use those grants
  # while deactivated, so it read as harmless - but it meant reactivating
  # somebody handed back everything they held on the day they left, with
  # nobody deciding that. So deactivation is a deprovision like any other,
  # and coming back is re-entry rather than undo.

  @integration
  Scenario: Marking somebody inactive is a deprovision, not a flag
    Given a person in "acme" with access through a group and a direct role binding
    When "okta-primary" pushes them as inactive
    Then their access is removed with the same proof a deletion carries
    And their next permission check in "acme" answers no
    And no grant of theirs in "acme" is left standing behind the flag

  # Needs Postgres: the collector answering nothing for them after a
  # reactivating push. `reinstateSignIn` covers the sign-in half at unit
  # level; the holds-nothing half is a real permission collection.
  @integration @unimplemented
  Scenario: Coming back restores nothing on its own
    Given somebody in "acme" was pushed inactive and their access was removed
    When "okta-primary" pushes them active again
    Then they can sign in
    And they hold no access in "acme" until the directory asserts it again
    And what they held before their removal is not restored by the reactivation

  # Needs Postgres: the grants attached by the next push, and the ones an
  # administrator gave by hand still absent.
  @integration @unimplemented
  Scenario: The next full push is what puts a returning person back
    Given somebody in "acme" was pushed active again and holds no access
    When "okta-primary" runs its next full push with them in it
    Then the access that push asserts is attached, and nothing else is
    And access an administrator had given them by hand before they left stays gone
      until an administrator gives it again

  @unit
  Scenario: A removal that cannot prove itself empty fails loudly
    Given a removal whose proof still finds something resolving for the person
    When the removal is applied
    Then it is refused with code offboard_incomplete and status 500
    And nothing about that person's access has changed
    And the failure names what was still resolving
    And it is surfaced as a dead letter rather than being retried into silence

  @unit
  Scenario: The proof runs on every path a directory can remove somebody by
    Given a person in "acme" holding access
    When they are removed by deletion, and when they are removed by being pushed inactive
    Then both removals ran the proof
    And neither could complete while anything still resolved for them

  # That a removal denies before the push returns, queue or no queue, is
  # specs/features/scim-group-mapping.feature's and is unchanged by D08.

  @unit
  Scenario: A removal decision needing a person is surfaced, not guessed at
    Given the person being removed owns credentials or a personal team
    When the removal is applied
    Then their access in "acme" is still removed and proved empty
    And what needs a human decision is named for an administrator to act on

  # ── When a push fails ──────────────────────────────────────────────────

  @unit
  Scenario: A failed apply moves the sync into ERROR where somebody can see it
    When an apply fails for "okta-primary"
    Then the sync for "okta-primary" is ERROR
    And the failure is visible with the connection, the operation and a reason code
    And "entra-contractors" is unaffected

  @unit
  Scenario: A retryable failure backs off and recovers on its own
    Given "okta-primary" is in ERROR after a retryable failure
    When the retry succeeds
    Then the sync is SYNCING again
    And the recovery is visible in the same place the failure was

  @unit
  Scenario: A failure that will never succeed is retired visibly, never silently
    Given an apply for "okta-primary" that cannot succeed however often it runs
    When it stops being retried
    Then it is retired as a visible dead letter naming what could not be applied
    And it is never dropped, and the directory's state is never assumed applied

  @unit
  Scenario: A deactivate that cannot be applied is as visible as any other failure
    Given "okta-primary" pushes somebody inactive and the removal cannot be applied
    When it stops being retried
    Then it is retired as a visible dead letter naming that person and the removal
    And they are not left marked inactive while still holding access
    And the state the directory asked for is never reported as reached

  @unit
  Scenario: The failure surface says nothing a customer should not read
    When any directory failure is shown
    Then it names the connection, the operation and a reason code
    And it carries no token, no secret and no internal hostname

  # ── The flag ───────────────────────────────────────────────────────────

  @unit
  Scenario: With the flag off the previous write path answers exactly as before
    Given the directory grants flag is off
    When "okta-primary" pushes people into "acme"
    Then membership lands the way it did before the flip
    And the tokens keep working throughout

  # ── What a push does about the person on the other end ─────────────────
  #
  # The arrival matrix: every combination of "do they already have an
  # account here" and "are they already a member", plus what a removal
  # leaves behind and what a re-push does. The directory has already made
  # the access decision, so a push does not ask the joining policy that a
  # self-serve arrival would - which is exactly why the matrix is written
  # down rather than left to be inferred.
  #
  # OPEN, and deliberately not stated as behaviour below: adoption today
  # matches on the User.email column alone, so it will adopt an account
  # holding an address nobody ever proved. The scenario says "adopts rather
  # than duplicates", which is right in every case; whether the account must
  # have PROVED the address first is the open question, and the answer
  # narrows the match rather than changing the shape.

  @integration
  Scenario: A directory push provisions whatever the sign-in door would do
    Given "okta-primary" pushes somebody who has no account here
    Then the account is created and the membership lands
    And the joining policy is not consulted, because the administrator already decided

  @integration
  Scenario: A directory adopts a member who already had an account
    Given somebody already has an account but no membership in "acme"
    When "okta-primary" pushes them
    Then their existing account gains the membership
    And no second account is created for the same address

  @integration
  Scenario: A directory push that changes nothing changes nothing
    Given somebody the directory has already pushed into "acme"
    When the same push arrives again
    Then it is refused with status 409
    And they still hold exactly one membership

  @integration
  Scenario: A directory push follows the person, not the address
    Given somebody provisioned through "okta-primary"
    When the directory pushes them again under a changed address
    Then the directory's own identifier is what resolves them
    And no account is created for the new address

  @integration
  Scenario: A removed person the directory pushes again comes back
    Given somebody the directory removed from "acme"
    When the directory pushes them again
    Then the membership is restored
    And they still hold exactly one account

  @integration
  Scenario: A removal leaves nothing behind in the organization
    Given somebody the directory removed from "acme"
    Then they hold no membership and no role binding there
    And their account itself survives, because it is theirs and not the organization's
