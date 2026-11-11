@unit
Feature: Every organization role reads the directory
  As a member of an organization
  I want to see who is in it and which roles exist
  So that I know whom to ask for access or a seat

  Every organization role, Lite Member included, holds members:view at the
  organization scope. The reads of members, their grants and the custom roles
  declare members:view; every write still declares organization:manage.

  Scenario: A Member lists members and roles
    Given a member with the Member organization role
    When they ask for members:view on the organization
    Then it is allowed

  Scenario: A Lite Member lists members
    Given a member with the Lite Member organization role
    When they ask for members:view on the organization
    Then it is allowed

  Scenario: A Member cannot change a role
    Given a member with the Member organization role
    When they ask for organization:manage on the organization
    Then it is refused with permission_denied

  Scenario: Directory reads declare members:view and writes stay at organization:manage
    Given the grant and role procedures
    Then the member and grant listings and the custom role list declare members:view
    And creating, changing and revoking a grant declare organization:manage
