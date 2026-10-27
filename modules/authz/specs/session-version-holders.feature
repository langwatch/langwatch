Feature: A role or binding change refreshes only the sessions it reaches

  A session-version bump marks every read stale in the bumped user's tabs (ADR-170), so authz
  bumps only the users whose access changed: a role's holders are found from its live grants,
  directly or through a group or team bound to it. A holder is never missed: when the set cannot
  be computed, the whole organization is bumped instead. See dev/docs/ARCHITECTURE.md §10.

  @unit
  Scenario: Editing a role refreshes only its holders' sessions
    Given a custom role bound to one user directly, to a group and to a team
    When the role's permissions change
    Then that user, the group's members and the team's members get a newer session version
    And no other member of the organization does
    And an API key bound to the role bumps no one

  @unit
  Scenario: Deleting a role refreshes only its holders' sessions
    Given a custom role bound to one user
    When the role is deleted
    Then only that user gets a newer session version

  @unit
  Scenario: A newly defined role refreshes no one
    Given a custom role that has just been defined
    When the definition projects
    Then no one gets a newer session version, since nobody holds the role yet

  @unit
  Scenario: A binding or unbinding refreshes exactly the users it reaches
    Given a grant to a user, a group or a team
    When it is attached, revoked or changes role
    Then only that user, or the group's or team's current members, get a newer session version

  @unit
  Scenario: A role whose holders cannot be found refreshes the whole organization
    Given a role whose holder lookup fails, whose grants name more than 500 principals, or that is bound to the organization itself
    When the role changes
    Then every member of the organization gets a newer session version
    And a failed lookup is logged as a warning naming the organization, the role and the error class
