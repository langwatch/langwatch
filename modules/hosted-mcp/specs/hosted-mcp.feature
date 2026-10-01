Feature: Hosted MCP answers main's root paths on the api process
  Hosted MCP declares a raw HTTP door for main's MCP root paths, so the api process answers
  them over the raw Node request ahead of every route, and closes its sessions at shutdown.

  @unit
  Scenario: The hosted MCP feature installs from store members and peers alone
    Given the hosted MCP module and fixtures for its peers
    When the api process boots it over store members
    Then its application creates an endpoint that recognises "/mcp"

  @unit
  Scenario: The hosted MCP door mounts on the api process and its health path answers
    Given the api process booted hosted MCP with a raw HTTP host
    When a client requests "/mcp/health"
    Then the endpoint answers 200 with status "ok"

  @unit
  Scenario: An unpublished metadata suffix answers main's JSON 404
    Given the api process booted hosted MCP with a raw HTTP host
    When a client requests "/.well-known/oauth-protected-resource/elsewhere"
    Then the endpoint answers 404 with a JSON body

  @unit
  Scenario: Shutdown closes every hosted MCP session
    Given the hosted MCP door mounted over one endpoint
    When the api process shuts down
    Then the endpoint's sessions are closed once

  @integration
  Scenario: MCP sign-in issues a person-bound, project-capped token with refresh, never a project key
    Given a person approved a project for an MCP client
    When the client exchanges the authorization code
    Then it receives an access token and a refresh token bound to that person and project
    And no project key is issued or stored

  @integration
  Scenario: A refreshed MCP token keeps working; an expired one asks to re-authorise
    Given a client holding an MCP access token and its refresh token
    When it redeems the refresh token
    Then the new access token is served and the spent refresh token is refused
    And an expired access token is answered 401 with a WWW-Authenticate challenge

  @integration
  Scenario: An open MCP session adopts the refreshed token of the same person and project
    Given a client that opened an MCP session with an access token
    When it refreshes and presents the new access token on that session
    Then the session answers the request under the new token
    And a token for anyone else is answered 401

  @integration
  Scenario: An MCP bearer issued before this change is refused and re-authorises
    Given a bearer minted when MCP sign-in wrapped a project key
    When a client presents it
    Then the endpoint answers 401 with a WWW-Authenticate challenge
    And the bearer is not resolved to any key

  @unit
  Scenario: A person's MCP session is refused the organization's ingestion templates
    Given an MCP session opened by a person, capped at one project
    When it calls any governance ingestion template tool, the OTTL rules included
    Then it is refused as "api_key_scope_violation" and no template is read or written
    And the person's own ingestion-key tools still answer
