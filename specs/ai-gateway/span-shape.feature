Feature: Gateway span shape — mandatory attributes per completed request
  As a LangWatch platform operator
  I want every gateway-produced OpenTelemetry span to carry a known set
  of attributes with valid non-zero values when upstream data is present
  So that downstream tooling (Traces UI, cost rollups, online evaluators,
  usage dashboards) can rely on those attributes being there — and any
  drift from the contract is caught at merge time, not at dogfood time.

  Driven by: rchaves iter 107 bug — trace showed 0 tokens despite upstream
  response carrying usage.input_tokens=7, usage.output_tokens=119.
  Ref: findings #74 (token mapping) + spec contract lives independent of
  the implementation so the Lane A fix can be verified against the spec.

  Background:
    Given the gateway is running with the default OTLP exporter configured
    And a test upstream is dispatched to that returns a well-formed response
    And an OTLP test collector captures the exported span

  # ─────────────────────────────────────────────────────────────────────────
  # §1. Required attributes on every completed /v1/chat/completions span
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Success span carries model, cost, and token attributes
    When the consumer posts a valid /v1/chat/completions through the gateway
    And the upstream returns a 200 with usage { prompt_tokens: 42, completion_tokens: 128 }
    Then the exported span has all of the following attributes populated:
      | attribute                         | expected                          |
      | langwatch.origin                  | "gateway"                         |
      | langwatch.vk_id                   | matches the VK id from the bundle |
      | langwatch.vk_display_prefix       | matches the VK prefix             |
      | langwatch.project_id              | matches the project that owns VK  |
      | gen_ai.request.model              | equals the request body "model"   |
      | gen_ai.response.model             | equals the upstream response model|
      | gen_ai.system                     | matches the dispatched provider   |
      | gen_ai.usage.input_tokens         | 42 (integer, > 0)                 |
      | gen_ai.usage.output_tokens        | 128 (integer, > 0)                |
      | langwatch.cost_usd                | > 0 (Decimal, 6-place precision)  |
      | http.request.method               | "POST"                            |
      | http.response.status_code         | 200                               |
      | otel.span.status                  | OK                                |

  Scenario: Token attributes are integers, not strings
    Given the upstream returns usage { prompt_tokens: "42", completion_tokens: "128" }
      # Some providers return numeric strings (anthropic, legacy bedrock)
    When the gateway normalises upstream usage into the span
    Then gen_ai.usage.input_tokens is emitted as the integer 42
    And gen_ai.usage.output_tokens is emitted as the integer 128
    # Exporter-side lying via string would break downstream type checks.

  # ─────────────────────────────────────────────────────────────────────────
  # §2. Provider-shape normalisation — the #74 regression surface
  # ─────────────────────────────────────────────────────────────────────────
  # Bifrost exposes the upstream usage under different shapes depending on
  # which provider we dispatched to. The gateway's span mapper MUST read
  # all of these shapes and normalise to gen_ai.usage.{input,output}_tokens.
  # These scenarios prevent #74-class regressions.

  Scenario Outline: Usage normalisation across provider shapes
    When the upstream of kind "<provider>" returns a response body containing "<usage-shape>"
    Then the gateway span carries gen_ai.usage.input_tokens = <in>
    And gen_ai.usage.output_tokens = <out>

    Examples:
      | provider   | usage-shape                                                  | in | out |
      | openai     | { "usage": { "prompt_tokens": 7, "completion_tokens": 119 } } | 7  | 119 |
      | anthropic  | { "usage": { "input_tokens": 7, "output_tokens": 119 } }     | 7  | 119 |
      | bedrock    | { "usage": { "inputTokens": 7, "outputTokens": 119 } }       | 7  | 119 |
      | gemini     | { "usageMetadata": { "promptTokenCount": 7, "candidatesTokenCount": 119 } } | 7 | 119 |
      | vertex     | { "usageMetadata": { "promptTokenCount": 7, "candidatesTokenCount": 119 } } | 7 | 119 |
      | azure      | { "usage": { "prompt_tokens": 7, "completion_tokens": 119 } } | 7  | 119 |

  Scenario: Bifrost extra_fields is inspected when the top-level usage is absent
    Given the upstream response body has no top-level "usage" field
    And Bifrost populated extra_fields.request_type + extra_fields.usage
    When the span mapper runs
    Then gen_ai.usage.input_tokens is read from extra_fields.usage.{input,prompt}_tokens
    And gen_ai.usage.output_tokens is read from extra_fields.usage.{output,completion}_tokens
    # Prevents another #74: Bifrost route where top-level usage is stripped.

  # ─────────────────────────────────────────────────────────────────────────
  # §3. Cache-token attributes
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Anthropic prompt-caching usage lands on the span
    Given the upstream is Anthropic and returns usage with cache_creation_input_tokens=100 + cache_read_input_tokens=50
    When the span is exported
    Then gen_ai.usage.cache_creation_input_tokens = 100
    And gen_ai.usage.cache_read_input_tokens = 50
    And langwatch.cost_usd accounts for the cache discount on the 50 cached tokens

  # ─────────────────────────────────────────────────────────────────────────
  # §4. Streaming spans finalise with reassembled token counts
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Streaming /v1/chat/completions finalises usage after last chunk
    Given a streaming request where the final chunk carries usage { prompt_tokens: 42, completion_tokens: 128 }
    When the stream closes
    Then the parent span carries gen_ai.usage.input_tokens = 42
    And gen_ai.usage.output_tokens = 128
    And langwatch.cost_usd is computed from those totals
    And the span.status is OK
    # NOT emitted until the stream closes — span is finalised at stream end.

  # ─────────────────────────────────────────────────────────────────────────
  # §5. Error spans still carry model + partial attributes
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: 502 upstream error still populates model + status
    Given the upstream returns 502 Bad Gateway
    When the exported span arrives at the collector
    Then gen_ai.request.model is populated (we knew what we tried to call)
    And http.response.status_code = 502
    And otel.span.status = ERROR
    And exception.type + exception.message carry the upstream error shape
    But gen_ai.usage.input_tokens / output_tokens are ABSENT (not emitted as 0)
    # Absent signals "no data" — downstream shouldn't treat 0 as "0 tokens used".

  # ─────────────────────────────────────────────────────────────────────────
  # §6. Fallback attempts
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Fallback chain records attempt count + which provider won
    Given the primary (openai) returns 5xx twice
    And the secondary (anthropic) returns 200 with usage
    When the request completes
    Then langwatch.fallback.attempts_count = 3
    And langwatch.fallback.winning_provider = "anthropic"
    And gen_ai.usage.* is read from the winning (anthropic) response
    And langwatch.cost_usd uses the anthropic model's price

  # ─────────────────────────────────────────────────────────────────────────
  # §7. Pre-merge CI gate — the contract test
  # ─────────────────────────────────────────────────────────────────────────

  # The Go span-mapper test suite in services/gateway/internal/otel/span_test.go
  # MUST include at least one assertion per Example row in §2. CI fails if any
  # provider's Example is missing or asserts zero. This is the "would have
  # caught #74 at merge time" contract — operationalised.

  Scenario: CI gate catches a #74-class regression
    Given the gateway is built from a candidate branch
    When `go test ./internal/otel/...` is run in the gateway-ci workflow
    And the test against a mock openai upstream returns usage { prompt_tokens: 42, completion_tokens: 128 }
    And the span mapper fails to stamp gen_ai.usage.*
    Then `go test` fails with a message pointing at the missing attribute
    And the PR cannot merge to main

  # ─────────────────────────────────────────────────────────────────────────
  # §8. Out of scope (for now)
  # ─────────────────────────────────────────────────────────────────────────

  # - Vendor-specific embedding-token attributes — embeddings is a narrow
  #   product path; add a follow-up spec if embeddings cost tracking drifts
  # - Image-token accounting (multi-modal) — follow the provider's usage
  #   shape when they expose it; until then we don't fabricate token counts
  # - Payload capture (langwatch.input / langwatch.output) is a separate
  #   contract — see specs/ai-gateway/payload-capture.feature
