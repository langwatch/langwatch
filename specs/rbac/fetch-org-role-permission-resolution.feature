@integration
Feature: Fetch org role during permission resolution
  As a LangWatch developer
  I want the user's organization role available during permission resolution
  So that downstream features can use it to restrict access based on org role

  Background:
    Given a user "user-123" exists
    And an organization "org-1" exists
    And a team "team-1" exists in organization "org-1"
    And a project "project-1" exists in team "team-1"

  # ============================================================================
  # Project permission resolution carries org role
  # ============================================================================

  Scenario: Project permission result includes org role for an org admin
    Given user "user-123" is an ADMIN in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When project permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And the org role in the result is ADMIN

  Scenario: Project permission result includes org role for an org member
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When project permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And the org role in the result is MEMBER

  Scenario: Project permission result includes org role for an external user
    Given user "user-123" is a LITE_MEMBER in organization "org-1"
    And user "user-123" is a VIEWER of team "team-1"
    When project permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And the org role in the result is LITE_MEMBER

  Scenario: Project permission result has no org role when user is not an org member
    Given user "user-123" is not a member of organization "org-1"
    When project permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is denied
    And the org role in the result is null

  Scenario: Demo project permission result has no org role
    Given project "project-1" is a demo project
    When project permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And the org role in the result is null

  # ============================================================================
  # Team permission resolution carries org role
  # ============================================================================

  Scenario: Team permission result includes org role for an org admin via admin bypass
    Given user "user-123" is an ADMIN in organization "org-1"
    And user "user-123" is not a member of team "team-1"
    When team permission "team:manage" is checked for user "user-123" on team "team-1"
    Then the permission is granted
    And the org role in the result is ADMIN

  Scenario: Team permission result includes org role for an org member
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When team permission "team:view" is checked for user "user-123" on team "team-1"
    Then the permission is granted
    And the org role in the result is MEMBER

  Scenario: Team permission result includes org role for an external user
    Given user "user-123" is a LITE_MEMBER in organization "org-1"
    And user "user-123" is a VIEWER of team "team-1"
    When team permission "team:view" is checked for user "user-123" on team "team-1"
    Then the permission is granted
    And the org role in the result is LITE_MEMBER

  Scenario: Team permission result has no org role when user is not an org member
    Given user "user-123" is not a member of organization "org-1"
    When team permission "team:view" is checked for user "user-123" on team "team-1"
    Then the permission is denied
    And the org role in the result is null

  # ============================================================================
  # Backward-compatible boolean API unchanged
  # ============================================================================

  Scenario: Boolean permission check still returns true when user has permission
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When project permission "analytics:view" is boolean-checked for user "user-123" on project "project-1"
    Then the boolean result is true

  Scenario: Boolean permission check still returns false when user lacks permission
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a VIEWER of team "team-1"
    When project permission "datasets:manage" is boolean-checked for user "user-123" on project "project-1"
    Then the boolean result is false

  Scenario: Boolean team permission check still returns true when user has permission
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When team permission "team:view" is boolean-checked for user "user-123" on team "team-1"
    Then the boolean result is true

  Scenario: Boolean team permission check still returns false when user lacks permission
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a VIEWER of team "team-1"
    When team permission "team:manage" is boolean-checked for user "user-123" on team "team-1"
    Then the boolean result is false

  # ============================================================================
  # Permission decisions unchanged (regression guard)
  # ============================================================================

  Scenario Outline: Permission decisions are unchanged for all team roles
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a <teamRole> of team "team-1"
    When project permission "<permission>" is checked for user "user-123" on project "project-1"
    Then the permission is <outcome>

    Examples:
      | teamRole | permission       | outcome |
      | ADMIN    | analytics:view   | granted |
      | ADMIN    | datasets:manage  | granted |
      | ADMIN    | team:manage      | granted |
      | MEMBER   | analytics:view   | granted |
      | MEMBER   | datasets:manage  | granted |
      | MEMBER   | team:manage      | denied  |
      | VIEWER   | analytics:view   | granted |
      | VIEWER   | datasets:manage  | denied  |
      | VIEWER   | team:manage      | denied  |

  Scenario: Custom role grant carries org role
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a CUSTOM member of team "team-1" with permissions ["analytics:view", "datasets:view"]
    When project permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And the org role in the result is MEMBER

  Scenario: Custom role denial carries org role
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a CUSTOM member of team "team-1" with permissions ["analytics:view"]
    When project permission "datasets:manage" is checked for user "user-123" on project "project-1"
    Then the permission is denied
    And the org role in the result is MEMBER

  # ============================================================================
  # Middleware passes org role to downstream context
  # ============================================================================

  Scenario: Project permission middleware passes org role to downstream context
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When the project permission middleware runs for "analytics:view" on project "project-1"
    Then downstream context includes org role MEMBER

  Scenario: Team permission middleware passes org role to downstream context
    Given user "user-123" is an ADMIN in organization "org-1"
    When the team permission middleware runs for "team:view" on team "team-1"
    Then downstream context includes org role ADMIN

  Scenario: Project permission middleware still denies unauthorized users
    Given user "user-123" is not a member of any team
    When the project permission middleware runs for "analytics:view" on project "project-1"
    Then the request is denied with UNAUTHORIZED

  Scenario: Team permission middleware still denies unauthorized users
    Given user "user-123" is not a member of any team
    When the team permission middleware runs for "team:view" on team "team-1"
    Then the request is denied with UNAUTHORIZED

  Scenario: Public share fallback middleware passes org role when permitted
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When the public share fallback middleware runs for "analytics:view" on project "project-1"
    Then downstream context includes org role MEMBER

  # ============================================================================
  # Frontend hook exposes org role
  # ============================================================================

  @integration
  Scenario: Organization team project hook exposes org role for a member
    Given user "user-123" is a MEMBER in organization "org-1"
    When the organization team project hook resolves
    Then the hook result includes org role MEMBER

  @integration
  Scenario: Organization team project hook exposes org role for an external user
    Given user "user-123" is a LITE_MEMBER in organization "org-1"
    When the organization team project hook resolves
    Then the hook result includes org role LITE_MEMBER

  @integration
  Scenario: Organization team project hook exposes org role for an admin
    Given user "user-123" is an ADMIN in organization "org-1"
    When the organization team project hook resolves
    Then the hook result includes org role ADMIN

  # ============================================================================
  # Org role correctly resolved across all org role types
  # ============================================================================

  Scenario Outline: Org role is carried for each org role type
    Given user "user-123" is an <orgRole> in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When project permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the org role in the result is <orgRole>

    Examples:
      | orgRole  |
      | ADMIN    |
      | MEMBER   |
      | LITE_MEMBER |
