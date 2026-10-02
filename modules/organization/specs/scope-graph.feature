Feature: The scope graph is the caller's organizations, narrowed
  organization.getScopeGraph returns only the skeleton the browser resolves a page against,
  narrowed as organization.getAll narrows it. The server always answers the full graph.

  @integration
  Scenario: A member receives only the teams they can open
    Given a member belongs to one team and is bound to none other
    And the organization has a further team the member cannot open
    When the member asks for their scope graph
    Then the graph holds their own team and nothing else
    And that team is marked as no one's personal team

  @integration
  Scenario: A team reached through a binding carries the caller's membership
    Given a team-scoped binding reaches a team the member has no membership row on
    When the member asks for their scope graph
    Then that team arrives with its projects
    And the team carries the member's own membership

  @integration
  Scenario: Archived and internal-governance projects stay out of the graph
    Given a team holds an archived project and an internal-governance project
    When the member asks for their scope graph
    Then the team arrives with its live projects only

  @integration
  Scenario: Another member's personal team stays out of the graph
    Given a colleague owns a personal team in the organization
    When a member asks for their scope graph
    Then the colleague's personal team is not in the graph

  @integration
  Scenario: An admin sees a member's personal team marked as theirs
    Given a colleague owns a personal team in the organization
    When an organization administrator asks for their scope graph
    Then the colleague's personal team is in the graph
    And it is marked as the colleague's own

  @integration
  Scenario: A rename answers the new name
    Given the caller asked for their scope graph
    And a project the caller can see is renamed
    When the caller asks again
    Then the graph carries the new name
