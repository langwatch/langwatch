Feature: Hosted MCP answers main's root paths on the api process
  Hosted MCP declares a raw HTTP door for main's MCP root paths, so the api process answers
  them over the raw Node request ahead of every route, and closes its sessions at shutdown.
  `/mcp/docs` is the one path that takes no credential: it serves only the docs tools, keeps
  no session, and replaces the docs MCP that langwatch.ai/docs/mcp used to serve.

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
    And a valid token for anyone else is answered 404, as if the session did not exist

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

  @unit
  Scenario: An MCP authorization code is not issued while an operator acts as another member
    Given an operator acting as a member through impersonation on the consent page
    When they approve an MCP client's request
    Then the approval is refused with access_denied before any authorization code is issued

  # --- Session lifetime: a session ends 30 days after it opened or by the client's DELETE, never by a replica ---

  @unit
  Scenario: A session lasts 30 days from when it opened
    Given a session opened by a client
    When the client keeps using it
    Then the session still ends 30 days after it opened

  @unit
  Scenario: Neither use nor a refreshed token extends a session's record
    Given a session record with ten seconds left
    When the session is used and its record is rewritten for a refreshed token
    Then the record still ends within those ten seconds

  @unit
  Scenario: A late rewrite never brings back a session the client ended
    Given a client ended its session with DELETE
    When a rewrite for its refreshed token lands afterwards
    Then the session's record stays removed

  @integration
  Scenario: A session survives the replica that opened it shutting down
    Given a session opened on a replica that is then shut down for a deploy
    When the client's next request reaches the replica that took over
    Then the session is served there without a new sign-in

  @integration
  Scenario: A refreshed token reaches its session on a replica that never held it
    Given a client that opened a session and then refreshed its OAuth token
    When it presents the new token for that session on another replica
    Then the session is served

  @integration
  Scenario: Only the client ends a session
    Given a client ended its session with DELETE
    When the session id is presented on a replica that holds no copy of it
    Then the response status is 404

  @integration
  Scenario: A lost session asks for a new session, not a new sign-in
    Given a valid credential names a session nobody holds
    When the client sends a request for it
    Then the response status is 404 without a WWW-Authenticate challenge
    And an initialize sent under that id opens a new session

  @integration
  Scenario: A bad credential still asks the client to sign in
    When a request presents a credential that is not valid
    Then the response status is 401 with a WWW-Authenticate challenge

  @integration
  Scenario: A store being down asks the client to retry, not to sign in
    Given the store a credential check needs is unreachable
    When a client presents its credential
    Then the response status is 503 with a Retry-After header

  @integration
  Scenario: An open stream is kept alive through idle-timing proxies
    Given a client holds the server's event stream open
    When nothing else is sent for 20 seconds
    Then the stream carries a keepalive comment
    And the session keeps counting against its key's session limit

  # --- The docs endpoint: anyone may read the LangWatch and Scenario docs at /mcp/docs, signed in or not ---

  @integration
  Scenario: An anonymous client at the docs endpoint lists exactly the docs tools
    Given a client with no credential
    When it lists the tools at "/mcp/docs"
    Then it sees "fetch_langwatch_docs" and "fetch_scenario_docs" and no other tool

  @integration
  Scenario: A docs tool at the docs endpoint returns a docs page
    Given a client with no credential
    When it calls "fetch_langwatch_docs" at "/mcp/docs" for a page under the docs
    Then the page is fetched from "https://langwatch.ai/docs/" and its text is returned

  @integration
  Scenario: The docs endpoint refuses a URL outside the docs
    Given a client with no credential
    When it calls "fetch_langwatch_docs" at "/mcp/docs" with a URL on another host
    Then the tool answers an error naming the trusted docs address
    And nothing is fetched

  @integration
  Scenario: The docs endpoint serves no project tool
    Given a client with no credential
    When it calls a project tool at "/mcp/docs"
    Then the call is refused as a tool the server does not have

  @integration
  Scenario: A credential sent to the docs endpoint is neither checked nor used
    Given a client presenting a bearer that is not valid
    When it lists the tools at "/mcp/docs"
    Then it is served the docs tools rather than asked to sign in

  @integration
  Scenario: The MCP endpoint still asks an anonymous client to sign in
    Given a client with no credential
    When it sends an initialize request to "/mcp"
    Then the endpoint answers 401 with a WWW-Authenticate challenge

  @integration
  Scenario: The docs endpoint keeps no session
    Given a client with no credential
    When it initializes and calls a docs tool at "/mcp/docs"
    Then no session id is returned
    And no session record is written

  @integration
  Scenario: The docs endpoint answers only POST
    When a client sends GET or DELETE to "/mcp/docs"
    Then the endpoint answers 405

  @integration
  Scenario: A browser client's preflight to the docs endpoint is answered
    When a browser sends a CORS preflight to "/mcp/docs"
    Then the endpoint answers 200 with headers allowing any origin

  @unit
  Scenario: The docs endpoint is declared public and the MCP transport stays behind a credential
    Given the hosted MCP route policy declarations
    When the policy for "POST /mcp/docs" is read
    Then it is a public endpoint taking no credential
    And "POST /mcp" still requires an API key
