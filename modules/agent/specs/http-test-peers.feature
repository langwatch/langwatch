@agent
Feature: HTTP tests use the owning execution and trace APIs
  Agent owns request construction, response mapping and credential redaction.
  Workflow executes the component and Trace records its captured span.

  @integration
  Scenario: HTTP agent execution reaches the composed Workflow API
    Given the Workflow application owns the process studio dispatcher
    When Agent submits an HTTP component through WorkflowApi
    Then the real engine stream supplies the requested component's final state
    And the dispatch preserves the trace identifier and template inputs

  @unit
  Scenario: A captured agent span uses the canonical trace ingestion command
    Given the Trace application owns the process span ingestion sender
    When Agent records a captured HTTP test span through TraceApi
    Then one OTLP command preserves its tenant, span identifiers and time units
    And the command retains the agent-test metadata and attributed user

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
  Scenario: Testing a saved HTTP agent uses its stored credentials for blank ones
    Given a saved HTTP agent whose editor test leaves its credentials blank
    When the test request is sent
    Then the stored credentials are sent

  @unit
  Scenario: A test call to the saved address uses the stored credentials
    Given a saved HTTP agent with stored credentials
    When a test call for it names the saved address, however the scheme, host and port are spelled
    Then the stored credentials fill the blank ones

  @unit
  Scenario: A test call to a different address than the saved agent's is refused when it would use stored credentials
    Given a saved HTTP agent with stored credentials
    When a test call for it names another scheme, host or port and leaves a credential blank
    Then the call is refused as a handled error
    And nothing is sent

  @unit
  Scenario: A test call with no saved agent fills nothing, and typed credentials are used as typed
    Given a test call that names no saved agent, or one that carries every credential itself
    When the test request is sent
    Then no stored credential is added
    And the credentials the call carries are sent as typed

  @unit
  Scenario: A test call whose address resolves to another host through a secret is refused
    Given a saved HTTP agent with stored credentials
    When a test call names an address whose secret reference resolves to another host
    Then the address is checked after its references are resolved
    And the call is refused as a handled error, with nothing sent

  @unit
  Scenario: A test call never traces a stored credential
    Given a saved HTTP agent whose editor test leaves its credentials blank
    When the test request is sent and traced
    Then the trace records the headers as typed, never a stored value or its reference

  @unit
  Scenario: An update that moves an agent to another address needs its credentials again
    Given a saved HTTP agent with stored credentials
    When it is updated to another scheme, host or port with a credential left blank
    Then the update is refused as a handled error and the agent is unchanged
    And the same update with every credential entered again is accepted

  @unit
  Scenario: A test call resolves only the secrets the saved agent references
    Given a saved HTTP agent and other secrets in its project
    When a test call for it references a secret its saved config does not
    Then only the secrets the saved config references are sent to resolve the call
    And the new reference resolves only once the agent is saved with it
