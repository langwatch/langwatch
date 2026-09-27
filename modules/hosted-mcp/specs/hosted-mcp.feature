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
