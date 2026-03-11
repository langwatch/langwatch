@unit
Feature: Organization role available during permission checks
  As a LangWatch developer
  I want the user's organization role included in permission check results
  So that downstream features can restrict access based on org role

  Background:
    Given a user "user-123" exists
    And an organization "org-1" exists
    And a team "team-1" exists in organization "org-1"
    And a project "project-1" exists in team "team-1"

  # ============================================================================
  # Project permission checks include the user's organization role
  # ============================================================================

  Scenario: Admin's org role is included when checking project permissions
    Given user "user-123" is an ADMIN in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And the result includes organization role ADMIN

  Scenario: Member's org role is included when checking project permissions
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And the result includes organization role MEMBER

  Scenario: External user's org role is included when checking project permissions
    Given user "user-123" is an EXTERNAL member of organization "org-1"
    And user "user-123" is a VIEWER of team "team-1"
    When permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And the result includes organization role EXTERNAL

  Scenario: No org role when user is not in the organization
    Given user "user-123" is not a member of organization "org-1"
    When permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is denied
    And no organization role is returned

  Scenario: Demo project grants access without an org role
    Given project "project-1" is a demo project
    When permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And no organization role is returned

  # ============================================================================
  # Team permission checks include the user's organization role
  # ============================================================================

  Scenario: Org admin bypasses team membership and org role is included
    Given user "user-123" is an ADMIN in organization "org-1"
    And user "user-123" is not a member of team "team-1"
    When team permission "team:manage" is checked for user "user-123" on team "team-1"
    Then the permission is granted
    And the result includes organization role ADMIN

  Scenario: Member's org role is included when checking team permissions
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When team permission "team:view" is checked for user "user-123" on team "team-1"
    Then the permission is granted
    And the result includes organization role MEMBER

  Scenario: External user's org role is included when checking team permissions
    Given user "user-123" is an EXTERNAL member of organization "org-1"
    And user "user-123" is a VIEWER of team "team-1"
    When team permission "team:view" is checked for user "user-123" on team "team-1"
    Then the permission is granted
    And the result includes organization role EXTERNAL

  Scenario: No org role for team checks when user is not in the organization
    Given user "user-123" is not a member of organization "org-1"
    When team permission "team:view" is checked for user "user-123" on team "team-1"
    Then the permission is denied
    And no organization role is returned

  # ============================================================================
  # Existing permission behavior is unchanged
  # ============================================================================

  Scenario Outline: Permission decisions are unchanged for all team roles
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a <teamRole> of team "team-1"
    When permission "<permission>" is checked for user "user-123" on project "project-1"
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

  Scenario: Boolean permission API still returns true when granted
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When permission "analytics:view" is boolean-checked for user "user-123" on project "project-1"
    Then the boolean result is true

  Scenario: Boolean permission API still returns false when denied
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a VIEWER of team "team-1"
    When permission "datasets:manage" is boolean-checked for user "user-123" on project "project-1"
    Then the boolean result is false

  Scenario: Boolean team permission API still returns true when granted
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When team permission "team:view" is boolean-checked for user "user-123" on team "team-1"
    Then the boolean result is true

  Scenario: Boolean team permission API still returns false when denied
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a VIEWER of team "team-1"
    When team permission "team:manage" is boolean-checked for user "user-123" on team "team-1"
    Then the boolean result is false

  # ============================================================================
  # Custom roles include org role in result
  # ============================================================================

  Scenario: Custom role grant includes org role in result
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" has a custom role on team "team-1" with permissions ["analytics:view", "datasets:view"]
    When permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the permission is granted
    And the result includes organization role MEMBER

  Scenario: Custom role denial includes org role in result
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" has a custom role on team "team-1" with permissions ["analytics:view"]
    When permission "datasets:manage" is checked for user "user-123" on project "project-1"
    Then the permission is denied
    And the result includes organization role MEMBER

  # ============================================================================
  # Org role is available in request context after authorization
  # ============================================================================

  Scenario: Project-scoped request makes org role available to subsequent handlers
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When a project-scoped request for "analytics:view" on project "project-1" is authorized
    Then the request context includes organization role MEMBER

  Scenario: Team-scoped request makes org role available to subsequent handlers
    Given user "user-123" is an ADMIN in organization "org-1"
    When a team-scoped request for "team:view" on team "team-1" is authorized
    Then the request context includes organization role ADMIN

  Scenario: Unauthorized project-scoped request is still denied
    Given user "user-123" is not a member of any team
    When a project-scoped request for "analytics:view" on project "project-1" is authorized
    Then the request is denied with UNAUTHORIZED

  Scenario: Unauthorized team-scoped request is still denied
    Given user "user-123" is not a member of any team
    When a team-scoped request for "team:view" on team "team-1" is authorized
    Then the request is denied with UNAUTHORIZED

  Scenario: Public share fallback makes org role available when permitted
    Given user "user-123" is a MEMBER in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When a public-share-fallback request for "analytics:view" on project "project-1" is authorized
    Then the request context includes organization role MEMBER

  # ============================================================================
  # Frontend exposes organization role
  # ============================================================================

  @integration
  Scenario: Frontend context includes org role for a member
    Given user "user-123" is a MEMBER in organization "org-1"
    When the frontend loads organization and project context
    Then the context includes organization role MEMBER

  @integration
  Scenario: Frontend context includes org role for an external user
    Given user "user-123" is an EXTERNAL member of organization "org-1"
    When the frontend loads organization and project context
    Then the context includes organization role EXTERNAL

  @integration
  Scenario: Frontend context includes org role for an admin
    Given user "user-123" is an ADMIN in organization "org-1"
    When the frontend loads organization and project context
    Then the context includes organization role ADMIN

  # ============================================================================
  # Org role resolved for all org role types
  # ============================================================================

  Scenario Outline: Org role is included for each org role type
    Given user "user-123" is an <orgRole> in organization "org-1"
    And user "user-123" is a MEMBER of team "team-1"
    When permission "analytics:view" is checked for user "user-123" on project "project-1"
    Then the result includes organization role <orgRole>

    Examples:
      | orgRole  |
      | ADMIN    |
      | MEMBER   |
      | EXTERNAL |
