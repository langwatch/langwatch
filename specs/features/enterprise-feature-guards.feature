Feature: Enterprise-only feature guards
  As the LangWatch platform
  I want to restrict RBAC custom roles and Audit Logs to Enterprise plans
  So that these premium features are only available to paying Enterprise customers

  Background:
    Given an organization exists
    And the organization has an active plan

  # --- RBAC Custom Roles: Write operations gated ---

  @unit
  Scenario: Non-enterprise org cannot create custom roles
    Given the organization plan is not ENTERPRISE
    When an admin calls role.create
    Then the request is rejected with FORBIDDEN
    And the error message indicates custom roles require an Enterprise plan

  @unit
  Scenario: Enterprise org can create custom roles
    Given the organization plan is ENTERPRISE
    When an admin calls role.create
    Then the custom role is created successfully

  @unit
  Scenario: Non-enterprise org cannot update custom roles
    Given the organization plan is not ENTERPRISE
    And a custom role exists from when the org was on Enterprise
    When an admin calls role.update
    Then the request is rejected with FORBIDDEN

  @unit
  Scenario: Non-enterprise org cannot assign custom roles to users
    Given the organization plan is not ENTERPRISE
    When an admin calls role.assignToUser
    Then the request is rejected with FORBIDDEN

  # --- RBAC Custom Roles: Cleanup operations allowed on downgrade ---

  @unit
  Scenario: Non-enterprise org can remove custom roles from users
    Given the organization plan is not ENTERPRISE
    And a user has a custom role assigned
    When an admin calls role.removeFromUser
    Then the custom role is removed successfully
    And the user reverts to VIEWER role

  @unit
  Scenario: Non-enterprise org can delete custom roles for cleanup
    Given the organization plan is not ENTERPRISE
    And a custom role exists with no users assigned
    When an admin calls role.delete
    Then the custom role is deleted successfully

  # --- RBAC Custom Roles: Conditional guards on team/invite flows ---

  @unit
  Scenario: Non-enterprise org cannot assign custom roles via team update
    Given the organization plan is not ENTERPRISE
    When an admin updates a team member with a custom role
    Then the request is rejected with FORBIDDEN

  @unit
  Scenario: Non-enterprise org can update team members with built-in roles
    Given the organization plan is not ENTERPRISE
    When an admin updates a team member with the MEMBER role
    Then the update succeeds

  @unit
  Scenario: Non-enterprise org cannot assign custom roles via member role update
    Given the organization plan is not ENTERPRISE
    When an admin updates a member's role to include a custom role
    Then the request is rejected with FORBIDDEN

  @unit
  Scenario: Non-enterprise org cannot invite members with custom roles
    Given the organization plan is not ENTERPRISE
    When an admin creates an invite with a custom role in team assignments
    Then the request is rejected with FORBIDDEN

  @unit
  Scenario: Non-enterprise org can invite members with built-in roles
    Given the organization plan is not ENTERPRISE
    When an admin creates an invite with MEMBER role in team assignments
    Then the invite is created successfully

  @unit
  Scenario: Non-enterprise org cannot create teams with custom role members
    Given the organization plan is not ENTERPRISE
    When an admin creates a team with a member assigned a custom role
    Then the request is rejected with FORBIDDEN

  @unit
  Scenario: Non-enterprise org cannot update team member role to custom role
    Given the organization plan is not ENTERPRISE
    When an admin updates a team member's role to a custom role
    Then the request is rejected with FORBIDDEN

  @unit
  Scenario: Non-enterprise org cannot create invite requests with custom roles
    Given the organization plan is not ENTERPRISE
    When an admin creates an invite request with a custom role in team assignments
    Then the request is rejected with FORBIDDEN

  @unit
  Scenario: Batch invite rejects entirely when any invite has a custom role
    Given the organization plan is not ENTERPRISE
    When an admin creates invites where one uses a custom role and others use built-in roles
    Then the entire batch is rejected with FORBIDDEN

  # --- Audit Logs ---

  @unit
  Scenario: Non-enterprise org cannot access audit logs
    Given the organization plan is not ENTERPRISE
    When a user calls organization.getAuditLogs
    Then the request is rejected with FORBIDDEN
    And the error message indicates audit logs require an Enterprise plan

  @unit
  Scenario: Enterprise org can access audit logs
    Given the organization plan is ENTERPRISE
    When a user calls organization.getAuditLogs
    Then the audit logs are returned successfully

  # --- Enterprise Plan Detection ---

  @unit
  Scenario: Enterprise plan from subscription is recognized
    Given the organization has an ENTERPRISE subscription
    When a feature guard checks the plan
    Then the organization is recognized as enterprise

  @unit
  Scenario: Enterprise plan from license is recognized
    Given the organization has an ENTERPRISE license
    When a feature guard checks the plan
    Then the organization is recognized as enterprise

  @unit
  Scenario: FREE plan is not recognized as enterprise
    Given the organization has a FREE plan
    When a feature guard checks the plan
    Then the organization is not recognized as enterprise

  @unit
  Scenario: OPEN_SOURCE plan is not recognized as enterprise
    Given the organization has an OPEN_SOURCE plan
    When a feature guard checks the plan
    Then the organization is not recognized as enterprise

  @unit
  Scenario: Plan type matching is case-sensitive
    Given the plan type is exactly "ENTERPRISE"
    When a feature guard checks the plan
    Then the organization is recognized as enterprise

  # --- Read-only endpoints remain accessible ---

  @unit
  Scenario: Non-enterprise org can list custom roles
    Given the organization plan is not ENTERPRISE
    And custom roles exist from when the org was on Enterprise
    When a user calls role.getAll
    Then the roles are returned successfully

  @unit
  Scenario: Non-enterprise org can view a custom role
    Given the organization plan is not ENTERPRISE
    And a custom role exists from when the org was on Enterprise
    When a user calls role.getById
    Then the role details are returned successfully

  # --- Error handling ---

  @unit
  Scenario: Guard fails closed when plan lookup fails
    Given the plan provider is unavailable
    When a feature guard checks the plan
    Then the request fails with an error
    And access is denied rather than granted
