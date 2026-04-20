Feature: SCIM Group Mapping
  As an organization admin
  I want SCIM-provisioned groups to be stored as Groups in LangWatch and assigned RoleBindings
  So that identity-provider group membership automatically grants scoped access

  Background:
    Given an organization on the ENTERPRISE plan
    And SCIM provisioning is enabled for the organization

  # --- SCIM group ingestion ---

  @integration
  Scenario: Entra pushes a new group via SCIM
    Given no Group exists for external group "abc-123"
    When Entra pushes a SCIM POST /Groups with externalId "abc-123" and displayName "clienta-dev-ro"
    Then a Group record is created with scimSource "scim", externalId "abc-123", and name "clienta-dev-ro"
    And the group has no RoleBindings assigned

  @integration
  Scenario: Entra pushes a group that already exists
    Given a Group already exists for external group "abc-123"
    When Entra pushes a SCIM POST /Groups with externalId "abc-123"
    Then the request returns a 409 conflict error

  @integration
  Scenario: Entra pushes members for a group with no RoleBindings
    Given a Group exists for external group "abc-123" with no RoleBindings
    And user "user-1" is a member of the organization
    When Entra pushes a SCIM PATCH adding user "user-1" to group "abc-123"
    Then the SCIM request returns a success response
    And a GroupMembership record is created linking user "user-1" to the group
    And no access is granted until a RoleBinding is assigned to the group

  @integration
  Scenario: Entra pushes members for a group that has a RoleBinding
    Given a Group exists for external group "abc-123" with a RoleBinding: VIEWER on team "client-a"
    And user "user-1" is a member of the organization
    When Entra pushes a SCIM PATCH adding user "user-1" to group "abc-123"
    Then a GroupMembership record is created linking user "user-1" to the group
    And user "user-1" inherits the group's VIEWER binding on team "client-a" via the RBAC resolver

  @integration
  Scenario: Entra removes a member from a group
    Given a Group exists for external group "abc-123" with a RoleBinding: VIEWER on team "client-a"
    And user "user-1" has a GroupMembership for the group
    When Entra pushes a SCIM PATCH removing user "user-1" from group "abc-123"
    Then the GroupMembership record for user "user-1" is deleted
    And user "user-1" no longer inherits access from the group

  @integration
  Scenario: Entra replaces full member list on a group
    Given a Group exists for external group "abc-123"
    And the group has GroupMembership records for "user-1" and "user-2"
    When Entra pushes a SCIM PUT replacing group "abc-123" members with "user-2" and "user-3"
    Then the GroupMembership for "user-1" is removed
    Then a GroupMembership for "user-3" is created
    And "user-2" retains their GroupMembership

  @integration
  Scenario: Entra deletes a SCIM group
    Given a Group exists for external group "abc-123" with a RoleBinding on team "client-a"
    And users "user-1" and "user-2" have GroupMembership records for the group
    When Entra pushes a SCIM DELETE for group "abc-123"
    Then the Group record for "abc-123" is removed
    And all GroupMembership records for the group are removed
    And all RoleBindings on the group are removed

  # --- Group binding management (admin API) ---

  @integration
  Scenario: Admin lists all SCIM groups
    Given three groups with scimSource "scim" have been pushed by Entra
    When the admin requests the list of groups
    Then all three groups are returned with their names and member counts

  @integration
  Scenario: Admin adds a RoleBinding to a SCIM group
    Given a Group exists for external group "abc-123" with no RoleBindings
    When the admin adds a RoleBinding: MEMBER at scope team "client-a" to the group
    Then the RoleBinding is saved linking the group to team "client-a" with role MEMBER
    And all current GroupMembership members inherit MEMBER access on team "client-a"

  @integration
  Scenario: Admin removes a RoleBinding from a SCIM group
    Given a Group exists for external group "abc-123" with a RoleBinding: MEMBER on team "client-a"
    When the admin removes the RoleBinding
    Then the RoleBinding is deleted
    And group members no longer have access to team "client-a" via this group

  @integration
  Scenario: Admin deletes a SCIM group
    Given a Group exists for external group "abc-123" with members and RoleBindings
    When the admin deletes the group
    Then the Group record is removed
    And all GroupMembership and RoleBinding records for the group are removed

  @integration
  Scenario: Non-enterprise org cannot access group management endpoints
    Given the organization plan is not ENTERPRISE
    When the admin attempts to list groups
    Then the request is rejected with FORBIDDEN

  @integration
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

  @integration
  Scenario: Custom role is available when assigning a binding to a group
    Given the organization has a custom role "Auditor" with permissions
    When the admin opens the role dropdown to assign a binding to a group
    Then "Auditor" appears alongside ADMIN, MEMBER, and VIEWER

  # --- User deprovisioning ---

  @integration
  Scenario: Deprovisioned user's org membership and role bindings are cleaned up
    Given user "user-1" is a member of the organization
    And user "user-1" has GroupMembership records for groups "abc-123" and "def-456"
    And user "user-1" has direct RoleBindings in the organization
    When Entra pushes a SCIM DELETE for user "user-1"
    Then user "user-1" is deactivated
    And all direct RoleBinding records for user "user-1" are removed
    And user "user-1"'s organization membership is removed

  # --- SCIM Settings UI ---

  @integration
  Scenario: Admin views SCIM groups table
    Given SCIM groups "clienta-dev-ro", "clienta-dev-rw", and "clienta-dev-admin" have been pushed
    And "clienta-dev-rw" has a RoleBinding: MEMBER on team "client-a"
    When the admin visits the SCIM settings page
    Then a table shows all three groups
    And "clienta-dev-rw" shows its binding with scope and role
    And the other two groups show no bindings

  @integration
  Scenario: Admin sees member count per group
    Given a SCIM group "clienta-dev-rw" has 5 GroupMembership records
    When the admin views the SCIM settings page
    Then the group row shows a member count of 5

  @integration
  Scenario: Admin assigns a RoleBinding to a group via the settings UI
    Given a SCIM group "clienta-dev-ro" appears in the settings table with no bindings
    When the admin selects a scope and role for the group and saves
    Then the RoleBinding is created and the group row reflects the new binding

  # --- Permission inheritance ---

  @integration
  Scenario: Group member's access is resolved through standard RBAC
    Given a user is a GroupMembership member of a group with a RoleBinding: VIEWER on team "client-a"
    When the platform resolves the user's role on a project in team "client-a"
    Then permission resolution uses the standard RoleBinding resolver
    And no SCIM-specific permission logic is invoked

  @integration
  Scenario: Org admin override applies for SCIM-managed group members
    Given an organization admin who is also a GroupMembership member of a group with VIEWER binding
    When the admin accesses any resource in the organization
    Then the org ADMIN override grants full access regardless of the group binding role
