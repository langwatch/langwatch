Feature: Roles & access settings page
  As an organization administrator
  I want to see which roles exist and who holds each of them where, and change that
  So that access is granted, narrowed and taken away in one place, never beyond my own

  The page has two tabs. Roles lists the built-in Admin, Member and Viewer roles,
  which cannot be changed, beside the organization's custom roles. Access lists
  every grant, one row each: who holds it, which role, where, and until when.
  It replaced the Role Bindings page, whose address forwards onto the Access tab.

  The server's escalation guard is the authority: nobody grants a role carrying a
  permission they do not hold at that scope. The page only greys out what it can
  already tell is beyond the reader, and reports every refusal the server sends.
  The REST side of the same rules is specs/rbac/grants-rest-api.feature.

  Background:
    Given an organization on the Enterprise plan
    And a reader who may manage the organization

  # ============================================================================
  # Reading who has access
  # ============================================================================

  @integration
  Scenario: Access is an Enterprise feature
    Given an organization that is not on the Enterprise plan
    When the Access tab is opened
    Then it offers a way to contact sales
    And no grant is read at all

  @integration
  Scenario: The Access tab lists every grant in the organization
    Given grants to a member, a group and an API key
    When the Access tab renders
    Then each grant is one row naming who holds it, the role, the scope and its end date
    And an expired grant says it has expired

  @integration
  Scenario: The Access tab narrows by scope and status
    When the reader picks the team scope and the expired status
    Then the grants are read for teams and expired grants only
    And paging onward asks for the next page by its cursor

  # ============================================================================
  # Granting, changing and revoking
  # ============================================================================

  @integration
  Scenario: An administrator grants a role to a member on a scope
    When the reader grants "Viewer" to a member on the organization with an end date
    Then one grant is created for that member, role and scope, ending on that day
    And the reader is told the role was granted

  @integration
  Scenario: The role of a grant is changed in place
    When the reader changes a grant's role to "Member"
    Then that grant's role is changed and its holder and scope stay

  @integration
  Scenario: Revoking access is confirmed first
    When the reader revokes a grant
    Then they are asked to confirm, naming who loses what and where
    And the grant is revoked only after they confirm

  @integration
  Scenario: A reader without manage cannot grant, change or revoke
    Given a reader who may not manage the organization
    When the Access tab renders
    Then granting a role is disabled and no row offers to change or revoke

  # ============================================================================
  # Nobody grants beyond their own access
  # ============================================================================

  @unit @integration
  Scenario: A role beyond the reader's own access is greyed out
    Given a custom role holding a permission the reader does not hold
    When the reader grants a role on the organization
    Then that role is offered but cannot be picked

  @integration
  Scenario: A refused grant tells the reader what they lack
    Given the server refuses a grant with grant_exceeds_caller_permissions
    When the reader grants the role
    Then the refusal reaches the reader as the error the server sent, with its missing permissions

  @integration
  Scenario: Every grant write is gated on managing the organization
    Then listing, granting, changing and revoking grants each require organization:manage

  @integration
  Scenario: A manager grants a role within what they hold
    When a manager grants a custom role whose permissions they hold
    Then the grant is made, bounded by the manager's own session

  @integration
  Scenario: A manager cannot grant themselves a role above their own
    Given a manager who holds organization:manage through a narrow custom role
    When they grant themselves Admin on the organization
    Then it is refused with grant_exceeds_caller_permissions naming what they lack
    And no grant is written

  @integration
  Scenario: A manager cannot widen the role they hold
    When a manager changes their own grant to a custom role with more permissions
    Then it is refused with grant_exceeds_caller_permissions and the grant is unchanged

  @integration
  Scenario: The caller cannot be named in the request
    When a request names its own caller or ledger actor
    Then it is refused before anything is written

  @integration
  Scenario: Another organization's grants, people and scopes are not reachable
    When a request names a grant, a member or a scope of another organization
    Then it is refused as not found and nothing is written

  @unit
  Scenario: The built-in roles are always offered first, once
    Given custom roles, one of which shares a built-in role's id
    When the grant dialog lists the roles
    Then Admin, Member and Viewer come first and each appears once

  # ============================================================================
  # Plans: built-in roles grant on every plan; assigning or creating a custom role is Enterprise
  # ============================================================================

  @unit
  Scenario: Assigning a custom role is refused below Enterprise on every grant door
    Given the organization is on a plan below Enterprise
    When any door that grants (grants, role assignment, invitation, member or team roles) names a custom role
    Then the request is refused with code enterprise_plan_required and meta.feature "RBAC"
    And nothing is written

  @unit
  Scenario: Any plan grants and changes roles, with or without an end date
    Given the organization is on a plan below Enterprise
    When I grant role "member" to a member on a team with an end date, then change it to "viewer"
    Then both succeed and the end date is kept
