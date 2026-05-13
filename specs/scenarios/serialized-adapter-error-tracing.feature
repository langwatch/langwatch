Feature: Serialized adapters always emit a span footprint on failure
  As a developer debugging a hung scenario run in LangWatch Observability
  I need every adapter call — even failing ones — to leave a span behind
  So I can tell timeout from network failure from server error without reading stderr.

  Background: tracking lw#3438. Customer trace showed only the simulator span
  on a hung run; the adapter span was absent because the failure path didn't
  touch the tracer. Each adapter now wraps its outbound NLP request in a span
  whose `error.kind` attribute distinguishes the failure mode.

  @unit
  Scenario: code-agent adapter emits a span tagged with the request URL on success
    Given a SerializedCodeAgentAdapter with a healthy NLP service
    When the adapter's `call` resolves
    Then a span named "SerializedCodeAgentAdapter.execute_nlp_request" exists
    And the span has attributes "http.url", "http.method", "scenario.agent.id", "http.status_code"

  @unit
  Scenario: code-agent adapter emits an error span with kind=timeout when the NLP service hangs
    Given a SerializedCodeAgentAdapter pointed at an unresponsive NLP service
    When the adapter's `call` is awaited past the fetch timeout
    Then it rejects with SerializedCodeAgentAdapterError carrying kind=timeout
    And the emitted span recorded the exception
    And the span has attribute "error.kind"="timeout"

  @unit
  Scenario: code-agent adapter emits an error span with kind=fetch when the network fails
    Given a SerializedCodeAgentAdapter where fetch rejects synchronously
    When the adapter's `call` is awaited
    Then it rejects with SerializedCodeAgentAdapterError carrying kind=fetch
    And the span has attribute "error.kind"="fetch"

  @unit
  Scenario: code-agent adapter emits an error span with kind=http when the NLP service returns non-2xx
    Given a SerializedCodeAgentAdapter where the NLP service returns HTTP 503
    When the adapter's `call` is awaited
    Then it rejects with SerializedCodeAgentAdapterError carrying kind=http and httpStatus=503
    And the span has attributes "error.kind"="http" and "http.status_code"=503
