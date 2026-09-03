Feature: SDK timing and metrics canonicalisation
  SDK timing and metrics attributes are canonicalised into trace summary and
  span attributes for both TypeScript and Python SDK payload shapes.

  Background:
    Given a project ingesting traces through the OTLP collector

  Rule: Time to first token from langwatch.timestamps

    Scenario: Span with first_token_at populates the trace summary TTFT
      Given an LLM span whose "langwatch.timestamps" attribute contains a first_token_at 800ms after the span start
      And the span emits no first-token stream events and no gen_ai.server.time_to_first_token attribute
      When the trace is processed
      Then the trace summary records a time to first token of 800ms

    Scenario: Stream events win over langwatch.timestamps
      Given an LLM span with a first-token stream event 500ms after the span start
      And a "langwatch.timestamps" attribute with a first_token_at 800ms after the span start
      When the trace is processed
      Then the trace summary records a time to first token of 500ms

    Scenario: first_token_at before the span start is ignored
      Given an LLM span whose "langwatch.timestamps" attribute contains a first_token_at earlier than the span start
      When the trace is processed
      Then the trace summary records no time to first token

  Rule: Python SDK metrics blob is honoured

    Scenario: Bare snake_case metrics provide token counts
      Given a span whose "langwatch.metrics" attribute is a bare JSON object with prompt_tokens 100 and completion_tokens 50
      And no semconv token usage attributes are present
      When the span is canonicalised
      Then the canonical attributes contain gen_ai.usage.input_tokens 100 and gen_ai.usage.output_tokens 50

    Scenario: Bare snake_case metrics provide a manual cost
      Given a span whose "langwatch.metrics" attribute is a bare JSON object with cost 0.042
      When the span is canonicalised
      Then the canonical attributes record 0.042 as the span cost

    Scenario: Bare snake_case metrics provide reasoning tokens
      Given a span whose "langwatch.metrics" attribute is a bare JSON object with reasoning_tokens 32
      When the span is canonicalised
      Then the canonical attributes contain gen_ai.usage.reasoning_tokens 32

    Scenario: Bare snake_case metrics provide time to first token as a duration
      Given a span whose "langwatch.metrics" attribute is a bare JSON object with first_token_ms 650
      When the span is canonicalised
      Then the canonical attributes contain gen_ai.server.time_to_first_token 650

    Scenario: TypeScript structured metrics keep working
      Given a span whose "langwatch.metrics" attribute is { type: "json", value: { promptTokens: 10, completionTokens: 5, cost: 0.001 } }
      When the span is canonicalised
      Then the canonical attributes contain gen_ai.usage.input_tokens 10, gen_ai.usage.output_tokens 5, and a span cost of 0.001

    Scenario: Semconv attributes win over the metrics blob
      Given a span with gen_ai.usage.input_tokens 200 already set
      And a "langwatch.metrics" attribute with prompt_tokens 100
      When the span is canonicalised
      Then the canonical attributes keep gen_ai.usage.input_tokens 200

  Rule: An explicit cost on the span beats the registry estimate
    An explicit metrics cost wins over the registry estimate unless custom
    per-token enrichment rates are present; zero falls through to the registry.

    Scenario: Explicit cost wins for a known model with tokens
      Given a span for a known registry model with prompt and completion tokens
      And the span carries an explicit cost of 0.042
      When the span cost is computed
      Then the computed cost is 0.042, not the registry estimate

    Scenario: Explicit cost wins for an on-table Anthropic model
      Given a span for an on-table Anthropic model with prompt and completion tokens
      And the span carries an explicit cost of 0.123
      When the span cost is computed
      Then the computed cost is 0.123, not the registry estimate

    Scenario: A zero explicit cost falls through to the registry
      Given a span for a known registry model with prompt and completion tokens
      And the span's explicit cost is zero
      When the span cost is computed
      Then the computed cost is the registry estimate

    Scenario: Per-token enrichment rates outrank an explicit total cost
      Given a span with custom per-token input and output rates
      And the span also carries an explicit total cost
      When the span cost is computed
      Then the computed cost uses the per-token rates, not the explicit total
