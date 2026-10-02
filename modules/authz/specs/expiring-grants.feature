# See dev/docs/adr/092-unified-authorization-engine.md ("What falls out for
# free": expiring bindings) and specs/rbac/authz-grants.feature for the
# grant lifecycle this builds on.
#
# Vocabulary, used exactly (the same words authz-grants.feature uses):
#   projection  the Postgres tables a check reads (Grant, Role)
#   collect     the read that assembles everything one principal holds

@authz @grants @rbac
Feature: Expiring grants
  As an administrator handing out access that should not outlive its reason
  I want a grant to carry the date it ends
  So that contractor access and break-glass elevation remove themselves
  without anybody remembering to come back for them

  # An expiry is a TERM of the grant, not an event in its life. Nothing runs
  # when the moment passes: no revocation is written, no epoch is bumped, no
  # audit row appears. The row stays exactly as it was, and the collect stops
  # counting it. Every organization reads its grants from the projection, so
  # every organization can hold an end date.

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

  # The denied caller learns nothing new: from the engine's side the grant is
  # simply not there, so the denial is the one every other denial uses.
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

  # The write and the read agree on the boundary: a grant that ends at this
  # exact instant is already over on the read side.
  @unit
  Scenario: An end date of exactly now is refused
    Given an administrator grants "dana" access ending at this very instant
    Then the request is refused with code grant_expiry_in_past
    And no grant is created

  # ═══ Expiry is not revocation ═════════════════════════════════════════

  @unit
  Scenario: A grant that reaches its end date is not recorded as revoked
    Given "dana" holds a grant whose date has passed
    When "dana" is checked for that access
    Then nothing is written and the organization's epoch is not bumped
    And the grant is still listed with the date its access ended

  @unit
  Scenario: Revoking an expiring grant early still works
    Given "dana" holds a grant that ends next Friday
    When an administrator revokes it on Tuesday
    Then the grant is revoked
    And the organization's epoch is bumped, so "dana" is denied that access immediately

  # The end date is stated on the replacement rather than inferred from the
  # grant being replaced, so narrowing never widens a grant in time.
  @unit
  Scenario: Reducing an expiring grant keeps its end date
    Given "dana" holds a grant over the whole organization that ends next Friday
    When an administrator narrows it to one team, still ending next Friday
    Then "dana" holds the narrower grant
    And that grant still ends next Friday

  # ═══ What the absence of a write costs ════════════════════════════════
  # ACCEPTED, not a defect. Nothing happens at the moment a grant ends, so
  # nothing invalidates the grants cache: a snapshot collected before the
  # moment keeps answering until it ages out, and the cache's absolute age
  # bound holds that to thirty seconds. An administrator who needs access to
  # stop this instant revokes; a revocation bumps the epoch.

  @unit
  Scenario: An expired grant stops granting while its answer is cached
    Given "dana" holds a grant that ends in one second
    And their access was collected a moment before it ended
    When "dana" is checked again at the moment the grant ends
    Then the answer is collected again rather than reused
    And the elapsed grant no longer counts

  @unit
  Scenario: A stale answer cannot outlive the cache's own ceiling
    Given an answer collected before a grant's end date
    When more than thirty seconds pass
    Then the answer is collected again rather than reused
    And the elapsed grant no longer counts

  # ═══ Older facts are unaffected ═══════════════════════════════════════

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

  # A share link states its end date inside the terms its token was minted
  # with. One row cannot hold two answers to when access ends.
  @unit
  Scenario: A shared resource states its end date in its own terms
    When a grant for a shared resource also states an end date of its own
    Then the fact is refused

  # ═══ The end date is not the grant's identity ═════════════════════════

  @unit
  Scenario: Re-granting the same access with a different end date is a second grant
    Given "dana" already holds a grant at a project
    When an administrator grants the same access again, ending next Friday
    Then a second binding is written with its own end date, because bindings are never unique
    And the existing grant's end date is unchanged

  # ═══ The management API ═══════════════════════════════════════════════

  @unit
  Scenario: Binding a role with an end date through the API
    Given I am authenticated with an organization-scoped API key
    When I bind "dana" as a member of a team until next Friday
    Then the end date is recorded alongside the grant

  @unit
  Scenario: A binding with no end date reports none
    Given I am authenticated with an organization-scoped API key
    When I bind "dana" as a member of a team with no end date
    Then the binding is created
    And the binding reports no end date

  @unit
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
