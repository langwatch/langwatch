@agent
Feature: HTTP agent credentials on read and write
  Agent owns an HTTP agent's stored credentials: a read blanks them, a write keeps or replaces them.
  The editor's test call moved to scenario (modules/scenario/specs/http-agent-test.feature).

  @unit
  Scenario: An HTTP agent's dev tunnel marker keeps its heartbeat
    Given an HTTP agent config whose devTunnel carries previousUrl, connectedAt and heartbeatAt
    When the config is parsed by the HTTP agent schema
    Then the parsed devTunnel still carries heartbeatAt

  @unit
  Scenario: An agent read never carries an HTTP credential
    Given an HTTP agent with header values, a token, an API key value or a password
    When the agent is read through the list or the single-agent query
    Then every credential value is blank
    And the header names, the auth kind and the username are kept

  @unit
  Scenario: An agent write never answers with an HTTP credential
    Given a saved HTTP agent with header values, a token or a password
    When it is updated
    Then the answer carries a blank value for every credential
    And the header names, the auth kind and the username are kept

  @unit
  Scenario: Saving an HTTP agent with blank credentials keeps the stored ones
    Given a saved HTTP agent with a header value and a bearer token
    When it is updated with those values left blank
    Then the stored values are kept

  @unit
  Scenario: Saving an HTTP agent with a new credential replaces the stored one
    Given a saved HTTP agent with a bearer token
    When it is updated with a new token
    Then the new token is stored

  @unit
  Scenario: An update that moves an agent to another address needs its credentials again
    Given a saved HTTP agent with stored credentials
    When it is updated to another scheme, host or port with a credential left blank
    Then the update is refused as a handled error and the agent is unchanged
    And the same update with every credential entered again is accepted

  @unit
  Scenario: A refused HTTP agent test reads in words, never the code
    Given an HTTP agent test the engine refused with a code the registry knows, such as ssrf_blocked
    When the test panel shows the failure
    Then its title is the registry's words, as on main's test panel, and the engine's raw message is not shown
    And a failure with no known code keeps the title "The test request failed"

  @integration
  Scenario: A named failure thrown by the HTTP agent test reads in words on the panel
    Given an HTTP agent test the service refused with a named failure, such as a rate limit or a credentials destination mismatch, that carries no engine code
    When the test panel shows the failure
    Then the panel shows the failure's title and its description, not the bare title "The test request failed"
    And an engine code, when the engine returned one, still names the copy

  @unit
  Scenario: Every failed HTTP agent test names its cause by a code with copy
    Given HTTP agent tests that time out, cannot resolve the host, are refused, fail the TLS handshake, answer something unreadable, answer a non-2xx status, or fail some other way
    When the engine and the test service report them
    Then each failure carries a code: http_timeout, http_dns_error, http_connection_refused, http_tls_error, http_invalid_response, upstream_http_error with the status, http_error, or http_executor_unavailable when the engine could not be reached
    And each code reads in the registry's words, saying what the author can do
    And the endpoint's own response body stays in the response panel as data
