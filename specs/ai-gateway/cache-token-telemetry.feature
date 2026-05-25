Feature: AI Gateway — prompt-cache token telemetry and cache-aware cost

  When a request reuses a provider's prompt cache, most of the prompt is read
  from cache at a fraction of the normal input price (≈10% for a cache read),
  while writing a new cache entry costs a premium. For billing and
  observability to be honest, the gateway's emitted trace span must record the
  cache token breakdown — how many tokens were read from cache, how many were
  written — as separate counts from the fresh, non-cached input tokens. The
  cost is then computed at cache pricing.

  Without the breakdown, a cached follow-up is billed as if every prompt token
  were fresh input. A customer reported this: an immediate follow-up that
  reused a ~37k-token cached prefix was priced as 37k fresh input tokens
  (dollars) instead of a cache read (cents).

  The span attribute names are the OTel GenAI dotted form, already read by the
  control-plane trace ingestion:
    gen_ai.usage.cache_read.input_tokens
    gen_ai.usage.cache_creation.input_tokens
  The fresh input-token count (gen_ai.usage.input_tokens) is the non-cached
  remainder and must NOT include the cached tokens, so the cost calculation can
  price each bucket once without subtraction.

  See also: span-shape.feature (the span the gateway emits), and the
  control-plane cost calculation that turns token counts into a cost.

  Background:
    Given a virtual key routing to a provider that supports prompt caching
    And the gateway emits a trace span per request

  # ==========================================================================
  # Gateway emission: the span must carry the cache breakdown
  # ==========================================================================

  @bdd @gateway @cache-telemetry @integration
  Scenario: A cached request records the cache-read and cache-write token counts on the span
    Given a follow-up request reuses a large cached prompt prefix
    When the gateway completes the request
    Then the span records the number of tokens read from the cache
    And the span records the number of tokens written to the cache
    And both are recorded separately from the fresh input-token count

  @bdd @gateway @cache-telemetry @integration
  Scenario: The fresh input-token count excludes cached tokens
    Given a request whose prompt is mostly served from the cache
    When the gateway completes the request
    Then the span's input-token count is only the non-cached remainder
    And it does not double-count the tokens read from or written to the cache

  @bdd @gateway @cache-telemetry @integration
  Scenario: A request with no cache activity records no cache tokens
    Given a request that neither reads nor writes the prompt cache
    When the gateway completes the request
    Then the span records no cache-read or cache-write tokens
    And the input-token count is the full prompt

  # ==========================================================================
  # Cost: cache reads priced cheap, not as fresh input
  # ==========================================================================

  @bdd @cost @cache-telemetry @integration
  Scenario: Cost reflects cache pricing, not the full input price
    Given a span that read a large prompt prefix from the cache
    When the cost is computed for the span
    Then the cached-read tokens are priced at the provider's cache-read rate
    And the cached-write tokens are priced at the provider's cache-write rate
    And the resulting cost is far lower than pricing the same tokens as fresh input

  # ==========================================================================
  # End-to-end: a real cached follow-up is billed at cents, not dollars
  # ==========================================================================

  @bdd @cache-telemetry @e2e
  Scenario: A real cached follow-up is billed at the cache rate, not full input price
    Given a real agent wrapper sends a follow-up that reuses a cached prompt prefix
    When the trace lands in the product
    Then the span shows the cache-read token count
    And the computed cost reflects the cache-read rate, not the full input price
