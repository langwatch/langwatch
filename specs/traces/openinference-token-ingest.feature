Feature: Ingest OpenInference token-count attributes
  As an operator forwarding OTel traces from OpenInference instrumentors
  I want LangWatch's collector to extract `llm.token_count.*` attributes
  So that trace tokens and cost are computed even without LiteLLM / OpenLLMetry

  # =========================================================================
  # Why this exists
  # =========================================================================
  #
  # The new event-sourcing canonicalisation pipeline
  # (`server/app-layer/traces/canonicalisation/extractors/`) maps two upstream
  # conventions into canonical `gen_ai.usage.*` attributes:
  #
  #   - Vercel AI SDK (`VercelExtractor`):    `ai.usage.{...}`
  #   - OpenLLMetry/OTel (`GenAIExtractor`):   `gen_ai.usage.{...}`
  #
  # OpenInference (Arize Phoenix) — the other major OTel-GenAI convention,
  # used by `openinference.instrumentation.{openai,anthropic,langchain,...}` —
  # emits a third shape: `llm.token_count.*`.
  #
  # Before this feature, OpenInference token counts were dropped silently by
  # the canonicalisation pipeline: they leaked into span params (because the
  # whole attribute map gets dumped there) but never reached
  # `gen_ai.usage.{input,output}_tokens`, so downstream cost computation
  # never fired for OpenInference-instrumented spans.
  #
  # =========================================================================
  # Attribute mapping (handled by `OpenInferenceExtractor.apply`)
  # =========================================================================
  #
  #   llm.token_count.prompt                          → gen_ai.usage.input_tokens
  #   llm.token_count.completion                      → gen_ai.usage.output_tokens
  #   llm.token_count.completion_details.reasoning    → gen_ai.usage.reasoning_tokens
  #   llm.token_count.prompt_details.cache_read       → gen_ai.usage.cache_read.input_tokens
  #   llm.token_count.prompt_details.cache_write      → gen_ai.usage.cache_creation.input_tokens
  #
  # `llm.token_count.total` is consumed (so it doesn't leak into params) but
  # not stored — total tokens are always derived as prompt + completion
  # downstream.
  #
  # Precedence: `setAttrIfAbsent` is used throughout, so any canonical value
  # already set by `GenAIExtractor` (which runs before `OpenInferenceExtractor`
  # in the pipeline) wins.

  Background:
    Given an LLM span produced by an OpenInference instrumentor
    And the existing `gen_ai.usage.*` and `ai.usage.*` mappings still work

  Scenario: Prompt and completion tokens are extracted
    Given the span carries attributes
      | key                          | value |
      | llm.token_count.prompt       | 751   |
      | llm.token_count.completion   | 94    |
    When the canonicalisation pipeline runs
    Then `gen_ai.usage.input_tokens` is 751
    And `gen_ai.usage.output_tokens` is 94

  Scenario: Reasoning tokens are extracted
    Given the span carries
      | key                                            | value |
      | llm.token_count.completion_details.reasoning   | 12    |
    When the canonicalisation pipeline runs
    Then `gen_ai.usage.reasoning_tokens` is 12

  Scenario: Cache-read / cache-write tokens are extracted
    Given the span carries
      | key                                         | value |
      | llm.token_count.prompt_details.cache_read   | 120   |
      | llm.token_count.prompt_details.cache_write  | 30    |
    When the canonicalisation pipeline runs
    Then `gen_ai.usage.cache_read.input_tokens` is 120
    And `gen_ai.usage.cache_creation.input_tokens` is 30

  Scenario: All llm.token_count.* keys are consumed (no leaking into params)
    Given the span carries every `llm.token_count.*` attribute
    When the canonicalisation pipeline runs
    Then none of those keys remain in the attribute bag

  Scenario: Canonical gen_ai.usage.* set by GenAIExtractor wins
    Given the span carries both `gen_ai.usage.input_tokens=42` and `llm.token_count.prompt=999`
    When the canonicalisation pipeline runs
    Then `gen_ai.usage.input_tokens` stays 42 (no overwrite)

  Scenario: Cost is computed downstream once tokens are populated
    Given a model entry exists in the registry that matches the span's model
    And the span carries `llm.token_count.prompt=751` and `llm.token_count.completion=94`
    When the trace is processed end-to-end
    Then the trace metrics report a non-null `total_cost`
