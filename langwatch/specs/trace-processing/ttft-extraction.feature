Feature: Time To First Token extraction from all SDK signal sources
  The trace-processing pipeline must extract TTFT from every known signal
  source so that observability dashboards show accurate streaming latency
  regardless of which instrumentation library produced the span.

  Background:
    Given the event-sourcing trace pipeline is processing spans

  Scenario: OpenInference span with "First Token Stream Event" event
    Given a span from openinference.instrumentation.openai
    And the span has an event named "First Token Stream Event" at 250ms after span start
    When the pipeline computes token timing
    Then timeToFirstTokenMs is 250

  Scenario: Strands SDK span with gen_ai.server.time_to_first_token attribute
    Given a span from strands.telemetry.tracer
    And the span has attribute gen_ai.server.time_to_first_token set to 2046
    And the span has no streaming events
    When the pipeline computes token timing
    Then timeToFirstTokenMs is 2046

  Scenario: Span with both streaming events and the TTFT attribute
    Given a span that has both a first_token event at 300ms and gen_ai.server.time_to_first_token set to 500
    When the pipeline computes token timing
    Then timeToFirstTokenMs is 300
    Because event-based timing takes precedence over the span attribute
