Feature: MCP HTTP Server In-App Integration (Phase 1)
  As a platform operator
  I want the MCP HTTP server mounted inside the main LangWatch app
  So that deployments require no separate MCP service

  # Phase 1: Route mounting with Streamable HTTP, client_credentials OAuth,
  # Redis-backed token storage, and DB-validated API keys.
  #
  # Phase 2 (follow-up): OAuth Authorization Code + PKCE for Claude Desktop,
  # /authorize/mcp consent page, and SSE transport with graceful drain.

  # All @unimplemented scenarios in this file describe the in-app MCP
  # transport mount and OAuth flows. Need an integration test against
  # the langwatch app's MCP route handler — the standalone mcp-server
  # tests cover the tool-call surface, not the in-app HTTP transport.
  # Tracked here.

  # --- Route Mounting ---

  @integration @unimplemented
  Scenario: Streamable HTTP transport is reachable at /mcp
    Given the LangWatch app is running
    And a valid project API key exists in the database
    When a client sends an MCP initialize request to /mcp with a Bearer token
    Then the response status is 200
    And the response includes an mcp-session-id header

  @integration @unimplemented
  Scenario: Health endpoint is reachable without authentication
    Given the LangWatch app is running
    When a client sends a GET request to /mcp/health without credentials
    Then the response status is 200
    And the response body contains status "ok"

  @integration @unimplemented
  Scenario: Non-MCP routes are handled by Next.js
    Given the LangWatch app is running
    When a client requests /api/health
    Then the response contains the Next.js health check payload

  @integration @unimplemented
  Scenario: MCP POST request body is fully available to the handler
    Given the LangWatch app is running
    And a valid project API key exists in the database
    When a client sends an MCP initialize request to /mcp with a JSON body
    Then the MCP server responds with a valid initialize result

  # --- OAuth client_credentials ---

  @integration @unimplemented
  Scenario: OAuth metadata advertises client_credentials grant
    Given the LangWatch app is running
    When a client fetches /.well-known/oauth-authorization-server
    Then the response includes "client_credentials" in grant_types_supported
    And the response includes a token_endpoint URL

  @integration @unimplemented
  Scenario: Client credentials grant issues access token
    Given the LangWatch app is running
    And a project with a valid API key exists
    When a client posts to /oauth/token with grant_type "client_credentials" and the API key as client_secret
    Then the response includes an access_token
    And the token_type is "Bearer"

  @integration @unimplemented
  Scenario: Client credentials grant rejects missing client_secret
    Given the LangWatch app is running
    When a client posts to /oauth/token with grant_type "client_credentials" and no client_secret
    Then the response status is 400
    And the response error is "invalid_request"

  # --- Bearer Token DB Validation ---

  @integration @unimplemented
  Scenario: Direct API key is validated against the database
    Given a project exists with a known API key
    When a client sends an MCP initialize request with that API key as Bearer token
    Then the server accepts the connection

  @integration @unimplemented
  Scenario: Invalid Bearer token is rejected
    Given no project exists with API key "lw_fake_key_999"
    When a client sends an MCP initialize request with Bearer token "lw_fake_key_999"
    Then the response status is 401

  @integration @unimplemented
  Scenario: OAuth-issued access token authenticates MCP requests
    Given an access token was issued via client_credentials for a valid API key
    When a client sends an MCP initialize request with that access token
    Then the server accepts the connection

  # --- Redis Token Storage ---

  @integration @unimplemented
  Scenario: OAuth token works for authentication after in-memory cache is cleared
    Given an access token was issued via client_credentials
    And the in-memory token cache is cleared
    When the client uses that access token to authenticate
    Then the server still accepts the connection via Redis lookup

  @integration @unimplemented
  Scenario: Expired OAuth token is rejected
    Given an access token was issued with a short TTL
    When the token expires and the client tries to authenticate
    Then the response status is 401

  # --- CORS ---

  @integration @unimplemented
  Scenario: CORS headers are present on MCP route responses
    Given a request to /mcp with an Origin header
    When the server responds
    Then the response includes Access-Control-Allow-Origin
    And the response includes Access-Control-Allow-Headers with Authorization and mcp-session-id

  @integration @unimplemented
  Scenario: OPTIONS preflight requests succeed
    Given a preflight OPTIONS request to /mcp
    When the server handles the request
    Then the response status is 200
    And the response includes CORS headers

  # --- Standalone Package Isolation ---

  @integration @unimplemented
  Scenario: Standalone npm package stdio mode is unaffected
    Given the @langwatch/mcp-server package is installed
    When it is invoked in stdio mode
    Then it communicates via stdin/stdout
    And it does not import any main app server or database modules

  # --- OAuth Authorization Code + PKCE: redirect_uri / client_id binding ---

  @regression @integration
  Scenario: Dynamic client registration persists the redirect_uris binding
    Given a client posts client_name and redirect_uris to /oauth/register
    When the registration succeeds
    Then the client_id is durably bound to those redirect_uris for later lookup

  @regression @integration
  Scenario: Dynamic client registration rejects a request with no redirect_uris
    Given a client posts to /oauth/register with no redirect_uris
    Then the response status is 400
    And the response error is "invalid_client_metadata"

  @regression @integration
  Scenario: Authorization succeeds when redirect_uri exactly matches the registered client
    Given a client registered with redirect_uri "https://registered.example/callback"
    When an authorization request for that client_id supplies the exact same redirect_uri
    Then an authorization code is issued

  @regression @integration
  Scenario: Authorization is rejected when redirect_uri does not match the registered client
    Given a client registered with redirect_uri "https://registered.example/callback"
    When an authorization request for that client_id supplies a different redirect_uri
    Then the response status is 400
    And no authorization code is issued

  @regression @integration
  Scenario: Authorization is rejected for an unregistered client_id
    Given no client is registered with client_id "mcp_never_registered"
    When an authorization request is made with that client_id
    Then the response status is 400
    And the response error is "Unknown or unregistered client_id"

  @regression @integration
  Scenario: Authorization is rejected when client_id is missing
    When an authorization request omits client_id
    Then the response status is 400 before any registration lookup happens

  @regression @integration
  Scenario: Token exchange is rejected when redirect_uri is missing
    Given an authorization code exists
    When the token exchange omits redirect_uri
    Then the response status is 400 with error "invalid_request"

  @regression @integration
  Scenario: Token exchange is rejected when client_id is missing
    Given an authorization code exists
    When the token exchange omits client_id
    Then the response status is 400 with error "invalid_request"

  @regression @integration
  Scenario: Token exchange is rejected when redirect_uri does not match the authorization request
    Given an authorization code was issued for a specific client_id and redirect_uri
    When the token exchange presents a different redirect_uri
    Then the response status is 400 with error "invalid_grant"
    And no access token is issued

  @regression @integration
  Scenario: Token exchange is rejected when client_id does not match the authorization request
    Given an authorization code was issued for a specific client_id and redirect_uri
    When the token exchange presents a different client_id
    Then the response status is 400 with error "invalid_grant"
    And no access token is issued

  # --- Tool Availability ---

  @integration @unimplemented
  Scenario: All MCP tools are available through in-app transport
    Given the LangWatch app is running
    And a valid project API key exists in the database
    When a client lists available tools via /mcp
    Then the response includes observability tools
    And the response includes platform tools
    And the response includes documentation tools
