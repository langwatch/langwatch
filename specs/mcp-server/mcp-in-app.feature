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

  # --- SSE transport across replicas ---
  #
  # The SSE stream is connection-bound: it lives on the one replica that
  # answered GET /sse. Every follow-up message is a separate POST that the
  # load balancer may send to any replica, so a replica that does not hold
  # the stream has to hand the message to the one that does.

  @integration
  Scenario: A message posted to a replica that does not hold the stream still reaches the session
    Given a client opened an SSE connection and one replica holds the stream
    When the client posts a tools/list message to a different replica
    Then the response is accepted
    And the tools/list reply arrives on the open SSE stream
    And the reply lists at least one tool

  @integration
  Scenario: A message posted to the replica holding the stream is answered directly
    Given a client opened an SSE connection to a replica
    When the client posts a message to that same replica
    Then the response is accepted
    And the reply arrives on the open SSE stream

  @integration
  Scenario: Clients that append the message path to the connect path are still routed
    Given a client opened an SSE connection
    When the client posts its message to the /sse/messages path instead of /messages
    Then the response is accepted

  @integration
  Scenario: A message for an unknown session is rejected as a missing session
    Given no SSE session exists for the session id a client presents
    When the client posts a message for that session id
    Then the response status is 404
    And the response says the session was not found

  @integration
  Scenario: A message carrying credentials for a different project is rejected
    Given a client opened an SSE connection with one project's credentials
    When a message for that session presents another project's credentials
    Then the response status is 401
    And the message is never delivered to the session

  @integration
  Scenario: A message with no credentials is rejected as unauthorized rather than as a bad session
    Given an SSE session exists
    When a message for that session arrives with no credentials
    Then the response status is 401

  @integration
  Scenario: A message for a session whose replica is gone tells the client to reconnect
    Given an SSE session was recorded but the replica holding its stream is gone
    When a client posts a message for that session
    Then the response status is 404
    And the recorded session is forgotten so the client reconnects

  @integration
  Scenario: SSE sessions count towards the per-project concurrent session limit
    Given a project already holds the maximum number of concurrent sessions
    When a client opens another SSE connection for that project
    Then the connection is refused as over the session limit

  @integration
  Scenario: Reconnecting the streaming transport to another replica resumes the session
    Given a streamable session was created on one replica
    When the client reconnects the stream through a different replica
    Then the stream is served rather than reported as expired

  # --- OAuth discovery documents ---

  @integration
  Scenario: Protected resource metadata is served for the path-suffixed form
    When a client fetches the protected resource metadata for /sse or /mcp
    Then the response is JSON describing the resource and its authorization server

  @integration
  Scenario: Authorization server metadata is served for the path-suffixed form
    When a client fetches the authorization server metadata for /sse or /mcp
    Then the response is JSON advertising the authorization, token and registration endpoints

  @integration
  Scenario: An unknown OAuth discovery document answers with JSON rather than the web app
    When a client fetches an OAuth discovery document that does not exist
    Then the response status is 404
    And the response is JSON, so the client can fall back to the documents that do exist

  @integration
  Scenario: OpenID configuration is answered as absent rather than with the web app
    When a client fetches the OpenID configuration document
    Then the response status is 404
    And the response is JSON

  # --- OAuth token endpoint ---

  @integration
  Scenario: The token endpoint accepts client credentials presented as HTTP Basic
    Given an authorization code was issued for a client
    When the client exchanges it presenting its client id via HTTP Basic instead of the form body
    Then an access token is issued

  @integration
  Scenario: A token exchange from a client that is no longer registered is told to register again
    Given a client presents a client id that has no registration
    When it exchanges an authorization code
    Then the response error is "invalid_client"
    And the response tells the client to register again

  @integration
  Scenario: Rate limiting counts callers separately when a proxy reports the caller address
    Given many token requests arrive from one caller behind a proxy
    When a different caller behind the same proxy sends a token request
    Then that caller is not rate limited by the first caller's traffic

  @integration
  Scenario: A rate limited OAuth request answers with an OAuth error and a retry hint
    Given a caller exceeded the token endpoint rate limit
    When it sends another token request
    Then the response status is 429
    And the response error is "temporarily_unavailable"
    And the response carries a retry hint

  @integration
  Scenario: Registering a client and exchanging a token do not share one rate limit budget
    Given a caller exhausted the client registration rate limit
    When it sends a token request
    Then the token request is not rate limited

  # --- Authorization consent errors ---

  @integration
  Scenario: A consent failure a client can be told about is redirected back to the client
    Given a client is registered with a redirect URI and asks for authorization without a code challenge
    When the user approves the request
    Then the browser is sent back to the client's registered redirect URI
    And the redirect carries error "invalid_request" and the request state

  @integration
  Scenario: A project the user cannot reach is reported to the client as access denied
    Given a client is registered with a redirect URI and the user cannot access the requested project
    When the user approves the request
    Then the browser is sent back to the client's registered redirect URI
    And the redirect carries error "access_denied"

  @integration
  Scenario: A consent failure that cannot be attributed to a client stays on the LangWatch page
    Given the authorization request names a client that is not registered
    When the user approves the request
    Then no redirect back to the caller is offered
    And the failure is shown on the LangWatch page instead

  # --- Observability ---

  @integration
  Scenario: Every MCP request is logged with its outcome
    Given a client sends a request to an MCP route
    When the response completes
    Then one log line records the method, path, status and duration
    And no credentials appear in the log line

  # --- Tool Availability ---

  @integration @unimplemented
  Scenario: All MCP tools are available through in-app transport
    Given the LangWatch app is running
    And a valid project API key exists in the database
    When a client lists available tools via /mcp
    Then the response includes observability tools
    And the response includes platform tools
    And the response includes documentation tools
