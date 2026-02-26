Feature: OTEL Trace Context Propagation for HTTP Scenario Targets

  When scenarios call HTTP agent endpoints, the judge needs visibility into what
  happened inside the user's agent (LLM calls, tool calls). We propagate W3C
  traceparent headers so the user's OTEL SDK links spans to our trace, then
  query ES for those spans before judge evaluation.

  This feature covers:
  1. Header injection (traceparent + x-langwatch-scenario-run)
  2. Trace ID collection across conversation turns
  3. ES span query with retry (spans arrive asynchronously)
  4. Feeding spans to judge via JudgeSpanCollector interface
  5. Graceful degradation when spans are missing or late

  Background:
    Given a scenario configured with an HTTP agent target

  # ---------------------------------------------------------------------------
  # Header Injection (both adapter variants)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Serialized HTTP adapter injects traceparent header
    Given an active OTEL trace context in the child process
    When the serialized HTTP adapter makes a request to the agent endpoint
    Then the request includes a valid W3C "traceparent" header
    And the trace ID in the header matches the child process trace context

  @unit
  Scenario: Serialized HTTP adapter injects LangWatch correlation header
    Given a scenario run with a known batch run ID
    When the serialized HTTP adapter makes a request to the agent endpoint
    Then the request includes an "x-langwatch-scenario-run" header with the batch run ID

  @unit
  Scenario: Direct HTTP adapter injects traceparent header
    Given an active OTEL trace context in the main process
    When the direct HTTP adapter makes a request to the agent endpoint
    Then the request includes a valid W3C "traceparent" header

  @unit
  Scenario: Direct HTTP adapter injects LangWatch correlation header
    Given a scenario run with a known batch run ID
    When the direct HTTP adapter makes a request to the agent endpoint
    Then the request includes an "x-langwatch-scenario-run" header with the batch run ID

  @unit
  Scenario: Trace headers coexist with custom headers
    Given the HTTP agent has custom headers configured
    When the HTTP adapter makes a request
    Then both the custom headers and trace context headers are present
    And no headers are overwritten

  @unit
  Scenario: Adapter proceeds without trace headers when OTEL context is unavailable
    Given no active OTEL trace context exists
    When the HTTP adapter makes a request
    Then the request proceeds without traceparent header
    And no error is thrown

  # ---------------------------------------------------------------------------
  # Trace ID Collection Across Turns
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Same trace ID is propagated across all turns of a conversation
    Given a multi-turn conversation with the HTTP adapter
    When the adapter makes requests for turn 1, turn 2, and turn 3
    Then all requests carry the same trace ID in their traceparent headers

  @unit
  Scenario: Adapter records the propagated trace ID for later ES query
    When the HTTP adapter makes a request with trace context
    Then the trace ID is recorded and accessible for span collection

  # ---------------------------------------------------------------------------
  # ES Span Query (with timing awareness)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Spans are queried from ES by trace ID after conversation completes
    Given the HTTP adapter propagated a trace ID across multiple turns
    And the user's service has reported spans to ES under that trace ID
    When span collection is triggered before judge evaluation
    Then the system queries ES for spans matching the propagated trace ID

  @integration
  Scenario: Span query retries when spans have not yet arrived
    Given the HTTP adapter propagated a trace ID
    And the user's service has not yet flushed spans to ES
    When span collection is triggered
    Then the system retries the ES query with backoff
    And returns whatever spans are available after the retry window

  @integration
  Scenario: Span query filters out scenario infrastructure spans
    Given the ES contains both user agent spans and scenario execution spans
    When spans are queried by trace ID
    Then only user agent spans are returned
    And scenario infrastructure spans (user simulator, judge LLM calls) are excluded

  # ---------------------------------------------------------------------------
  # Feeding Spans to Judge
  # ---------------------------------------------------------------------------

  @integration
  Scenario: ES-backed spans are provided to the judge via span collector
    Given spans have been collected from ES for a scenario run
    When the judge agent is created for evaluation
    Then it receives a span collector pre-populated with the ES spans

  @integration
  Scenario: Judge can evaluate tool call behavior from collected spans
    Given the collected spans include tool call information
    And the scenario criteria include tool usage requirements
    When the judge evaluates the scenario
    Then the judge's prompt includes a digest of the tool call spans

  # ---------------------------------------------------------------------------
  # Graceful Degradation
  #
  # Empty spans are not an error — the judge evaluates what it has. If the
  # criteria reference tool calls and no spans exist, the judge fails the
  # criteria naturally. No special warning infrastructure needed.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Empty span collection does not fail the scenario
    Given a scenario run where the user's service did not report spans
    When spans are queried from ES and none are found after retries
    Then the span collector is populated with an empty set
    And the judge evaluates normally with no span digest

  @integration
  Scenario: ES query failure produces a synthetic error span
    Given a scenario run with a valid trace ID
    When the ES span query fails with a network error
    Then the span collector contains a synthetic error span
    And the error span name is "langwatch.span_collection.error"
    And the error span attributes include the failure reason
    And the error is logged as a warning

  @integration
  Scenario: Span collection timeout does not block scenario indefinitely
    Given a configurable span collection timeout (default 10 seconds)
    When spans have not arrived within the timeout window
    Then span collection completes with whatever was found
    And judge evaluation proceeds immediately
