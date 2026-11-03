Feature: Scenario setup and teardown hooks on connected agents (SDK and protocol)
  As a person who tests a connected agent
  I want to declare a setup and a teardown function beside the agent
  So that a scenario can create its test data and remove it afterwards.

  Background: the protocol carries the hooks.
    The register frame declares which hooks an agent has. The call envelope
    carries a kind ("turn", "setup" or "teardown") and the state. The result
    frame carries the state. State travels in every call, like the session,
    so no call needs a particular instance. Decided in ADR-180.

  @unit
  Scenario: An agent with both hooks declares both at register
    Given an agent with a setup function and a teardown function
    When the SDK builds the register frame
    Then the agent declares hooks setup true and teardown true

  @unit
  Scenario: An agent with only a teardown declares only that
    Given an agent with a teardown function and no setup function
    When the SDK builds the register frame
    Then the agent declares hooks setup false and teardown true

  @unit
  Scenario: An agent with no hooks declares none
    Given an agent with no hook functions
    When the SDK builds the register frame
    Then the agent declares hooks setup false and teardown false

  @unit
  Scenario: Hook parameters merge into the agent's run-parameter schema
    Given a setup that declares "loyalty_tier" and "refund_amount"
    And a teardown that declares "loyalty_tier"
    When the SDK builds the register frame
    Then the parameter schema holds "loyalty_tier" once and "refund_amount" once

  @unit
  Scenario: Two hooks that disagree on a parameter type are refused at decoration
    Given a setup that declares "refund_amount" as a number
    And a teardown that declares "refund_amount" as a string
    When the second hook is decorated
    Then the SDK warns with a message naming "refund_amount"
    And the agent does not register

  @unit
  Scenario: An integer and a number for one parameter merge as a number
    Given a setup that declares "refund_amount" as an integer
    And a teardown that declares "refund_amount" as a number
    When the SDK builds the register frame
    Then the parameter schema holds "refund_amount" once, as a number

  @unit
  Scenario: Two hooks that give a parameter different defaults are refused at decoration
    Given a setup that declares "loyalty_tier" with the default "none"
    And a teardown that declares "loyalty_tier" with the default "gold"
    When the second hook is decorated
    Then the SDK warns with a message naming "loyalty_tier"
    And the agent does not register

  @unit
  Scenario: Setup is called with the run reference and its own parameters
    Given a call with kind "setup" and the params loyalty_tier "gold"
    When the SDK handles the call
    Then the setup function receives the run reference
    And it receives loyalty_tier "gold" and the default for refund_amount

  @unit
  Scenario: Setup's return value is sent back as the state
    Given a setup function that returns a dictionary
    When the SDK answers a call with kind "setup"
    Then the result frame carries that dictionary as state

  @unit
  Scenario: A setup that returns nothing sends an empty state
    Given a setup function that only seeds data and returns nothing
    When the SDK answers a call with kind "setup"
    Then the result frame carries an empty object as state

  @unit
  Scenario: Teardown receives the state setup returned
    Given a call with kind "teardown" and a state
    When the SDK handles the call
    Then the teardown function receives that state

  @unit
  Scenario: Teardown's returned object is sent back
    Given a teardown function that returns a dictionary
    When the SDK answers a call with kind "teardown"
    Then the result frame carries that dictionary as state

  @unit
  Scenario: Teardown that returns nothing sends no state
    Given a teardown function that returns nothing
    When the SDK answers a call with kind "teardown"
    Then the result frame carries no state

  @unit
  Scenario: A turn receives the state and may update it
    Given a call with kind "turn" and a state
    When the agent function declares a state parameter and returns an update
    Then the function received the state
    And the result frame carries the update as state

  @unit
  Scenario: A turn that returns no update leaves the state alone
    Given a call with kind "turn" and a state
    When the agent function returns only a reply
    Then the result frame carries no state

  @unit
  Scenario: A call with no kind is a turn
    Given a call envelope from an older platform with no kind
    When the SDK handles the call
    Then it is handled as a turn

  @unit
  Scenario: The envelope key list includes the new keys
    When the call envelope keys are read
    Then they include "kind" and "state"

  @unit
  Scenario: A hook call for a hook the agent did not declare is answered with an error
    Given an agent with no setup function
    When the SDK receives a call with kind "setup"
    Then the result frame carries the error code "hook_not_declared"

  @unit
  Scenario: A hook that raises is answered with an error
    Given a setup function that raises "database unreachable"
    When the SDK answers a call with kind "setup"
    Then the result frame carries an error whose message names "database unreachable"
    And the connection stays up

  @unit
  Scenario: State over the size cap is refused
    Given a setup function that returns more than 64 KiB of state
    When the SDK answers a call with kind "setup"
    Then the result frame carries the error code "agent_payload_too_large"

  @unit
  Scenario: A teardown object over the size cap is refused
    Given a teardown function that returns more than 64 KiB
    When the SDK answers a call with kind "teardown"
    Then the result frame carries the error code "agent_payload_too_large"

  @unit
  Scenario: State that is not JSON is refused
    Given a setup function that returns a value that cannot be serialised
    When the SDK answers a call with kind "setup"
    Then the result frame carries an error that names the state

  @unit
  Scenario: The TypeScript SDK mirrors the Python hooks
    Given a TypeScript agent from connectAgent with a setup and a teardown
    When the SDK builds the register frame
    Then it declares the same hooks as the Python SDK does for the same functions

  @unit
  Scenario: The platform checks a result against the kind of call it answers
    Given a result frame with neither an output nor an error
    When it answers a turn or a setup
    Then the call fails as a result LangWatch cannot read
    But when it answers a teardown it is accepted

  @integration @unimplemented
  Scenario: The platform refuses an envelope whose state is over the cap
    Given a call envelope with more than 64 KiB of state
    When the platform dispatches it
    Then the call fails with "agent_payload_too_large" and reaches no instance

  @unit
  Scenario: The platform sends no hook call to an agent that did not declare it
    Given a registered agent whose live instances declared hooks setup false
    When the platform is asked to call its setup
    Then no call frame is sent
    And the call fails with "hook_not_declared"

  @unit
  Scenario: A hook call reaches only an instance that declared that hook
    Given two live instances of one agent, one on an SDK without hooks and one that declared teardown
    When the platform calls teardown several times
    Then every call goes to the instance that declared teardown
    And the instance without hooks never runs the agent function for a hook call

  @unit
  Scenario: A hook call runs under the hook's budget, not the agent's turn timeout
    Given an agent whose turn timeout is 120 seconds
    When the scenario child calls setup with a 5 second budget
    Then the relay call carries the budget
    And the call envelope's deadline is 5 seconds away
    And a turn's deadline stays at the agent's timeout

  @unit
  Scenario: A hook declared after the connection started registers again
    Given an agent whose connection is already registered
    When a setup hook is declared on it
    Then the SDK registers again on a fresh connection, declaring setup
    But when the hook refuses the agent, the SDK deregisters it instead

  @integration
  Scenario: The register frame with hooks is accepted and stored on the agent
    Given an SDK that registers an agent with hooks setup true and teardown true
    When the platform accepts the frame
    Then the agent's stored config records the declared hooks

  @integration
  Scenario: A register frame from an older SDK without hooks is accepted
    Given an SDK that registers an agent with no hooks field
    When the platform accepts the frame
    Then the agent is recorded with no hooks
