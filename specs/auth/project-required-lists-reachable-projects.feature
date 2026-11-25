Feature: A key that names no project is told the projects it may name
  An organization API key that reaches several projects has to say which one a project route
  is for. The door's project_required refusal lists the projects the key could have named, so
  the caller (an SDK, the CLI, a connecting agent) can pick one without a second request.
  Alex, 2026-10-06 (Q30): the auth door puts the key's reachable projects on its own refusal.

  @unit
  Scenario: A key that names no project is told the projects it may name for the route
    Given an organization API key that resolves two of its organization's three projects
    And the key holds the route's permission in only one of those two
    When it calls a project route asking that permission with no X-Project-Id
    Then the response is 400 with code "project_required"
    And meta.projects lists only that one project, by id and name

  @unit
  Scenario: A key asked no permission is told every project it reaches
    Given an organization API key that resolves two of its organization's three projects
    When it reaches the project door with no X-Project-Id and no permission asked
    Then meta.projects lists both projects it resolves, and not the third
