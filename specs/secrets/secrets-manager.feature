Feature: Secrets Manager
  As a project member
  I want secrets to be governed by the RBAC permission system
  So that access to sensitive credentials is controlled by team roles

  Scenario: Secrets resource is registered in the RBAC system
    Given the RBAC permission system is configured
    Then the "secrets" resource exists in the Resources enum
    And the ADMIN role includes "secrets:view" and "secrets:manage" permissions
    And the MEMBER role includes "secrets:view" and "secrets:manage" permissions
    And the VIEWER role includes "secrets:view" but not "secrets:manage"
    And the CUSTOM fallback role includes "secrets:view" but not "secrets:manage"
    And organization role permissions are unchanged
    And "secrets" appears in the ordered resources for the permissions UI
    And the valid actions for "secrets" are "view" and "manage"
