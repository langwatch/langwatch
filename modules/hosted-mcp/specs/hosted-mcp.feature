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

  # The endpoint decides each answer as data; the raw HTTP door alone writes it (Alex, 2026-10-20).

  @unit
  Scenario: The endpoint answers a request without touching the response
    Given a hosted MCP endpoint
    When it is asked about "/mcp/health" as plain values
    Then it answers 200 with status "ok" and the CORS headers, as data

  @unit
  Scenario: A client that leaves before its answer is decided is still logged
    Given a client that disconnects while the endpoint is still deciding its answer
    When the answer is decided
    Then the access log line is written with the status the response closed on

  @unit
  Scenario: The endpoint names the access log fields beside its answer
    Given a hosted MCP endpoint
    When it answers a request carrying a session id and a user agent
    Then it returns the method, path, client and session id with the answer
    And it leaves the status and the duration for the door to add

  @unit
  Scenario: A stream answer is data: the SDK transport and the session key
    Given a hosted MCP endpoint whose project key is live
    When an authenticated initialize request opens a session
    Then the answer is a stream holding only the SDK transport, the session key and the body

  @unit
  Scenario: The door drives a stream through the session runner it was handed
    Given the session runner the endpoint gives the door where it is composed
    When the door runs a stream's work through it
    Then the work runs as that session's key

  @unit
  Scenario: A stream that fails to start keeps its unbuffered header
    Given a hosted MCP endpoint whose session server fails to start
    When an authenticated initialize request arrives
    Then the answer is a 500 that still tells proxies not to buffer

  @unit
  Scenario: A preflight on an MCP path answers with the CORS headers alone
    Given a hosted MCP endpoint
    When an OPTIONS request reaches "/mcp"
    Then the answer is an empty 200 carrying the CORS headers

  @unit
  Scenario: An unknown path or method is refused in the endpoint's own shape
    Given a hosted MCP endpoint
    When a request names a path or a method the endpoint does not serve
    Then the answer is the 404 or the 405 in the endpoint's error shape

  @unit
  Scenario: A request without a bearer is told where to sign in
    Given a hosted MCP endpoint
    When an initialize request arrives with no bearer
    Then the answer is a 401 naming the protected resource metadata in WWW-Authenticate

  @unit
  Scenario: A failure while deciding answers in the endpoint's shape rather than rejecting
    Given a hosted MCP endpoint whose body read fails
    When a request that reads its body arrives
    Then the answer is a 500 "Internal server error"

  @unit
  Scenario: A body past the cap is refused before it is parsed
    Given a request whose body passed the size cap
    When the endpoint reads it
    Then the answer is the 413 "Request body too large"

  @unit
  Scenario: A rate-limited refusal says when to retry
    Given a refusal that carries a retry delay
    When the endpoint answers it
    Then the answer carries Retry-After

  @unit
  Scenario: The client address is the one the process resolved, never a header
    Given a request with forwarding headers and a socket peer
    When the endpoint reads the client address
    Then it is the address the process resolved through its trusted proxies, else the socket peer
    And no forwarding header is read by the endpoint itself
