Feature: A project login is a person's session capped at one project
  The CLI device grant and the hosted MCP sign-in answer access and refresh
  tokens bound to the person and one project, never a project key. The API
  door accepts the access token as that person, capped at that project
  (Alex, 2026-10-01; dev/docs/ARCHITECTURE.md, "A query never returns a credential").

  @integration
  Scenario: A project login answers tokens and the project, never a key
    Given a person approved a project login for a project they can view
    When the CLI exchanges the device code
    Then it receives an access token, a refresh token, their lifetimes and the project
    And the answer carries no API key

  @integration
  Scenario: Refresh naming another project forks a child session and keeps the parent
    Given a CLI holding a person's session, bound to no project
    When it refreshes naming a project the person can view
    Then it receives a new pair locked to the named project, and that project
    And its own refresh token still rotates

  @integration
  Scenario: A project login is locked to the project the person approved
    Given a CLI holding the session a project login answered
    When it refreshes naming another project the person can view
    Then it is answered 403 and the session stays on its approved project

  @integration
  Scenario: Logging out a session ends the children forked from it
    Given a person's session that forked a child session onto a project
    When the CLI logs the parent session out
    Then the child's refresh token is answered "invalid_grant"

  @integration
  Scenario: Revoking a session ends the children forked from it
    Given a person's session that forked a child session onto a project
    When the person's parent session tokens are revoked
    Then the child's refresh token is answered "invalid_grant"

  @integration
  Scenario: A rotation that fails part-way leaves the refresh token usable
    Given a CLI holding a person's session
    When a refresh fails on an unexpected error after claiming the token
    Then the next presentation of the same refresh token rotates it

  @integration
  Scenario: Refresh is refused when the person cannot access the project
    Given a CLI holding a project session
    When it refreshes naming a project the person cannot view
    Then it is answered 403 "forbidden"
    And its refresh token still rotates without a project

  @integration
  Scenario: A refresh token buys one rotation, even when presented twice at once
    Given a CLI holding a project session
    When the same refresh token is presented twice at the same moment
    Then one presentation rotates the session
    And the other is answered 401 as a spent token

  @integration
  Scenario: A session consented to one project cannot be re-scoped to another
    Given a session the person approved for one project only, as hosted MCP issues
    When its refresh token is presented naming another project
    Then it is answered 403 and the session stays on its project

  @integration
  Scenario: A project session is refused to a person who can no longer view the project
    Given a person who has lost view access to a project
    When a session capped at that project is issued for them
    Then it is refused as "access_denied" and no token is minted

  @unit
  Scenario: The API door accepts a project-bound access token as the person
    Given a project-bound access token sent as X-Auth-Token or as a bearer
    When it calls a project route
    Then it is admitted as its person, on its project, with the person's own permission checked there

  @integration
  Scenario: Every sign-in path reads the issued session back through the auth operations
    Given hosted MCP exchanging an approved code
    When it issues a project session and later refreshes it
    Then auth mints a session locked to that project and rotates it into a new pair
    And a refresh token auth never issued is answered "invalid_grant"
