Feature: Scoped role bindings
  As a LangWatch platform
  I need to resolve a user's effective permissions at any scope (org, team, or project)
  So that organizations can assign fine-grained access without changing the existing team model

  Role bindings attach a principal (user or group) to a named role at a specific scope.
  The most specific scope always wins. Group bindings are expanded via group membership.
  During the migration period, the resolver falls back to TeamUser records when no
  RoleBinding exists for the user at the requested scope.

  Background:
    Given an organization "acme"
    And the following teams in "acme": "client-a", "client-b"
    And the following projects: "clienta-dev" in "client-a", "clienta-prod" in "client-a"

  # ============================================================================
  # Scope resolution — most specific wins
  # ============================================================================

  Scenario: Team-level binding grants access to all projects in that team
    Given user "alice" has a RoleBinding: Member on team "client-a"
    When the platform resolves alice's role on project "clienta-dev"
    Then the effective role is Member

  Scenario: Project-level binding overrides team-level binding
    Given user "alice" has a RoleBinding: Member on team "client-a"
    And user "alice" has a RoleBinding: Viewer on project "clienta-prod"
    When the platform resolves alice's role on project "clienta-prod"
    Then the effective role is Viewer

  Scenario: Project-level binding does not affect other projects in the same team
    Given user "alice" has a RoleBinding: Member on team "client-a"
    And user "alice" has a RoleBinding: Viewer on project "clienta-prod"
    When the platform resolves alice's role on project "clienta-dev"
    Then the effective role is Member

  Scenario: Org-level Admin binding grants access to all teams and projects
    Given user "alice" has a RoleBinding: Admin on org "acme"
    When the platform resolves alice's role on project "clienta-dev"
    Then the effective role is Admin

  Scenario: More specific binding takes precedence over org-level binding
    Given user "alice" has a RoleBinding: Admin on org "acme"
    And user "alice" has a RoleBinding: Viewer on project "clienta-prod"
    When the platform resolves alice's role on project "clienta-prod"
    Then the effective role is Viewer

  # ============================================================================
  # Group-expanded bindings
  # ============================================================================

  Scenario: User inherits role from group binding
    Given group "clienta-dev-ro" has a RoleBinding: Viewer on project "clienta-dev"
    And user "bob" is a member of group "clienta-dev-ro"
    When the platform resolves bob's role on project "clienta-dev"
    Then the effective role is Viewer

  Scenario: User's direct binding overrides group binding at the same scope
    Given group "clienta-viewers" has a RoleBinding: Viewer on team "client-a"
    And user "bob" is a member of group "clienta-viewers"
    And user "bob" has a RoleBinding: Member on team "client-a"
    When the platform resolves bob's role on team "client-a"
    Then the effective role is Member

  Scenario: Multiple group bindings resolve to highest role at same scope
    Given group "clienta-viewers" has a RoleBinding: Viewer on team "client-a"
    And group "clienta-members" has a RoleBinding: Member on team "client-a"
    And user "bob" is a member of group "clienta-viewers"
    And user "bob" is a member of group "clienta-members"
    When the platform resolves bob's role on team "client-a"
    Then the effective role is Member

  Scenario: Group binding at project scope overrides group binding at team scope
    Given group "clienta-team" has a RoleBinding: Member on team "client-a"
    And group "clienta-prod-ro" has a RoleBinding: Viewer on project "clienta-prod"
    And user "bob" is a member of group "clienta-team"
    And user "bob" is a member of group "clienta-prod-ro"
    When the platform resolves bob's role on project "clienta-prod"
    Then the effective role is Viewer

  # ============================================================================
  # No binding → no access
  # ============================================================================

  Scenario: User with no bindings at any scope has no access
    Given user "carol" has no RoleBindings
    When the platform resolves carol's role on project "clienta-dev"
    Then the effective role is null

  Scenario: User with binding on a different team has no access to this team's projects
    Given user "carol" has a RoleBinding: Member on team "client-b"
    When the platform resolves carol's role on project "clienta-dev"
    Then the effective role is null

  # ============================================================================
  # Fallback to TeamUser during migration
  # ============================================================================

  Scenario: User with no RoleBinding falls back to TeamUser record
    Given user "dave" has no RoleBindings
    And user "dave" has a TeamUser record: Member on team "client-a"
    When the platform resolves dave's role on project "clienta-dev"
    Then the effective role is Member

  Scenario: RoleBinding takes precedence over TeamUser when both exist
    Given user "dave" has a RoleBinding: Viewer on team "client-a"
    And user "dave" has a TeamUser record: Admin on team "client-a"
    When the platform resolves dave's role on project "clienta-dev"
    Then the effective role is Viewer

  # ============================================================================
  # Permission checking from effective role
  # ============================================================================

  @unit
  Scenario Outline: Effective role maps to correct permission grants
    Given user "alice" has a RoleBinding: <role> on team "client-a"
    When the platform checks if alice has permission "<permission>" on project "clienta-dev"
    Then the check returns <result>

    Examples:
      | role   | permission       | result  |
      | Admin  | team:manage      | granted |
      | Member | team:manage      | denied  |
      | Viewer | team:manage      | denied  |
      | Admin  | analytics:view   | granted |
      | Member | analytics:view   | granted |
      | Viewer | analytics:view   | granted |
      | Member | datasets:manage  | granted |
      | Viewer | datasets:manage  | denied  |
