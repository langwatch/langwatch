Feature: MCP HTTP Server In-App Integration (Phase 1)
  As a platform operator
  I want the MCP HTTP server mounted inside the main LangWatch app
  So that deployments require no separate MCP service

  # Phase 1: Route mounting with Streamable HTTP, client_credentials OAuth,
  # Redis-backed token storage, and DB-validated API keys.
  #
  # Phase 2 (follow-up): OAuth Authorization Code + PKCE for Claude Desktop,
  # /authorize/mcp consent page, and SSE transport with graceful drain.

  # --- Route Mounting ---

  @integration
  Scenario: Streamable HTTP transport is reachable at /mcp
    Given the LangWatch app is running
    And a valid project API key exists in the database
    When a client sends an MCP initialize request to /mcp with a Bearer token
    Then the response status is 200
    And the response includes an mcp-session-id header

  @integration
  Scenario: Health endpoint is reachable without authentication
    Given the LangWatch app is running
    When a client sends a GET request to /mcp/health without credentials
    Then the response status is 200
    And the response body contains status "ok"

  @integration
  Scenario: Non-MCP routes are handled by Next.js
    Given the LangWatch app is running
    When a client requests /api/health
    Then the response contains the Next.js health check payload

  @integration
  Scenario: MCP POST request body is fully available to the handler
    Given the LangWatch app is running
    And a valid project API key exists in the database
    When a client sends an MCP initialize request to /mcp with a JSON body
    Then the MCP server responds with a valid initialize result

  # --- OAuth client_credentials ---

  @integration
  Scenario: OAuth metadata advertises client_credentials grant
    Given the LangWatch app is running
    When a client fetches /.well-known/oauth-authorization-server
    Then the response includes "client_credentials" in grant_types_supported
    And the response includes a token_endpoint URL

  @integration
  Scenario: Client credentials grant issues access token
    Given the LangWatch app is running
    And a project with a valid API key exists
    When a client posts to /oauth/token with grant_type "client_credentials" and the API key as client_secret
    Then the response includes an access_token
    And the token_type is "Bearer"

  @integration
  Scenario: Client credentials grant rejects missing client_secret
    Given the LangWatch app is running
    When a client posts to /oauth/token with grant_type "client_credentials" and no client_secret
    Then the response status is 400
    And the response error is "invalid_request"

  # --- Bearer Token DB Validation ---

  @integration
  Scenario: Direct API key is validated against the database
    Given a project exists with a known API key
    When a client sends an MCP initialize request with that API key as Bearer token
    Then the server accepts the connection

  @integration
  Scenario: Invalid Bearer token is rejected
    Given no project exists with API key "lw_fake_key_999"
    When a client sends an MCP initialize request with Bearer token "lw_fake_key_999"
    Then the response status is 401

  @integration
  Scenario: OAuth-issued access token authenticates MCP requests
    Given an access token was issued via client_credentials for a valid API key
    When a client sends an MCP initialize request with that access token
    Then the server accepts the connection

  # --- Redis Token Storage ---

  @integration
  Scenario: OAuth token works for authentication after in-memory cache is cleared
    Given an access token was issued via client_credentials
    And the in-memory token cache is cleared
    When the client uses that access token to authenticate
    Then the server still accepts the connection via Redis lookup

  @integration
  Scenario: Expired OAuth token is rejected
    Given an access token was issued with a short TTL
    When the token expires and the client tries to authenticate
    Then the response status is 401

  # --- CORS ---

  @integration
  Scenario: CORS headers are present on MCP route responses
    Given a request to /mcp with an Origin header
    When the server responds
    Then the response includes Access-Control-Allow-Origin
    And the response includes Access-Control-Allow-Headers with Authorization and mcp-session-id

  @integration
  Scenario: OPTIONS preflight requests succeed
    Given a preflight OPTIONS request to /mcp
    When the server handles the request
    Then the response status is 200
    And the response includes CORS headers

  # --- Standalone Package Isolation ---

  @integration
  Scenario: Standalone npm package stdio mode is unaffected
    Given the @langwatch/mcp-server package is installed
    When it is invoked in stdio mode
    Then it communicates via stdin/stdout
    And it does not import any main app server or database modules

  # --- Tool Availability ---

  @integration
  Scenario: All MCP tools are available through in-app transport
    Given the LangWatch app is running
    And a valid project API key exists in the database
    When a client lists available tools via /mcp
    Then the response includes observability tools
    And the response includes platform tools
    And the response includes documentation tools
