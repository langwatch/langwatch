Feature: Recording coding-agent activity on a project

  Two things stamp a project as having seen a coding agent: a folded session,
  and a pull request that a mapping run linked to one. Both are single throttled
  updates of one column, and both are reached from a background worker's event
  pipelines rather than from a request.

  Reaching them used to mean composing `ProjectService`, which is a Prisma
  repository, an authorization service, a topic clustering port, a credentials
  adapter and both transports' collaborators — none of which either update asks
  anything. This is the seam that makes them reachable on their own, and its
  predicates are the App's, pinned literally: two graphs writing one column
  under different staleness windows would either flood Postgres or leave a
  settings surface reading a date the other has already moved.

  @unit
  Scenario: An active project is stamped when its activity is stale
    Given a project whose recorded coding-agent activity is older than the touch window
    When a folded session records activity on it
    Then the project's session activity is updated
    And an archived project is never updated

  @unit
  Scenario: A freshly stamped project is not written again
    Given a project stamped within the touch window
    When a folded session records activity on it again
    Then the update matches no row, because the write is throttled on its own predicate

  @unit
  Scenario: A mapped pull request stamps its own column
    Given a project whose recorded pull-request activity is older than the touch window
    When a mapping run links a pull request to it
    Then the project's pull-request activity is updated, and its session activity is untouched

  @unit
  Scenario: The organization is resolved through the project's team
    Given an active project belonging to a team
    When branch demand asks which organization the tenant belongs to
    Then the team's organization is answered

  @unit
  Scenario: An unknown or archived project has no organization
    Given a project id that names no active project
    When branch demand asks which organization the tenant belongs to
    Then the read fails the way the App's own read fails
