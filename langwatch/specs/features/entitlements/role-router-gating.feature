@integration
Feature: Role Router Entitlement Gating
  As a self-hosted administrator
  I want custom role management gated by enterprise license
  So that only enterprise customers can use custom RBAC

  Background:
    Given I am authenticated as an organization admin

  Scenario: Creating custom role requires enterprise license
    Given no LICENSE_KEY is set
    When I call role.create
    Then the request should fail with FORBIDDEN
    And the error should mention "custom-rbac" entitlement

  Scenario: Creating custom role succeeds with enterprise license
    Given LICENSE_KEY is set to "LW-ENT-test"
    When I call role.create with valid data
    Then the role should be created successfully

  Scenario: Updating custom role requires enterprise license
    Given no LICENSE_KEY is set
    And a custom role exists
    When I call role.update
    Then the request should fail with FORBIDDEN
    And the error should mention "custom-rbac" entitlement

  Scenario: Deleting custom role requires enterprise license
    Given no LICENSE_KEY is set
    And a custom role exists
    When I call role.delete
    Then the request should fail with FORBIDDEN
    And the error should mention "custom-rbac" entitlement

  Scenario: Assigning custom role to user requires enterprise license
    Given no LICENSE_KEY is set
    And a custom role exists
    When I call role.assignToUser
    Then the request should fail with FORBIDDEN
    And the error should mention "custom-rbac" entitlement

  Scenario: Removing custom role from user requires enterprise license
    Given no LICENSE_KEY is set
    And a custom role is assigned to a user
    When I call role.removeFromUser
    Then the request should fail with FORBIDDEN
    And the error should mention "custom-rbac" entitlement

  Scenario: OSS users can view default roles
    Given no LICENSE_KEY is set
    When I call role.getAll
    Then I should see the default roles (Admin, Member, Viewer)
    And the request should succeed

  Scenario: Team member assignment with custom role requires enterprise license
    Given no LICENSE_KEY is set
    And a team exists
    When I call team.update with a custom role assignment
    Then the request should fail with FORBIDDEN
    And the error should mention "custom-rbac" entitlement

  Scenario: Creating team with custom role member requires enterprise license
    Given no LICENSE_KEY is set
    When I call team.createTeamWithMembers with a custom role assignment
    Then the request should fail with FORBIDDEN
    And the error should mention "custom-rbac" entitlement

  Scenario: Creating invites with custom role requires enterprise license
    Given no LICENSE_KEY is set
    When I call organization.createInvites with a custom role assignment
    Then the request should fail with FORBIDDEN
    And the error should mention "custom-rbac" entitlement

  Scenario: Updating team member to custom role requires enterprise license
    Given no LICENSE_KEY is set
    And a team member exists with a built-in role
    When I call organization.updateTeamMemberRole with a custom role
    Then the request should fail with FORBIDDEN
    And the error should mention "custom-rbac" entitlement
