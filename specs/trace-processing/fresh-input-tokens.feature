Feature: Canonical input tokens are the fresh input, for every source

  A span's canonical usage keeps three disjoint input buckets: fresh input
  (`gen_ai.usage.input_tokens`), cache reads and cache writes. Cost prices each
  bucket at its own rate and a trace's total tokens add the three with the
  output, so a cached token counted inside the input as well as in its cache
  bucket is charged and counted twice.

  The OpenTelemetry GenAI conventions count the cache inside
  `gen_ai.usage.input_tokens`, and so do most instrumentations: OpenLLMetry,
  OpenInference, Pydantic AI, LiteLLM, Google ADK, current Mastra and Strands,
  and OpenAI and Gemini usage in general. Their input is restated as the fresh
  remainder once the span's cache buckets are known. A few sources already send
  the fresh input and keep it: the LangWatch gateway, the LangWatch SDKs and REST
  collector, Claude Code, Spring AI with Anthropic, and the Anthropic provider of
  AI SDK v5 and the older Mastra releases built on it. A span whose stated
  `gen_ai.usage.total_tokens` equals fresh input, output and cache keeps its input
  too. An input count smaller than its cache buckets cannot include them and is
  left as sent.

  @bdd @trace-processing @token-totals @unit
  Scenario: Instrumentations that follow the GenAI conventions have their input restated as fresh input
    Given a span from OpenLLMetry, Pydantic AI, LiteLLM or Copilot with an input count of 15,232
    And a cache read of 15,217
    When the span is canonicalised
    Then its input tokens are 15
    And its cache read tokens are 15,217

  @bdd @trace-processing @token-totals @unit
  Scenario: Older OpenLLMetry and Strands cache keys are read as cache reads and writes
    Given a span with an input count of 1,300 and the older underscore cache read and write keys
    When the span is canonicalised
    Then the cache counts are under the canonical cache read and write keys
    And its input tokens are the fresh remainder

  @bdd @trace-processing @token-totals @unit
  Scenario: An OpenInference prompt count that includes its cache is restated as fresh input
    Given an OpenInference span with a prompt count of 2,000, 1,500 cache reads and 300 cache writes
    When the span is canonicalised
    Then its input tokens are 200

  @bdd @trace-processing @token-totals @unit
  Scenario: A Gemini prompt count that includes its cached content is restated as fresh input
    Given a Google ADK span with a prompt count of 2,500 of which 2,100 came from cached content
    When the span is canonicalised
    Then its input tokens are 400

  @bdd @trace-processing @token-totals @unit
  Scenario: A span whose stated total counts its input as fresh keeps its input
    Given a span from the LangWatch gateway or an older Strands release
    And its total tokens equal its input, output and cache tokens
    When the span is canonicalised
    Then its input tokens are kept as sent

  @bdd @trace-processing @token-totals @unit
  Scenario: A Strands span whose total counts the cache inside its input is restated as fresh input
    Given a Strands span whose total tokens equal its input and output tokens
    And a cache read
    When the span is canonicalised
    Then its input tokens are the fresh remainder

  @bdd @trace-processing @token-totals @unit
  Scenario: A LangWatch SDK span with the flat cached input count keeps its fresh input
    Given a span from a LangWatch SDK with `gen_ai.usage.cached_input_tokens`
    When the span is canonicalised
    Then its input tokens are kept as sent
    And the cached input count is its cache read

  @bdd @trace-processing @token-totals @unit
  Scenario: A LangWatch REST collector span keeps its fresh input
    Given a span the REST collector built from SDK metrics with a cache read
    When the span is canonicalised
    Then its input tokens are kept as sent

  @bdd @trace-processing @token-totals @unit
  Scenario: A Claude Code span keeps its fresh input
    Given a Claude Code llm_request span with cache reads and writes
    When the span is canonicalised
    Then its input tokens are kept as sent

  @bdd @trace-processing @token-totals @unit
  Scenario: A Spring AI Anthropic span keeps its input as sent and a Spring AI OpenAI span is restated
    Given a Spring AI span from the Anthropic model with a cache read
    And a Spring AI span from the OpenAI model with a cache read
    When the spans are canonicalised
    Then the Anthropic span's input tokens are kept as sent
    And the OpenAI span's input tokens are the fresh remainder

  @bdd @trace-processing @token-totals @unit
  Scenario: An older Mastra Anthropic span keeps its input as sent and an older Mastra OpenAI span is restated
    Given an older Mastra span with the flat cached input count from an Anthropic model
    And an older Mastra span with the flat cached input count from an OpenAI model
    When the spans are canonicalised
    Then the Anthropic span's input tokens are kept as sent
    And the OpenAI span's input tokens are the fresh remainder

  @bdd @trace-processing @token-totals @unit
  Scenario: An AI SDK v5 Anthropic span's input count is kept as sent
    Given an AI SDK v5 span from the Anthropic provider with only the flat cached input count
    When the span is canonicalised
    Then its input tokens are kept as sent

  @bdd @trace-processing @token-totals @unit
  Scenario: An AI SDK v5 OpenAI span's input count is restated as fresh input
    Given an AI SDK v5 span from the OpenAI provider with only the flat cached input count
    When the span is canonicalised
    Then its input tokens are the fresh remainder

  @bdd @trace-processing @token-totals @unit
  Scenario: An input count is restated once, whichever passes see its cache
    Given a Claude SDK span whose input count includes a cache read and a cache write
    When every canonicaliser has run
    Then its input tokens are the fresh remainder, taken out once

  @bdd @trace-processing @token-totals @unit
  Scenario: A span without cache buckets keeps its input
    Given a span with an input count and no cache reads or writes
    When the span is canonicalised
    Then its input tokens are kept as sent
