Feature: Workflow and evaluation failures are logged with fault attribution
  As an operator of the NLP engine
  I want every node failure and request failure logged with who it is on
  So that I can see the errors users face on workflows and evaluations, and
    alert on increases before customers report them

  Background:
    Node failures (LLM calls, evaluators, code blocks, HTTP blocks) currently
    flow to the client as error events with no server-side log line. Every
    failure gets logged with a fault attribution:
      - customer: their workflow, dataset, code, endpoint, or provider
        account (out of credits, invalid key) — logged at info
      - provider: the upstream LLM provider or evaluator backend failed or
        timed out — logged at warn
      - platform: our bug (engine error, executor not wired) — logged at error
    Customer faults are still logged because a spike in them can be a false
    flag for a platform problem. Logs inherit the request's project, trace
    and origin context so failures are attributable per customer and per
    surface (workflow, evaluation, playground, scenario).

    # Bindings: services/nlpgo/app/engine/faults_test.go,
    #   services/nlpgo/adapters/httpapi/handler_errors_test.go
    # Choke points: services/nlpgo/app/engine/engine.go (runLayer),
    #   services/nlpgo/adapters/httpapi/handlers.go (error responses)

  @unit
  Scenario: A failed node is logged with its node and error identity
    Given any workflow or evaluation node fails during a run
    When the node result is recorded
    Then a log records the node id, node type, error type and message with a
      fault attribution

  @unit
  Scenario: An LLM call rejected by the provider carries the upstream status
    Given a signature node's LLM call is rejected by the gateway or provider
    When the node failure is recorded
    Then the node error carries the upstream HTTP status
    And the fault is customer for a rejection and provider for a server error

  @unit
  Scenario: A provider rejection names the provider in the user-facing message
    Given a provider rejects an LLM call with its own error body
    When the failure surfaces to the user
    Then the message names the provider followed by the provider's reason verbatim
    # An ambiguous provider-edge rejection like "Request headers are too
    # large." must not read as a LangWatch failure; the user needs to see
    # WHO rejected the call to know where to act.

  @unit
  Scenario: An engine bug is logged as a platform fault
    Given a node fails because of an engine-side problem
    When the node failure is recorded
    Then the failure is logged at error level with platform fault

  @unit
  Scenario: A failed request is logged before the error response is written
    Given a workflow or evaluation request fails at the HTTP layer
    When the error response is written
    Then the failure is logged with its error code and fault attribution
