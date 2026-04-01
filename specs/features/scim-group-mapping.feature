Feature: SCIM Group Mapping
  As an organization admin
  I want to map Entra ID groups pushed via SCIM to LangWatch teams and roles
  So that I can control access and permissions based on my identity provider's group structure

  Background:
    Given an organization on the ENTERPRISE plan
    And SCIM provisioning is enabled for the organization

  # --- SCIM group ingestion ---

  @integration
  Scenario: Entra pushes a new group via SCIM and it is stored as an unmapped mapping
    Given no ScimGroupMapping exists for external group "abc-123"
    When Entra pushes a SCIM POST /Groups with externalId "abc-123" and displayName "clienta-dev-ro"
    Then a ScimGroupMapping record is created with externalGroupId "abc-123" and externalGroupName "clienta-dev-ro"
    And the mapping has no teamId or role assigned

  @integration
  Scenario: Entra pushes a group that already exists as a mapping
    Given a ScimGroupMapping exists for external group "abc-123"
    When Entra pushes a SCIM POST /Groups with externalId "abc-123"
    Then the request returns a 409 conflict error

  @integration
  Scenario: Entra pushes members for an unmapped group
    Given a ScimGroupMapping exists for external group "abc-123" with no team mapping
    When Entra pushes a SCIM PATCH adding user "user-1" to group "abc-123"
    Then the SCIM request returns a success response
    And no TeamUser records are created
    And no ScimGroupMembership records are created

  @integration
  Scenario: Entra pushes members for a mapped group
    Given a ScimGroupMapping exists for external group "abc-123" mapped to team "team-dev" with role VIEWER
    And user "user-1" is a member of the organization
    When Entra pushes a SCIM PATCH adding user "user-1" to group "abc-123"
    Then user "user-1" is added to team "team-dev" with role VIEWER
    And a ScimGroupMembership record links user "user-1" to mapping "abc-123"

  @integration
  Scenario: Entra removes a member from a mapped group
    Given a ScimGroupMapping exists for external group "abc-123" mapped to team "team-dev" with role VIEWER
    And user "user-1" has a ScimGroupMembership for mapping "abc-123" only
    When Entra pushes a SCIM PATCH removing user "user-1" from group "abc-123"
    Then user "user-1" is removed from team "team-dev"
    And the ScimGroupMembership record is deleted

  @integration
  Scenario: Entra replaces full member list on a mapped group
    Given a ScimGroupMapping exists for external group "abc-123" mapped to team "team-dev" with role MEMBER
    And team "team-dev" has members "user-1" and "user-2" via mapping "abc-123"
    When Entra pushes a SCIM PUT replacing group "abc-123" members with "user-2" and "user-3"
    Then user "user-1" is removed from team "team-dev"
    And user "user-3" is added to team "team-dev" with role MEMBER
    And ScimGroupMembership records are updated accordingly

  @integration
  Scenario: Entra deletes a SCIM group
    Given a ScimGroupMapping exists for external group "abc-123" mapped to team "team-dev"
    And user "user-1" has ScimGroupMembership for mapping "abc-123" only
    When Entra pushes a SCIM DELETE for group "abc-123"
    Then the ScimGroupMapping for "abc-123" is removed
    And all ScimGroupMembership records for "abc-123" are removed
    And user "user-1" is removed from team "team-dev"

  @integration
  Scenario: Deleting a SCIM group preserves members who belong via other mappings
    Given a ScimGroupMapping "abc-123" maps to team "team-dev" with role VIEWER
    And a ScimGroupMapping "def-456" also maps to team "team-dev" with role ADMIN
    And user "user-1" has ScimGroupMembership for both mappings
    When Entra pushes a SCIM DELETE for group "abc-123"
    Then user "user-1" remains in team "team-dev"
    And user "user-1" retains role ADMIN from mapping "def-456"
    And ScimGroupMembership for "abc-123" is removed but "def-456" remains

  # --- Mapping CRUD API ---

  @integration
  Scenario: Admin lists unmapped SCIM groups
    Given three SCIM groups have been pushed by Entra
    And one of them has been mapped to a team
    When the admin requests the list of unmapped groups
    Then two unmapped groups are returned with their display names

  @integration
  Scenario: Admin lists all SCIM group mappings
    Given three SCIM groups have been pushed by Entra with various mapping states
    When the admin requests all mappings
    Then all three mappings are returned with their mapping status

  @integration
  Scenario: Admin creates a mapping for an unmapped group to an existing team
    Given an unmapped ScimGroupMapping for group "clienta-dev-rw"
    And a team "team-dev" exists
    When the admin maps group "clienta-dev-rw" to team "team-dev" with role MEMBER
    Then the mapping is saved with the specified team and role
    # Members will arrive on Entra's next sync cycle

  @integration
  Scenario: Admin creates a mapping with a new team created inline
    Given an unmapped ScimGroupMapping for group "clienta-staging-admin"
    And a project "Project A" exists but no team "team-staging"
    When the admin maps group "clienta-staging-admin" with new team "team-staging" under project "Project A", role ADMIN
    Then team "team-staging" is created under project "Project A"
    And the mapping points to the newly created team

  @integration
  Scenario: Admin updates an existing mapping to change the role
    Given a ScimGroupMapping for group "clienta-dev-ro" mapped to team "team-dev" with role VIEWER
    And team "team-dev" has two members via this mapping with role VIEWER
    When the admin updates the mapping to role MEMBER
    Then the mapping role is updated to MEMBER
    And both team members' roles are re-synced to MEMBER

  @integration
  Scenario: Admin deletes a mapping
    Given a ScimGroupMapping for group "clienta-dev-ro" mapped to team "team-dev"
    When the admin deletes the mapping
    Then the mapping is removed
    And members who were only in team "team-dev" via this mapping are removed

  @integration
  Scenario: Non-enterprise org cannot access mapping endpoints
    Given the organization plan is not ENTERPRISE
    When the admin attempts to list SCIM group mappings
    Then the request is rejected with FORBIDDEN

  @integration
  Scenario: Non-admin user cannot manage mappings
    Given a user with MEMBER role in the organization
    When the user attempts to create a SCIM group mapping
    Then the request is rejected with FORBIDDEN

  # --- Role conflict resolution ---
  # Built-in roles have a clear hierarchy: ADMIN > MEMBER > VIEWER
  # Custom roles in mappings: user gets role = CUSTOM with the custom role's permissions
  # Mixed conflict (built-in + custom targeting same team): built-in hierarchy applies,
  # CUSTOM is treated as equivalent to MEMBER for hierarchy comparison

  @unit
  Scenario: User with multiple roles resolves to the most permissive
    Given a user has roles [VIEWER, MEMBER] from different group mappings
    When the effective role is resolved
    Then the result is MEMBER

  @unit
  Scenario: Role hierarchy resolves ADMIN as most permissive
    Given a user has roles [MEMBER, ADMIN] from different group mappings
    When the effective role is resolved
    Then the result is ADMIN

  @unit
  Scenario: Removing a role recalculates to remaining most permissive
    Given a user has roles [VIEWER, MEMBER] from different group mappings
    When the MEMBER role mapping is removed
    Then the effective role recalculates to VIEWER

  @unit
  Scenario: Role hierarchy ordering
    Given the role hierarchy for conflict resolution
    Then ADMIN is more permissive than MEMBER
    And MEMBER is more permissive than VIEWER

  @integration
  Scenario: Custom role is available in mapping role dropdown
    Given the organization has a custom role "Auditor" with permissions
    When the admin opens the role dropdown for a SCIM group mapping
    Then "Auditor" appears alongside ADMIN, MEMBER, and VIEWER

  # --- User deprovisioning interaction ---

  @integration
  Scenario: Deprovisioned user's SCIM group memberships are cleaned up
    Given user "user-1" has ScimGroupMembership for mappings "abc-123" and "def-456"
    And both mappings target team "team-dev"
    When Entra pushes a SCIM DELETE for user "user-1"
    Then user "user-1" is deactivated
    And all ScimGroupMembership records for user "user-1" are removed
    And user "user-1" is removed from team "team-dev"

  # --- SCIM Settings UI ---

  @integration
  Scenario: Admin views SCIM groups table with mapping status
    Given SCIM groups "clienta-dev-ro", "clienta-dev-rw", and "clienta-dev-admin" have been pushed
    And "clienta-dev-rw" is mapped to team "team-dev" with role MEMBER
    When the admin visits the SCIM settings page
    Then a table shows all three groups
    And "clienta-dev-rw" shows as mapped with its team, project, and role
    And the other two groups show as unmapped

  @integration
  Scenario: Admin maps a group using the UI dropdowns
    Given an unmapped SCIM group "clienta-dev-ro" appears in the settings table
    And team "team-dev" exists
    When the admin selects team "team-dev" and role VIEWER for group "clienta-dev-ro"
    And saves the mapping
    Then the group shows as mapped in the table

  @integration
  Scenario: Admin sees member count per mapping
    Given a SCIM group "clienta-dev-rw" mapped to team "team-dev"
    And the mapping has 5 ScimGroupMembership records
    When the admin views the SCIM settings page
    Then the mapping row shows a member count of 5

  @integration
  Scenario: Team dropdown shows all teams grouped by project
    Given projects "Project A" and "Project B" exist
    And "Project A" has teams "team-dev" and "team-staging"
    And "Project B" has team "team-prod"
    When the admin opens the team dropdown in the mapping form
    Then teams are shown grouped by project
    And a "Create new team" option is available

  @integration
  Scenario: Create new team option in the team dropdown
    Given an unmapped SCIM group in the settings table
    And project "Project A" exists
    When the admin selects "Create new team" under "Project A" and enters "new-team"
    Then the new team is created under "Project A" when the mapping is saved

  # --- No changes to SCIM user provisioning or core RBAC ---
  # SCIM-provisioned users remain OrganizationUserRole.MEMBER (unchanged)
  # Team role from group mapping controls project access via standard RBAC

  @integration
  Scenario: Mapped team members are resolved through standard RBAC
    Given a user added to a team via SCIM group mapping with role VIEWER
    When the user accesses a project linked to that team
    Then permission resolution uses the standard resolveProjectPermission path
    And no SCIM-specific permission logic is invoked

  @integration
  Scenario: Org admin override still applies for SCIM-managed team members
    Given an organization admin who is also in a SCIM group mapped with role VIEWER
    When the admin accesses any team
    Then the org ADMIN override grants full access regardless of the SCIM mapping role
