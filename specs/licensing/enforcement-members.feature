@wip @integration
Feature: Member Limit Enforcement with License
  As a LangWatch self-hosted deployment with a license
  I want the member invite limit to be enforced
  So that organizations respect their licensed seat count

  Background:
    Given an organization "org-123" exists
    And I am authenticated as an admin of "org-123"
    And a team "team-456" exists in the organization

  # ============================================================================
  # License-Based Member Limits
  # ============================================================================

  Scenario: Allows invite when under member limit
    Given the organization has 3 accepted members
    And the organization has a license with maxMembers 5
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  Scenario: Blocks invite when at member limit
    Given the organization has 3 accepted members
    And the organization has a license with maxMembers 3
    When I invite user "new@example.com" to the organization
    Then the request fails with FORBIDDEN
    And the error message contains "Over the limit of invites allowed"

  Scenario: Blocks invite when over member limit
    Given the organization has 3 accepted members
    And the organization has a license with maxMembers 2
    When I invite user "new@example.com" to the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # No License (Unlimited when enforcement disabled)
  # ============================================================================

  Scenario: No license allows unlimited members when enforcement disabled
    Given the organization has 3 accepted members
    And LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  Scenario: No license with 100 existing members still allows invites when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    And the organization has 100 accepted members
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  # ============================================================================
  # Invalid/Expired License (FREE Tier)
  # ============================================================================

  Scenario: Expired license enforces FREE tier member limit
    Given the organization has an expired license
    And the organization has 2 accepted members
    When I invite user "new@example.com" to the organization
    Then the request fails with FORBIDDEN
    And the error message contains "Over the limit of invites allowed"

  Scenario: Invalid license enforces FREE tier member limit
    Given the organization has an invalid license signature
    And the organization has 1 accepted member
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  Scenario: Invalid license blocks at FREE tier limit
    Given the organization has an invalid license signature
    And the organization has 2 accepted members
    When I invite user "new@example.com" to the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Feature Flag Override
  # ============================================================================

  Scenario: Feature flag disabled allows unlimited even with license
    Given the organization has 3 accepted members
    And the organization has a license with maxMembers 3
    And LICENSE_ENFORCEMENT_ENABLED is "false"
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  # ============================================================================
  # Bulk Invites
  # ============================================================================

  Scenario: Blocks bulk invite that would exceed limit
    Given the organization has a license with maxMembers 5
    And the organization has 3 accepted members
    When I invite users "a@example.com,b@example.com,c@example.com" to the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Pending Invites Count Toward Member Limit
  # ============================================================================

  Scenario: Pending invites count toward total member limit
    Given the organization has 2 accepted members
    And the organization has 2 pending invites
    And the organization has a license with maxMembers 4
    When I invite user "new@example.com" to the organization
    Then the request fails with FORBIDDEN
    And the error message contains "Over the limit of invites allowed"

  Scenario: Allows invite when pending invites plus members under limit
    Given the organization has 2 accepted members
    And the organization has 1 pending invite
    And the organization has a license with maxMembers 5
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  Scenario: Expired invites do not count toward member limit
    Given the organization has 2 accepted members
    And the organization has 2 expired pending invites
    And the organization has a license with maxMembers 4
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  Scenario: Only non-expired pending invites count toward limit
    Given the organization has 2 accepted members
    And the organization has 1 pending invite
    And the organization has 1 expired pending invite
    And the organization has a license with maxMembers 4
    When I invite user "new@example.com" to the organization
    Then the invite is created successfully

  # ============================================================================
  # Lite Member vs Full Member Classification
  # ============================================================================
  # Lite Member: EXTERNAL role (with view-only or no custom permissions)
  # Full Member: ADMIN/MEMBER role OR any role with non-view permissions

  Scenario: Lite Member users are counted separately from full members
    Given the organization has 2 Full Members
    And the organization has 1 Lite Member with role EXTERNAL
    And the organization has a license with maxMembers 3 and maxMembersLite 2
    When I invite user "new@example.com" as EXTERNAL to the organization
    Then the invite is created successfully

  Scenario: Lite Member pending invites count toward Lite Member limit
    Given the organization has 2 Full Members
    And the organization has 1 pending invite with role EXTERNAL
    And the organization has a license with maxMembers 3 and maxMembersLite 1
    When I invite user "new@example.com" as EXTERNAL to the organization
    Then the request fails with FORBIDDEN
    And the error message contains "Over the limit of lite members allowed"

  Scenario: ADMIN role users count as Full Member
    Given the organization has 2 Full Members with role ADMIN
    And the organization has a license with maxMembers 2
    When I invite user "new@example.com" as ADMIN to the organization
    Then the request fails with FORBIDDEN

  Scenario: MEMBER role users count as Full Member
    Given the organization has 2 Full Members with role MEMBER
    And the organization has a license with maxMembers 2
    When I invite user "new@example.com" as MEMBER to the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Custom Role Classification
  # ============================================================================

  Scenario: Custom role with only view permissions counts as Lite Member
    Given a custom role "Viewer" exists with permissions:
      | project:view    |
      | analytics:view  |
      | traces:view     |
    And the organization has 2 Full Members
    And the organization has 1 Lite Member with custom role "Viewer"
    And the organization has a license with maxMembers 3 and maxMembersLite 2
    When I invite user "new@example.com" with custom role "Viewer" to the organization
    Then the invite is created successfully

  Scenario: Custom role with manage permission counts as Full Member
    Given a custom role "Manager" exists with permissions:
      | project:view    |
      | analytics:manage |
    And the organization has 2 Full Members
    And the organization has a license with maxMembers 2
    When I invite user "new@example.com" with custom role "Manager" to the organization
    Then the request fails with FORBIDDEN

  Scenario: Custom role with create permission counts as Full Member
    Given a custom role "Creator" exists with permissions:
      | project:view    |
      | project:create  |
    And the organization has 2 Full Members
    And the organization has a license with maxMembers 2
    When I invite user "new@example.com" with custom role "Creator" to the organization
    Then the request fails with FORBIDDEN

  Scenario: Custom role with update permission counts as Full Member
    Given a custom role "Editor" exists with permissions:
      | project:view    |
      | project:update  |
    And the organization has 2 Full Members
    And the organization has a license with maxMembers 2
    When I invite user "new@example.com" with custom role "Editor" to the organization
    Then the request fails with FORBIDDEN

  Scenario: Custom role with delete permission counts as Full Member
    Given a custom role "Deleter" exists with permissions:
      | project:view    |
      | project:delete  |
    And the organization has 2 Full Members
    And the organization has a license with maxMembers 2
    When I invite user "new@example.com" with custom role "Deleter" to the organization
    Then the request fails with FORBIDDEN

  Scenario: Custom role with share permission counts as Full Member
    Given a custom role "Sharer" exists with permissions:
      | traces:view     |
      | traces:share    |
    And the organization has 2 Full Members
    And the organization has a license with maxMembers 2
    When I invite user "new@example.com" with custom role "Sharer" to the organization
    Then the request fails with FORBIDDEN

  Scenario: Pending invite with view-only custom role counts as Lite Member
    Given a custom role "Viewer" exists with permissions:
      | project:view    |
      | analytics:view  |
    And the organization has 2 Full Members
    And the organization has 1 pending invite with custom role "Viewer"
    And the organization has a license with maxMembers 3 and maxMembersLite 1
    When I invite user "new@example.com" with custom role "Viewer" to the organization
    Then the request fails with FORBIDDEN
    And the error message contains "Over the limit of lite members allowed"

  Scenario: Pending invite with non-view custom role counts as Full Member
    Given a custom role "Manager" exists with permissions:
      | project:view    |
      | project:manage  |
    And the organization has 1 Full Member
    And the organization has 1 pending invite with custom role "Manager"
    And the organization has a license with maxMembers 2
    When I invite user "new@example.com" as MEMBER to the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Member Type Classification Helper Functions
  # ============================================================================

  @unit
  Scenario: isViewOnlyPermission identifies view-only permissions
    Given the permission "project:view"
    When I check if the permission is view-only
    Then the result is true

  @unit
  Scenario: isViewOnlyPermission identifies non-view permissions
    Given the permission "project:manage"
    When I check if the permission is view-only
    Then the result is false

  @unit
  Scenario: isViewOnlyCustomRole returns true for view-only role
    Given a custom role with permissions ["project:view", "analytics:view", "traces:view"]
    When I check if the role is view-only
    Then the result is true

  @unit
  Scenario: isViewOnlyCustomRole returns false for role with manage permission
    Given a custom role with permissions ["project:view", "project:manage"]
    When I check if the role is view-only
    Then the result is false

  @unit
  Scenario: classifyMemberType returns MemberLite for EXTERNAL role
    Given a user with OrganizationUserRole EXTERNAL
    When I classify the member type
    Then the result is "MemberLite"

  @unit
  Scenario: classifyMemberType returns FullMember for ADMIN role
    Given a user with OrganizationUserRole ADMIN
    When I classify the member type
    Then the result is "FullMember"

  @unit
  Scenario: classifyMemberType returns FullMember for MEMBER role
    Given a user with OrganizationUserRole MEMBER
    When I classify the member type
    Then the result is "FullMember"

  @unit
  Scenario: classifyMemberType returns MemberLite for view-only custom role
    Given a user with EXTERNAL role and custom role with permissions ["project:view"]
    When I classify the member type
    Then the result is "MemberLite"

  @unit
  Scenario: classifyMemberType returns FullMember for custom role with non-view permission
    Given a user with EXTERNAL role and custom role with permissions ["project:view", "project:update"]
    When I classify the member type
    Then the result is "FullMember"

  # ============================================================================
  # UI: Click-then-Modal Pattern
  # ============================================================================

  @unit
  Scenario: Add members button is always clickable when admin
    Given the organization has a license with maxMembers 3
    And the organization has 3 members (at limit)
    And I am authenticated as an admin of the organization
    When I view the members page
    Then the "Add members" button is enabled
    And the "Add members" button is not visually disabled

  @unit
  Scenario: Clicking Add members at limit shows upgrade modal
    Given the organization has a license with maxMembers 3
    And the organization has 3 members (at limit)
    And I am authenticated as an admin of the organization
    When I click the "Add members" button
    Then an upgrade modal is displayed
    And the modal shows "team members: 3 / 3"
    And the modal includes an upgrade call-to-action

  @unit
  Scenario: Clicking Add members when allowed opens add members form
    Given the organization has a license with maxMembers 5
    And the organization has 3 members (under limit)
    And I am authenticated as an admin of the organization
    When I click the "Add members" button
    Then the add members dialog is displayed
    And no upgrade modal is shown

  @unit
  Scenario: Add members button disabled for non-admin (permission check)
    Given the organization has a license with maxMembers 5
    And I am authenticated as a non-admin member of the organization
    When I view the members page
    Then the "Add members" button is disabled
    And the button has tooltip "You need admin privileges to add members"

  # ============================================================================
  # Role Update Limit Checks
  # ============================================================================

  Scenario: Blocks upgrade from Lite Member to full member when at member limit
    Given the organization has 3 Full Members
    And the organization has 1 Lite Member user "lite@example.com"
    And the organization has a license with maxMembers 3
    When I update "lite@example.com" org role to MEMBER
    Then the request fails with FORBIDDEN
    And the error message contains "member limit reached"

  Scenario: Allows upgrade from Lite Member to full member when under limit
    Given the organization has 2 Full Members
    And the organization has 1 Lite Member user "lite@example.com"
    And the organization has a license with maxMembers 3
    When I update "lite@example.com" org role to MEMBER
    Then the update succeeds

  Scenario: Blocks downgrade from full member to Lite Member when at lite limit
    Given the organization has 2 Full Members including "member@example.com"
    And the organization has 1 Lite Member
    And the organization has a license with maxMembersLite 1
    When I update "member@example.com" org role to EXTERNAL
    Then the request fails with FORBIDDEN
    And the error message contains "Lite Member limit reached"

  Scenario: Allows downgrade from full member to Lite Member when under limit
    Given the organization has 2 Full Members including "member@example.com"
    And the organization has 0 Lite Member users
    And the organization has a license with maxMembersLite 1
    When I update "member@example.com" org role to EXTERNAL
    Then the update succeeds

  Scenario: Blocks custom role change that would exceed full member limit
    Given the organization has 3 Full Members
    And the organization has 1 Lite Member with view-only custom role "viewer-role"
    And the organization has a license with maxMembers 3
    When I change "viewer-role" to include manage permissions
    Then the request fails with FORBIDDEN
    And the error message contains "member limit reached"

  Scenario: Allows custom role change when member type unchanged
    Given the organization has 2 Full Members
    And the organization has a license with maxMembers 3
    When a Full Member's custom role is changed to another non-view role
    Then the update succeeds

  # ============================================================================
  # Role Change Type Detection (Unit)
  # ============================================================================

  @unit
  Scenario: getRoleChangeType returns no-change when both roles are Full Member
    Given a user with role ADMIN and no custom permissions
    When I check the role change type to MEMBER with no custom permissions
    Then the result is "no-change"

  @unit
  Scenario: getRoleChangeType returns no-change when both roles are Lite Member
    Given a user with role EXTERNAL and view-only permissions ["project:view"]
    When I check the role change type to EXTERNAL with view-only permissions ["analytics:view"]
    Then the result is "no-change"

  @unit
  Scenario: getRoleChangeType returns lite-to-full when upgrading EXTERNAL to MEMBER
    Given a user with role EXTERNAL and no custom permissions
    When I check the role change type to MEMBER with no custom permissions
    Then the result is "lite-to-full"

  @unit
  Scenario: getRoleChangeType returns lite-to-full when view-only role gets manage permission
    Given a user with role EXTERNAL and view-only permissions ["project:view"]
    When I check the role change type to EXTERNAL with permissions ["project:view", "project:manage"]
    Then the result is "lite-to-full"

  @unit
  Scenario: getRoleChangeType returns full-to-lite when downgrading MEMBER to EXTERNAL
    Given a user with role MEMBER and no custom permissions
    When I check the role change type to EXTERNAL with no custom permissions
    Then the result is "full-to-lite"

  @unit
  Scenario: getRoleChangeType returns full-to-lite when non-view role becomes view-only
    Given a user with role EXTERNAL and permissions ["project:manage"]
    When I check the role change type to EXTERNAL with view-only permissions ["project:view"]
    Then the result is "full-to-lite"
