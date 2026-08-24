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
  # Ships behind SCIM_V2_GRANTS; the previous write path returns with the flag.

  Background:
    Given an organization "acme" on the Enterprise plan, administered by "ana"
    And "acme" has an ACTIVE SSO connection "okta-primary" and a second one "entra-contractors"
    And directory sync is enabled for "acme"

  # ── A token reaches one connection ─────────────────────────────────────

  @integration @unimplemented
  Scenario: A token is issued against exactly one connection
    When a directory token is minted for "okta-primary"
    Then the token names "okta-primary" as the connection it was issued for
    And pushes authenticated with it are attributed to that connection

  @unit @unimplemented
  Scenario: A token cannot exist without a connection to belong to
    When a directory token is minted without naming a connection
    Then the request is refused with code scim_connection_required and status 422

  @unit @unimplemented
  Scenario: A token cannot be issued against another organization's connection
    Given a connection belonging to a different organization
    When a directory token is minted for it
    Then the request is refused with code scim_connection_not_found and status 404
    And nothing about the other organization is revealed

  @integration @unimplemented
  Scenario: One connection's token cannot touch another connection's people
    Given a person provisioned through "entra-contractors"
    When a push authenticated with "okta-primary"'s token tries to change them
    Then the push is refused with code scim_write_outside_connection and status 403
    And that person is unchanged

  @integration @unimplemented
  Scenario: Tearing a connection down ends its tokens
    Given "okta-primary" has a working directory token
    When "okta-primary" is torn down
    Then its sync is REVOKED
    And a push authenticated with that token is refused
    And "entra-contractors" keeps syncing untouched

  # ── Who the directory means ────────────────────────────────────────────

  @unit @unimplemented
  Scenario: A person keeps their place when their address changes
    Given a person provisioned through "okta-primary"
    When the directory pushes them again with a new email address and the same directory identifier
    Then the same LangWatch account is updated
    And no second account is created

  @unit @unimplemented
  Scenario: The same person on two connections is two directory identities, one account
    Given a person is provisioned through "okta-primary"
    When "entra-contractors" pushes the same person under its own directory identifier
    Then both directory identities resolve to the one LangWatch account
    And neither connection's identifier overwrites the other's

  @unit @unimplemented
  Scenario: The same directory identifier on two connections is two different people
    Given "okta-primary" and "entra-contractors" both push the directory identifier "u-1"
    When both pushes are applied
    Then each resolves within its own connection
    And neither push resolves to the other's person

  @unit @unimplemented
  Scenario: A push naming a person no connection knows provisions within that connection only
    When "okta-primary" pushes an unknown directory identifier
    Then the person is created and recorded under "okta-primary"
    And "entra-contractors" still does not know them

  # ── Membership is a grant, stamped ─────────────────────────────────────

  @integration @unimplemented
  Scenario: A push asserts membership through the grants ledger, not by writing a row
    When "okta-primary" pushes a new person into "acme"
    Then their membership arrives as a grant
    And the grant is stamped as directory-sourced
    And no membership row was written outside that path

  @unit @unimplemented
  Scenario: The fact records which connection pushed it, and one directory actor
    When "okta-primary" pushes a membership change
    Then the sync's history names "okta-primary" as the connection that pushed it
    And the membership fact's actor is the one directory principal, the same on every connection
    And no per-customer value is used as an actor

  @unit @unimplemented
  Scenario: Directory-sourced membership changes stay on the customer's audit page
    When "okta-primary" pushes people in and out of "acme"
    Then each change appears on "acme"'s audit page
    And it is told apart from a change an administrator made by hand

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

  @integration @unimplemented
  Scenario: Deprovisioning leaves no effective permission anywhere
    Given a person in "acme" holding organization membership, group memberships and direct role bindings
    When "okta-primary" deprovisions them
    Then the removal is proved to have left nothing that resolves for them in "acme"
    And a permission check for them in "acme" answers no, everywhere

  @integration @unimplemented
  Scenario: Marking somebody inactive is a deprovision, not a flag
    Given a person in "acme" with access through a group
    When "okta-primary" pushes them as inactive
    Then their access is removed with the same proof a deletion carries
    And their next permission check in "acme" answers no

  @unit @unimplemented
  Scenario: A removal that cannot prove itself empty changes nothing
    Given a removal whose proof still finds something resolving for the person
    When the removal is applied
    Then it is refused with code offboard_incomplete and status 500
    And nothing about that person's access has changed
    And the failure names what was still resolving

  # That a removal denies before the push returns, queue or no queue, is
  # specs/features/scim-group-mapping.feature's and is unchanged by D08.

  @unit @unimplemented
  Scenario: A removal decision needing a person is surfaced, not guessed at
    Given the person being removed owns credentials or a personal team
    When the removal is applied
    Then their access in "acme" is still removed and proved empty
    And what needs a human decision is named for an administrator to act on

  # ── When a push fails ──────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A failed apply moves the sync into ERROR where somebody can see it
    When an apply fails for "okta-primary"
    Then the sync for "okta-primary" is ERROR
    And the failure is visible with the connection, the operation and a reason code
    And "entra-contractors" is unaffected

  @unit @unimplemented
  Scenario: A retryable failure backs off and recovers on its own
    Given "okta-primary" is in ERROR after a retryable failure
    When the retry succeeds
    Then the sync is SYNCING again
    And the recovery is visible in the same place the failure was

  @integration @unimplemented
  Scenario: A failure that will never succeed is retired visibly, never silently
    Given an apply for "okta-primary" that cannot succeed however often it runs
    When it stops being retried
    Then it is retired as a visible dead letter naming what could not be applied
    And it is never dropped, and the directory's state is never assumed applied

  @unit @unimplemented
  Scenario: The failure surface says nothing a customer should not read
    When any directory failure is shown
    Then it names the connection, the operation and a reason code
    And it carries no token, no secret and no internal hostname

  # ── The flag ───────────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: With the flag off the previous write path answers exactly as before
    Given the directory grants flag is off
    When "okta-primary" pushes people into "acme"
    Then membership lands the way it did before the flip
    And the tokens keep working throughout
