Feature: Cached-token capture from agent SDK spans

  Prompt caching is the single biggest LLM cost saver: a stable prefix served
  from the provider's cache bills at a fraction of the fresh-input rate. For
  that saving to be visible, every trace must carry the split — how much of
  the input was read from cache, how much was written to it, and how much was
  fresh — regardless of which SDK emitted the span.

  Agent SDKs built on the Vercel AI SDK (opencode among them) report usage
  with a cache-inclusive input total plus separate cached counts. The product
  convention is the opposite: the input count is the fresh remainder, with
  cache read and cache write as separate buckets, so token totals and cost
  sum the buckets without counting the cached share twice. The tooltip
  behavior that displays the split is covered in traces-v2/metrics.feature.

  Background:
    Given a project receiving traces from an agent built on the AI SDK

  @bdd @trace-processing @cache-telemetry @unit
  Scenario: A cached turn's input is split into fresh and cached buckets
    Given an LLM span reporting a cache-inclusive input total and a cached count
    When the span is processed
    Then the span's input tokens are only the fresh, non-cached remainder
    And the cached count is recorded as cache-read tokens
    And a cache-writing turn records its cache-write tokens the same way

  @bdd @trace-processing @cache-telemetry @unit
  Scenario: The SDK's own fresh-input count is trusted when reported
    Given an LLM span reporting both a cache-inclusive total and its own fresh-input count
    When the span is processed
    Then the fresh-input count reported by the SDK wins over the derived remainder

  @bdd @trace-processing @cache-telemetry @unit
  Scenario: The cached split is counted once per LLM call
    Given the SDK repeats the same usage rollup on a parent span and its provider-call span
    When the trace is processed
    Then only the provider-call span carries the cached split
    And the trace totals count the cached tokens once

  @bdd @trace-processing @cache-telemetry @unit
  Scenario: Reasoning tokens reported by the SDK reach the trace
    Given an LLM span reporting a reasoning-token count
    When the span is processed
    Then the trace shows the reasoning tokens alongside the input and output counts
