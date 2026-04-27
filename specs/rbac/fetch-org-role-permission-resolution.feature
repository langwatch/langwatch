@unit
Feature: Organization role awareness across the platform
  As a LangWatch platform
  I need to know each user's organization role (admin, member, or lite member)
  So that features can tailor access and experience based on role

  Background:
    Given an organization "acme" with a project "chatbot"

  # ============================================================================
  # The platform recognizes each organization role type
  # ============================================================================

  Scenario Outline: Platform identifies the user's organization role
    Given a user who is a <orgRole> in organization "acme"
    And the user has access to project "chatbot"
    When the user accesses the project
    Then the platform identifies them as <orgRole>

    Examples:
      | orgRole  |
      | ADMIN    |
      | MEMBER   |
      | EXTERNAL |

  Scenario: Non-members are denied access
    Given a user who is not a member of organization "acme"
    When the user tries to access project "chatbot"
    Then access is denied

  Scenario: Demo projects are accessible without organization membership
    Given project "chatbot" is a demo project
    When any user accesses the project
    Then access is granted
    And no organization role is associated

  # ============================================================================
  # Existing permissions are unchanged
  # ============================================================================

  Scenario Outline: Team role permissions are unaffected by org role awareness
    Given a user who is a MEMBER in organization "acme"
    And the user is a <teamRole> on the project's team
    When the user attempts an action requiring "<permission>"
    Then the action is <outcome>

    Examples:
      | teamRole | permission       | outcome |
      | ADMIN    | analytics:view   | allowed |
      | ADMIN    | datasets:manage  | allowed |
      | ADMIN    | team:manage      | allowed |
      | MEMBER   | analytics:view   | allowed |
      | MEMBER   | datasets:manage  | allowed |
      | MEMBER   | team:manage      | denied  |
      | VIEWER   | analytics:view   | allowed |
      | VIEWER   | datasets:manage  | denied  |
      | VIEWER   | team:manage      | denied  |

  # ============================================================================
  # Custom roles work alongside org role awareness
  # ============================================================================

  Scenario: Custom role grants are honored and org role is still known
    Given a user who is a MEMBER in organization "acme"
    And the user has a custom role with permissions ["analytics:view", "datasets:view"]
    When the user views analytics
    Then the action is allowed
    And the platform identifies them as MEMBER

  Scenario: Custom role restrictions are honored and org role is still known
    Given a user who is a MEMBER in organization "acme"
    And the user has a custom role with permissions ["analytics:view"]
    When the user attempts to manage datasets
    Then the action is denied
    And the platform identifies them as MEMBER

  # ============================================================================
  # Org admins retain elevated access
  # ============================================================================

  Scenario: Org admin can manage any team regardless of team membership
    Given a user who is an ADMIN in organization "acme"
    And the user is not a member of any team
    When the user manages a team in "acme"
    Then the action is allowed

  # ============================================================================
  # Frontend knows the user's role
  # ============================================================================

  @integration
  Scenario Outline: The UI reflects the user's organization role
    Given a user who is a <orgRole> in organization "acme"
    When the user loads the platform
    Then the UI knows the user is a <orgRole>

    Examples:
      | orgRole  |
      | ADMIN    |
      | MEMBER   |
      | EXTERNAL |
