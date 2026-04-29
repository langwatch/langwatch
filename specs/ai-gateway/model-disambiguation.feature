Feature: AI Gateway — model disambiguation when a VK has multiple providers
  As a developer calling the LangWatch AI Gateway with a multi-provider virtual key
  I want a clear 400 error when my model name could match multiple providers
  So that the gateway doesn't silently route my request to the wrong provider slot

  # Lane A iter 65 smoke surfaced that a multi-provider VK with a bare model
  # name (e.g. "gpt-5-mini") returns a spec-intended 400. The gateway does NOT
  # guess; the caller must disambiguate via either (a) a provider-qualified
  # prefix (`openai/gpt-5-mini`), or (b) a `config.model_aliases` entry on the
  # VK that maps the bare name to a specific `provider_slot/model`.

  Background:
    Given organization "acme" exists with project "acme-api"
    And project "acme-api" has provider bindings:
      | slot        | provider  | model_pattern     |
      | primary     | openai    | gpt-*             |
      | fallback-1  | anthropic | claude-*          |
    And a virtual key "vk_multi" is created with both provider slots active

  # ============================================================================
  # Bare model name on a multi-provider VK
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: Bare gpt-5-mini on a multi-provider VK returns 400 with actionable envelope
    When I POST to "/v1/chat/completions" using "vk_multi" with body:
      """
      {
        "model": "gpt-5-mini",
        "messages": [{"role": "user", "content": "hi"}]
      }
      """
    Then the response status is 400
    And the response body.type is "model_ambiguous"
    And the response body.message matches "model .* matched multiple provider slots"
    And the response body.hint contains "prefix the model with provider slot (e.g. `openai/gpt-5-mini`) or add a model_alias to the VK config"
    And the `X-LangWatch-Gateway-Request-Id` header is present
    # We don't leak the exact providers bound — enumerate-style error disclosure
    # is a footgun. Keep the hint abstract so operators don't accidentally
    # reveal per-tenant fleet structure.

  @integration @v1 @unimplemented
  Scenario: Provider-qualified prefix resolves cleanly
    When I POST to "/v1/chat/completions" using "vk_multi" with body:
      """
      {
        "model": "openai/gpt-5-mini",
        "messages": [{"role": "user", "content": "hi"}]
      }
      """
    Then the response status is 200
    And the dispatcher used provider slot "primary"
    And the `langwatch.model_source` span attr is "prefix"

  @integration @v1 @unimplemented
  Scenario: Provider-slot prefix also works (distinct from provider-name prefix)
    Given the VK config includes `model_aliases: { "claude-fast": "fallback-1/claude-haiku-4-5" }`
    When I POST with body `{"model": "claude-fast", ...}`
    Then the response status is 200
    And the dispatcher used provider slot "fallback-1"
    And the model sent upstream is "claude-haiku-4-5"
    And the `langwatch.model_source` span attr is "alias"

  @integration @v1 @unimplemented
  Scenario: Ambiguous model name becomes unambiguous after alias resolution
    Given the VK config includes `model_aliases: { "gpt-5-mini": "primary/gpt-5-mini" }`
    When I POST with body `{"model": "gpt-5-mini", ...}`
    Then the response status is 200
    # Alias lookup happens BEFORE ambiguity check. The VK operator has
    # explicitly disambiguated this model name with the alias — no 400.

  # ============================================================================
  # Single-provider VK — no ambiguity, no prefix needed
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: Single-provider VK accepts bare model name
    Given a virtual key "vk_solo" with only "primary: openai" bound
    When I POST to "/v1/chat/completions" using "vk_solo" with body `{"model": "gpt-5-mini", ...}`
    Then the response status is 200
    And the dispatcher used provider slot "primary"
    And the `langwatch.model_source` span attr is "single_provider"

  # ============================================================================
  # Unknown model — different failure class
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: Known provider prefix but unknown model returns upstream 400, not ambiguity
    When I POST with body `{"model": "openai/gpt-does-not-exist", ...}`
    Then the response status is 400
    And the response body.type is "upstream_4xx"
    And the response body.type is NOT "model_ambiguous"
    # The provider is clear (openai/), the MODEL is invalid. Ambiguity check
    # passed; upstream error pass-through takes over.

  @integration @v1 @unimplemented
  Scenario: Unknown provider prefix on VK returns 400 with clear envelope
    When I POST with body `{"model": "bedrock/claude-3-haiku", ...}` on "vk_multi" (no bedrock slot)
    Then the response status is 400
    And the response body.type is "model_provider_not_bound"
    And the response body.hint contains "bind a `bedrock` provider slot to this VK, or drop the prefix"

  # ============================================================================
  # Observability — operators should be able to measure ambiguity incidence
  # ============================================================================

  @unit @v1 @unimplemented
  Scenario: Ambiguity rejection emits a structured log at WARN
    When the gateway rejects a request with `model_ambiguous`
    Then a structured log is written at WARN with `reason=model_ambiguous`
    And the log includes `virtual_key_id`, `model_requested`, `candidate_slot_count`, `gateway_request_id`
    And the log does NOT include the provider slot names (avoid fleet disclosure)

  @unit @v1 @unimplemented
  Scenario: Prometheus counter tracks the ambiguity tail
    Given `gateway_http_requests_total{status="400", reason="model_ambiguous"}` is a declared metric
    When a bare model name hits a multi-provider VK
    Then the counter increments by 1
    # Ops can rate(...[5m]) to decide if this is a widespread client-config gap
    # worth tooling (e.g. warn-only header for a migration period).

  # ============================================================================
  # v1.1 — convenience auto-resolution with explicit opt-in
  # ============================================================================

  @out_of_scope @v1.1
  Scenario: VK config.auto_resolve_model_prefix defaults disambiguation heuristic
    Given the VK has `config.auto_resolve_model_prefix: true`
    And the organization defines a policy: "gpt-*" prefers "primary" slot
    When a bare `gpt-5-mini` hits the VK
    Then the gateway applies the policy automatically
    And the response sets `X-LangWatch-Model-Auto-Resolved: primary`
    # Adds an operator-controlled "be less strict" mode. Default stays strict
    # (current v1 behaviour) because silent routing is the classic footgun.

  @out_of_scope @v1.1
  Scenario: Warn-only disambiguation for migration periods
    Given the VK has `config.disambiguation_mode: warn`
    When a bare model hits the ambiguous path
    Then the gateway chooses a slot (by first-bound-priority) and succeeds
    And the response sets `X-LangWatch-Model-Warn: ambiguous: chose primary of [primary, fallback-1]`
    # Gives migration teams a soft-landing window to update client configs
    # without 400-ing every request. Strict mode is the default.
