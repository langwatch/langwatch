Feature: SCIM Group Mapping
  As an organization admin
  I want identity-provider groups mirrored in LangWatch and granted scoped access
  So that identity-provider group membership automatically grants scoped access

  # Storage-neutral by design (ADR-092 §13): "RoleBinding" in the scenario
  # titles below names the customer-visible fact - a group holds a role at a
  # scope - not a table. Behind the grants ledger the same fact is a Grant
  # row projected from events; every scenario here must hold identically
  # before and after an organization's cutover.
  #
  # SCIM is a RECONCILER (delivery plan decision 18): the IdP pushes
  # declarative state, the handler diffs it against the current projection
  # and emits only the difference. Removals carry instant enforcement -
  # an IdP deprovision is the fired-employee case, so the deny effect
  # holds before the push returns, queue or no queue.

  # Which scenarios below are bound is answered by the feature-parity check,
  # not by a count kept here - a hand-maintained tally goes stale the first
  # time somebody binds one, and the @unimplemented tags already say which
  # gaps are tracked. Closing them is #3458.

  # D08 amends the deprovisioning section: what a removal must leave behind
  # is now a proved postcondition rather than a list of records deleted, and
  # every membership consequence a push has - group bindings included -
  # arrives as a grant. The connection-level rules (one token, one
  # connection; who the directory means; what a failure looks like) live in
  # specs/identity/scim-connection-sync.feature.

  Background:
    Given an organization on the ENTERPRISE plan
    And SCIM provisioning is enabled for the organization

  # --- The reconciler (grants ledger, ADR-092 §13) ---

  @integration @unimplemented
  Scenario: A replayed SCIM push changes nothing
    Given group "abc-123" already has exactly the members the IdP declares
    When Entra pushes the same full member list again
    Then no grant or membership fact is written
    And the push succeeds

  @integration @unimplemented
  Scenario: An IdP removal takes effect before the push returns, with the queue stopped
    Given user "user-1" is a member of group "abc-123" and the group holds a role
    And the queue infrastructure is stopped
    When Entra pushes a member list without "user-1"
    Then the push succeeds
    And "user-1"'s next permission check no longer resolves the group's role

  # --- SCIM group ingestion ---

  @integration @unimplemented
  Scenario: Entra pushes a new group via SCIM
    Given no Group exists for external group "abc-123"
    When Entra pushes a SCIM POST /Groups with externalId "abc-123" and displayName "clienta-dev-ro"
    Then a Group record is created with scimSource "scim", externalId "abc-123", and name "clienta-dev-ro"
    And the group has no RoleBindings assigned

  @integration @unimplemented
  Scenario: Entra pushes a group that already exists
    Given a Group already exists for external group "abc-123"
    When Entra pushes a SCIM POST /Groups with externalId "abc-123"
    Then the request returns a 409 conflict error

  @integration @unimplemented
  Scenario: Entra pushes members for a group with no RoleBindings
    Given a Group exists for external group "abc-123" with no RoleBindings
    And user "user-1" is a member of the organization
    When Entra pushes a SCIM PATCH adding user "user-1" to group "abc-123"
    Then the SCIM request returns a success response
    And a GroupMembership record is created linking user "user-1" to the group
    And no access is granted until a RoleBinding is assigned to the group

  @integration @unimplemented
  Scenario: Entra pushes members for a group that has a RoleBinding
    Given a Group exists for external group "abc-123" with a RoleBinding: VIEWER on team "client-a"
    And user "user-1" is a member of the organization
    When Entra pushes a SCIM PATCH adding user "user-1" to group "abc-123"
    Then a GroupMembership record is created linking user "user-1" to the group
    And user "user-1" inherits the group's VIEWER binding on team "client-a" via the RBAC resolver

  @integration @unimplemented
  Scenario: Entra removes a member from a group
    Given a Group exists for external group "abc-123" with a RoleBinding: VIEWER on team "client-a"
    And user "user-1" has a GroupMembership for the group
    When Entra pushes a SCIM PATCH removing user "user-1" from group "abc-123"
    Then the GroupMembership record for user "user-1" is deleted
    And user "user-1" no longer inherits access from the group

  @integration @unimplemented
  Scenario: Entra replaces full member list on a group
    Given a Group exists for external group "abc-123"
    And the group has GroupMembership records for "user-1" and "user-2"
    When Entra pushes a SCIM PUT replacing group "abc-123" members with "user-2" and "user-3"
    Then the GroupMembership for "user-1" is removed
    Then a GroupMembership for "user-3" is created
    And "user-2" retains their GroupMembership

  @integration @unimplemented
  Scenario: Entra deletes a SCIM group
    Given a Group exists for external group "abc-123" with a RoleBinding on team "client-a"
    And users "user-1" and "user-2" have GroupMembership records for the group
    When Entra pushes a SCIM DELETE for group "abc-123"
    Then the Group record for "abc-123" is removed
    And all GroupMembership records for the group are removed
    And all RoleBindings on the group are removed

  # --- Group binding management (admin API) ---

  @integration @unimplemented
  Scenario: Admin lists all SCIM groups
    Given three groups with scimSource "scim" have been pushed by Entra
    When the admin requests the list of groups
    Then all three groups are returned with their names and member counts

  @integration @unimplemented
  Scenario: Admin adds a RoleBinding to a SCIM group
    Given a Group exists for external group "abc-123" with no RoleBindings
    When the admin adds a RoleBinding: MEMBER at scope team "client-a" to the group
    Then the RoleBinding is saved linking the group to team "client-a" with role MEMBER
    And all current GroupMembership members inherit MEMBER access on team "client-a"

  @integration @unimplemented
  Scenario: Admin removes a RoleBinding from a SCIM group
    Given a Group exists for external group "abc-123" with a RoleBinding: MEMBER on team "client-a"
    When the admin removes the RoleBinding
    Then the RoleBinding is deleted
    And group members no longer have access to team "client-a" via this group

  @integration @unimplemented
  Scenario: Admin deletes a SCIM group
    Given a Group exists for external group "abc-123" with members and RoleBindings
    When the admin deletes the group
    Then the Group record is removed
    And all GroupMembership and RoleBinding records for the group are removed

  @integration @unimplemented
  Scenario: Non-enterprise org cannot access group management endpoints
    Given the organization plan is not ENTERPRISE
    When the admin attempts to list groups
    Then the request is rejected with FORBIDDEN

  @integration @unimplemented
  Scenario: Non-admin user cannot manage group bindings
    Given a user with MEMBER role in the organization
    When the user attempts to add a RoleBinding to a group
    Then the request is rejected with FORBIDDEN

  # --- Role conflict resolution ---
  # Built-in roles have a clear hierarchy: ADMIN > MEMBER > VIEWER
  # Users in multiple groups inherit the highest role at each scope

  @unit
  Scenario: User with multiple roles resolves to the most permissive
    Given a user has roles [VIEWER, MEMBER] from different group bindings at the same scope
    When the effective role is resolved
    Then the result is MEMBER

  @unit
  Scenario: Role hierarchy resolves ADMIN as most permissive
    Given a user has roles [MEMBER, ADMIN] from different group bindings
    When the effective role is resolved
    Then the result is ADMIN

  @unit
  Scenario: Removing a binding recalculates to remaining most permissive
    Given a user has roles [VIEWER, MEMBER] from two group bindings
    When the MEMBER binding is removed
    Then the effective role recalculates to VIEWER

  @unit
  Scenario: Role hierarchy ordering
    Given the role hierarchy for conflict resolution
    Then ADMIN is more permissive than MEMBER
    And MEMBER is more permissive than VIEWER

  @integration @unimplemented
  Scenario: Custom role is available when assigning a binding to a group
    Given the organization has a custom role "Auditor" with permissions
    When the admin opens the role dropdown to assign a binding to a group
    Then "Auditor" appears alongside ADMIN, MEMBER, and VIEWER

  # --- User deprovisioning ---

  # The customer's reason for deprovisioning is usually that somebody left
  # under a cloud, so the postcondition is the deliverable: not "these
  # records were deleted" but "nothing resolves for this person here any
  # more", checked before the removal is allowed to stand. A removal that
  # cannot prove it fails loudly rather than passing quietly.
  #
  # Calibration, so nobody reads the deactivate scenario as a live breach:
  # today a deprovision leaves grants in place and deactivation does block
  # sign-in and API-key verification, so the retained authority is LATENT.
  # What it costs is a decision - reactivating somebody restores everything
  # they held on the day they left, with nobody choosing that. Reactivation
  # is therefore re-entry, not undo; specs/identity/scim-connection-sync.feature
  # carries what a return does and does not restore.

  @integration @unimplemented
  Scenario: Deprovisioned user's org membership and role bindings are cleaned up
    Given user "user-1" is a member of the organization
    And user "user-1" has GroupMembership records for groups "abc-123" and "def-456"
    And user "user-1" has direct RoleBindings in the organization
    When Entra pushes a SCIM DELETE for user "user-1"
    Then user "user-1" is deactivated
    And the removal is proved to have left nothing resolving for "user-1" in the organization
    And a permission check for "user-1" in the organization answers no, everywhere

  @integration @unimplemented
  Scenario: Deactivating a user deprovisions them with the same proof
    Given user "user-1" is a member of the organization with access through group "abc-123"
    When Entra pushes user "user-1" as inactive
    Then the removal is proved to have left nothing resolving for "user-1" in the organization
    And "user-1"'s next permission check answers no

  @unit @unimplemented
  Scenario: A deprovision that cannot prove itself empty fails loudly
    Given a deprovision of "user-1" whose proof still finds access resolving for them
    When the deprovision is applied
    Then it is refused with code offboard_incomplete and status 500
    And "user-1"'s access is exactly what it was before the push
    And the failure is surfaced rather than retried into silence

  @integration @unimplemented
  Scenario: Reactivating a deprovisioned user restores no access on its own
    Given user "user-1" was pushed inactive and their access was removed
    When Entra pushes user "user-1" as active again
    Then "user-1" can sign in
    And "user-1" holds no access until a push asserts it again

  # --- SCIM Settings UI ---

  @integration @unimplemented
  Scenario: Admin views SCIM groups table
    Given SCIM groups "clienta-dev-ro", "clienta-dev-rw", and "clienta-dev-admin" have been pushed
    And "clienta-dev-rw" has a RoleBinding: MEMBER on team "client-a"
    When the admin visits the SCIM settings page
    Then a table shows all three groups
    And "clienta-dev-rw" shows its binding with scope and role
    And the other two groups show no bindings

  @integration @unimplemented
  Scenario: Admin sees member count per group
    Given a SCIM group "clienta-dev-rw" has 5 GroupMembership records
    When the admin views the SCIM settings page
    Then the group row shows a member count of 5

  @integration @unimplemented
  Scenario: Admin assigns a RoleBinding to a group via the settings UI
    Given a SCIM group "clienta-dev-ro" appears in the settings table with no bindings
    When the admin selects a scope and role for the group and saves
    Then the RoleBinding is created and the group row reflects the new binding

  # --- Permission inheritance ---

  @integration @unimplemented
  Scenario: Group member's access is resolved through standard RBAC
    Given a user is a GroupMembership member of a group with a RoleBinding: VIEWER on team "client-a"
    When the platform resolves the user's role on a project in team "client-a"
    Then permission resolution uses the standard RoleBinding resolver
    And no SCIM-specific permission logic is invoked

  @integration @unimplemented
  Scenario: Org admin override applies for SCIM-managed group members
    Given an organization admin who is also a GroupMembership member of a group with VIEWER binding
    When the admin accesses any resource in the organization
    Then the org ADMIN override grants full access regardless of the group binding role
