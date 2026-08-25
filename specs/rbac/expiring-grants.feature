# See dev/docs/adr/092-unified-authorization-engine.md ("What falls out for
# free" — expiring bindings) and specs/rbac/authz-grants.feature for the
# grant lifecycle this builds on.
#
# Vocabulary, used exactly (the same words authz-grants.feature uses):
#   projection  the Postgres tables a check reads (Grant, Role)
#   compat head the legacy tables kept in step for unmigrated readers
#   collect     the read that assembles everything one principal holds

@authz @grants @rbac
Feature: Expiring grants
  As an administrator handing out access that should not outlive its reason
  I want a grant to carry the date it ends
  So that contractor access and break-glass elevation remove themselves
  without anybody remembering to come back for them

  # An expiry is a TERM of the grant, not an event in its life. Nothing runs
  # when the moment passes: no revocation is written, no epoch is bumped, no
  # audit row appears. The row stays exactly as it was, and the read stops
  # counting it. That is the whole design, and every scenario below is a
  # consequence of it.

  Background:
    Given an organization "org_acme"
    And a member "dana" of "org_acme"

  # ═══ Granting with an end date ════════════════════════════════════════

  @unit
  Scenario: Access granted until a date works before that date
    Given an administrator grants "dana" access to a project until next Friday
    When "dana" is checked for that access on Thursday
    Then the access is allowed

  @unit
  Scenario: Access granted until a date stops working after it
    Given an administrator grants "dana" access to a project until next Friday
    When "dana" is checked for that access the following Monday
    Then the access is denied

  # The denied caller learns nothing new. They asked whether they may do a
  # thing and the answer is no, in exactly the words every other denial uses
  # — because from the engine's side the grant is simply not there. An
  # "expired" answer would be a second denial vocabulary for one denial.
  @unit
  Scenario: An elapsed grant is refused as an ordinary permission denial
    Given "dana" holds only a grant whose date has passed
    When "dana" is checked for that access
    Then the denial is the standard permission denial
    And it names no expiry of its own

  @unit
  Scenario: A grant with no end date keeps granting
    Given an administrator grants "dana" access to a project with no end date
    When "dana" is checked for that access a year later
    Then the access is allowed

  # ═══ Refusing an end date that has already passed ═════════════════════

  @unit
  Scenario: Granting access that ends in the past is refused
    Given an administrator grants "dana" access ending yesterday
    Then the request is refused with code grant_expiry_in_past
    And no grant is created

  # The write and the read agree on the boundary. A grant that ends at this
  # exact instant is already over on the read side, so accepting it on the
  # write side would create access that never worked — indistinguishable
  # from a bug.
  @unit
  Scenario: An end date of exactly now is refused
    Given an administrator grants "dana" access ending at this very instant
    Then the request is refused with code grant_expiry_in_past
    And no grant is created

  # ═══ Expiry is not revocation ═════════════════════════════════════════

  @unit
  Scenario: A grant that reaches its end date is not recorded as revoked
    Given "dana" holds a grant whose date has passed
    When the organization's audit trail is read
    Then no revocation is recorded for that grant
    And the grant is still listed with the date its access ended

  @unit
  Scenario: Revoking an expiring grant early still works
    Given "dana" holds a grant that ends next Friday
    When an administrator revokes it on Tuesday
    Then the grant is revoked
    And the audit trail records the revocation
    And "dana" is denied that access immediately

  # ═══ What the absence of a write costs ════════════════════════════════
  # ACCEPTED, not a defect. Nothing happens at the moment a grant ends, so
  # there is nothing to invalidate caches with — unlike a revocation, which
  # bumps the organization's epoch and is felt on the next request. A
  # snapshot taken before the moment therefore keeps answering from it until
  # it ages out. An administrator who needs access to stop THIS INSTANT
  # revokes; that is what revocation is for.

  @unit
  Scenario: A grant that ends is felt on the next collect, not instantly
    Given "dana" holds a grant that ends in one second
    And their access was assembled a moment before it ended
    When "dana" is checked again immediately afterwards
    Then the already-assembled answer may still allow the access
    But an answer assembled after the moment denies it

  @unit
  Scenario: A stale answer cannot outlive the cache's own ceiling
    Given an answer assembled before a grant's end date
    When more than thirty seconds pass
    Then the answer is reassembled rather than reused
    And the elapsed grant no longer counts

  # ═══ Older facts are unaffected ═══════════════════════════════════════
  # Every grant ever recorded predates end dates. They must be indisting-
  # uishable from a grant that simply has none.

  @unit
  Scenario: A grant recorded before end dates existed still grants
    Given a grant recorded with no end date at all
    When it is applied to the projection
    Then its row carries no end date
    And it grants exactly what it granted before

  @unit
  Scenario: A grant's end date survives a round trip through the projection
    Given a grant carrying an end date
    When its row is read back as a fact
    Then the fact carries the same end date it was written with

  # A share link has carried its own end date since ADR-057, stated inside
  # the terms the token was minted with. One row cannot hold two answers to
  # when access ends, so a shared resource states it there and nowhere else.
  @unit
  Scenario: A shared resource states its end date in its own terms
    When a grant for a shared resource also states an end date of its own
    Then the fact is refused

  # ═══ The end date is not the grant's identity ═════════════════════════

  @unit
  Scenario: Re-granting the same access with a different end date is a duplicate
    Given "dana" already holds a grant at a project
    When an administrator grants the same access again, ending next Friday
    Then the request is refused with code role_binding_already_exists
    And the existing grant's end date is unchanged

  # ═══ Organizations whose access records cannot hold a date ════════════
  # The legacy tables have no column for it. Storing the grant anyway would
  # produce access an administrator believes ends on Friday and which never
  # ends — the exact failure this feature exists to prevent.

  @unit
  Scenario: An end date is refused where it could not be stored
    Given an organization whose access records are still the legacy ones
    When an administrator grants access ending next Friday
    Then the request is refused with code grant_expiry_not_supported
    And no grant is created

  # ═══ The management API ═════════════════════════════════════
  # The end date rides through the same create the operator already uses.
  # It is only storable for an organization whose access records have moved
  # onto the projection, which is what the refusal above is about.══════════

  @unit
  Scenario: Binding a role with an end date through the API
    Given I am authenticated with an organization-scoped API key
    When I bind "dana" as a member of a team until next Friday
    Then the end date is recorded alongside the grant

  @integration
  Scenario: A binding with no end date reports none
    Given I am authenticated with an organization-scoped API key
    When I bind "dana" as a member of a team with no end date
    Then the response status is 201
    And the binding reports no end date

  @integration
  Scenario: Binding a role with an end date that has passed is refused
    Given I am authenticated with an organization-scoped API key
    When I bind "dana" as a member of a team until yesterday
    Then the request is refused with code grant_expiry_in_past and status 422
    And no binding is created

  @unit
  Scenario: A binding whose access has ended is still listed
    Given a binding whose end date has passed
    When I list the organization's role bindings
    Then that binding is in the list
    And it reports the date its access ended
