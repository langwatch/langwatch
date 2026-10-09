Feature: An HTTP agent's test call runs in scenario
  Scenario owns the HTTP agent test call (round 36 D3): it fills a saved agent's stored credentials,
  Workflow executes the component and Trace records its captured span.

  @integration
  Scenario: HTTP agent execution reaches the composed Workflow API
    Given the Workflow application owns the process studio dispatcher
    When Scenario submits an HTTP component through WorkflowApi
    Then the real engine stream supplies the requested component's final state
    And the dispatch preserves the trace identifier and template inputs

  @unit
  Scenario: A captured agent span uses the canonical trace ingestion command
    Given the Trace application owns the process span ingestion sender
    When Scenario records a captured HTTP test span through TraceApi
    Then one OTLP command preserves its tenant, span identifiers and time units
    And the command retains the agent-test metadata and attributed user

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
  Scenario: A test call resolves only the secrets the saved agent references
    Given a saved HTTP agent and other secrets in its project
    When a test call for it references a secret its saved config does not
    Then only the secrets the saved config references are sent to resolve the call
    And the new reference resolves only once the agent is saved with it
