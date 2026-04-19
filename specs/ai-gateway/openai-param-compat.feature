Feature: AI Gateway — OpenAI client-param compatibility translation
  As a developer using an older OpenAI SDK / CrewAI / LangChain client
  I want the gateway to accept legacy `max_tokens` on `gpt-5-*` requests
  So that I'm not forced into a client-library upgrade before I can use the latest OpenAI models through LangWatch

  # Regression coverage for finding #27 (Lane A iter 62). OpenAI changed the
  # request-parameter shape for the gpt-5 model family — `max_tokens` is
  # rejected with "use `max_completion_tokens` instead". Our OpenAI-compat
  # endpoints pass the field through untranslated, so every CrewAI / LangChain
  # client that still emits `max_tokens` gets a 400 when it targets gpt-5*.
  # The v1 gateway does NOT translate — operators can surface the issue by
  # reading the error envelope. v1.1 will add a small parameter-rewrite layer
  # keyed on the destination model family, so legacy clients "just work".

  Background:
    Given I have a virtual key "vk_prod" with a bound OpenAI provider credential
    And my VK allows the model "gpt-5-mini"

  # ============================================================================
  # v1 behaviour — pass-through, surface the upstream 400 verbatim
  # ============================================================================

  @integration @v1
  Scenario: gpt-5-mini with legacy max_tokens parameter returns 400 from upstream
    When I POST to "/v1/chat/completions" with body:
      """
      {
        "model": "gpt-5-mini",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 50
      }
      """
    Then the response status is 400
    And the response body.type is "upstream_4xx"
    And the response body.message contains "max_tokens"
    And the response body.message contains "max_completion_tokens"
    And the `X-LangWatch-Gateway-Request-Id` header is present
    # The error is PASSED THROUGH — the gateway does not translate the param
    # but does surface OpenAI's exact error message so the caller knows what
    # to change.

  @integration @v1
  Scenario: gpt-5-mini with new max_completion_tokens parameter succeeds
    When I POST to "/v1/chat/completions" with body:
      """
      {
        "model": "gpt-5-mini",
        "messages": [{"role": "user", "content": "hi"}],
        "max_completion_tokens": 50
      }
      """
    Then the response status is 200
    And the response body.choices[0].message.content is non-empty

  @integration @v1
  Scenario: gpt-4o with legacy max_tokens continues to work (v1 parity with OpenAI)
    When I POST to "/v1/chat/completions" with body:
      """
      {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 50
      }
      """
    Then the response status is 200
    # gpt-4-series still accepts max_tokens upstream. The gateway is a pass-
    # through; whatever OpenAI accepts, we accept. No translation needed
    # for the old model families.

  # ============================================================================
  # Observability — operators can measure the tail before translating
  # ============================================================================

  @unit @v1
  Scenario: upstream 400 with "max_tokens" in the error body emits a structured log
    When the gateway receives an upstream 400 with body containing "max_tokens"
    Then a structured log is written at INFO with `reason=legacy_max_tokens_rejected`
    And the log includes `model`, `virtual_key_id`, and `gateway_request_id`
    And the log is rate-limited to once per VK per hour to avoid noise

  @unit @v1
  Scenario: Prometheus counter tracks the legacy-param rejection tail
    Given `gateway_http_requests_total{status="400", reason="legacy_max_tokens"}` is a declared metric
    When the gateway receives an upstream 400 with body containing "max_tokens"
    Then the counter increments by 1
    And operators can `rate(...[5m])` the counter to decide whether v1.1 translation is worth shipping

  # ============================================================================
  # v1.1 behaviour — automatic translation at the gateway
  # ============================================================================

  @out_of_scope @v1.1
  Scenario: gpt-5-mini with legacy max_tokens is translated on the hot path
    When a v1.1 gateway receives:
      """
      {
        "model": "gpt-5-mini",
        "max_tokens": 50
      }
      """
    Then the gateway rewrites the field to `max_completion_tokens: 50`
    And the rewrite is logged at DEBUG with `reason=compat_param_rewrite`
    And a response header `X-LangWatch-Compat: max_tokens->max_completion_tokens` is set
    # The header lets clients learn they're using a legacy shape without
    # surfacing as a 400 in the wild.

  @out_of_scope @v1.1
  Scenario: Translation is disabled per-VK for full upstream-shape parity
    Given a VK has `config.openai_compat_translate = false`
    When that VK sends `max_tokens` on `gpt-5-mini`
    Then the gateway passes through untranslated
    And the request fails with 400 from upstream (original v1 behaviour)

  # ============================================================================
  # Out of scope for v1.1 — more aggressive translation
  # ============================================================================

  @out_of_scope @v2
  Scenario: Model alias + param translation composed together
    # If v1.1 lands both `max_tokens` translation AND the model-alias layer
    # already exists, operators could argue for a one-hop rewrite that lets
    # gpt-4o-via-alias requests flow to gpt-5-mini with both the model
    # substitution AND the param translation. Too policy-heavy for v1.1 —
    # defer to v2 behind an explicit VK-config opt-in.
