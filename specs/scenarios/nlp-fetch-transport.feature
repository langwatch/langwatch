Feature: Scenario adapters reach nlpgo with their own undici dispatcher
  As a customer running a code or workflow agent in a simulation
  I want every turn to reach the NLP service
  So that a long-running agent is bounded by its deadline, not cut off before it starts

  # Context: the code and workflow adapters raise undici's own
  # headersTimeout/bodyTimeout past its 300s default by passing a `dispatcher`
  # built with the `undici` npm package (see server/nlpgo/timeouts.ts). An
  # AbortController deadline alone cannot raise those, which is what cut long
  # code blocks off at 300s.
  #
  # That dispatcher only works with a fetch from the SAME package. Node's
  # global fetch is bound to the undici bundled with the Node runtime (7.29.0
  # on Node 24), whose request handler has a different shape, and the npm
  # undici (8.x) rejects it up front with
  # "InvalidArgumentError: invalid onRequestStart method". Pairing the two
  # failed every agent call in about a second, before a byte left the process:
  # the test call in the agent editor and every simulation turn alike.
  #
  # The adapter suites mock fetch, so they cannot see a mismatch between the
  # fetch and the dispatcher. These scenarios are bound to a test that mocks no
  # part of the transport: real undici, real dispatcher, real sockets, against
  # a loopback server.

  @unit
  Scenario: A code agent turn reaches the NLP service
    Given a code agent whose NLP service is reachable
    When the simulator sends the agent a message
    Then the agent's output is returned to the simulator
    And the service receives an execute_flow event

  @unit
  Scenario: A code agent with a deadline past undici's own default still reaches the service
    Given a code agent whose code budget is longer than undici's 300s default
    When the simulator sends the agent a message
    Then the agent's output is returned to the simulator

  @unit
  Scenario: A workflow agent turn reaches the NLP service
    Given a workflow agent whose NLP service is reachable
    When the simulator sends the agent a message
    Then the agent's output is returned to the simulator
