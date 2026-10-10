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
