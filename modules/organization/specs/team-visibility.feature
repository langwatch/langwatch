Feature: The organizations graph arrives narrowed to the teams the caller can open
  organization.getAll returns only the teams, and their projects, that the
  caller can open, so a borrower such as the project switcher never re-filters.

  @unit
  Scenario: An organization administrator receives every team
    Given the caller is an administrator of an organization with two teams
    And the caller belongs to only one of them
    When the caller lists their organizations
    Then both teams arrive with their projects

  @unit
  Scenario: An organization member receives only the teams they belong to
    Given the caller is a member of an organization with two teams
    And the caller belongs to only one of them
    When the caller lists their organizations
    Then only the team they belong to arrives

  @unit
  Scenario: A team reached through a binding arrives without a membership row
    Given the caller is a member of an organization
    And a team-scoped binding reaches a team the caller has no membership row on
    When the caller lists their organizations
    Then that team arrives with its projects

  @unit
  Scenario: An administrator binding outranks a stale member row
    Given the caller's membership row says member
    And an organization-scoped administrator binding names the caller
    When the caller lists their organizations
    Then every team arrives

  @unit
  Scenario: A member of no team receives the organization without teams
    Given the caller is a member of an organization
    And the caller belongs to none of its teams
    When the caller lists their organizations
    Then the organization arrives with no teams and no projects

  @unit
  Scenario: A binding in another organization opens nothing here
    Given the caller is a member of an organization
    And the caller's only team binding names a team in another organization
    When the caller lists their organizations
    Then no team of this organization arrives
