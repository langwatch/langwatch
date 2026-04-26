Feature: Enterprise-only feature guards
  As the LangWatch platform
  I want to restrict RBAC custom roles and Audit Logs to Enterprise plans
  So that these premium features are only available to paying Enterprise customers

  Background:
    Given an organization exists
    And the organization has an active plan

  # --- RBAC Custom Roles: Write operations gated ---

  @unit @unimplemented
  Scenario: Non-enterprise org can list custom roles
    Given the organization plan is not ENTERPRISE
    And custom roles exist from when the org was on Enterprise
    When a user calls role.getAll
    Then the roles are returned successfully

  @unit @unimplemented
  Scenario: Non-enterprise org can view a custom role
    Given the organization plan is not ENTERPRISE
    And a custom role exists from when the org was on Enterprise
    When a user calls role.getById
    Then the role details are returned successfully

  # --- Custom role organization ownership validation ---

  @unit @unimplemented
  Scenario: Invite with foreign custom role ID is rejected
    Given the organization plan is ENTERPRISE
    And a custom role exists in a different organization
    When an admin creates an invite using the foreign custom role ID
    Then the invite is rejected with BAD_REQUEST

  @unit @unimplemented
  Scenario: Invite with valid custom role ID succeeds
    Given the organization plan is ENTERPRISE
    And a custom role exists in the same organization
    When an admin creates an invite using the custom role ID
    Then the invite is created successfully

  # --- Error handling ---
