Feature: AI Gateway — transparent upstream error forwarding

  When a request fails, the gateway must let the caller see the SAME outcome
  it would have seen talking to the provider directly: the upstream HTTP
  status code, the upstream error body, and any retry-signalling headers
  (Retry-After, x-should-retry), forwarded verbatim. The gateway is a
  conduit, not an error rewriter.

  Why this matters: agent clients (Claude Code, Codex, etc.) decide whether
  to retry purely from the HTTP status. Claude Code retries 429 / 500 / 502 /
  503 / 529 and treats everything else as terminal. If the gateway masks a
  terminal upstream error (e.g. Anthropic's "credit balance too low", a
  non-retryable 400) as a retryable 5xx, the client retries it up to 10x —
  a long, pointless "Retrying attempt N/10" storm that ends in failure
  instead of the immediate, actionable provider message. The inverse is just
  as bad: a genuinely retryable upstream 429/503 must stay retryable, not be
  flattened to a terminal 4xx.

  The contract applies to ALL providers and BOTH dispatch paths (streaming
  and non-streaming). A bug surfaced where the non-streaming path forwarded
  the upstream status correctly but the streaming path wrapped the upstream
  status in a generic "provider_error" 502 envelope (the real status was
  preserved only in an unused meta.status field) — so the streaming client,
  which is the common case for chat wrappers, saw a retryable 502 for a
  terminal 400.

  Control-plane-origin errors (the gateway's OWN terminal rejections, before
  any provider is called) already satisfy the same terminal-not-retryable
  rule and are specified elsewhere:
    - budget hard-block -> HTTP 402 "budget_exceeded"  (see budgets.feature)
    - invalid / revoked / unknown virtual key -> HTTP 401 / 403
      (see auth-cache.feature, virtual-keys.feature)
  Those are clean terminal 4xx today; this feature covers the remaining gap,
  which is provider-origin passthrough.

  Background:
    Given a virtual key "vk-demo" resolving to provider "anthropic"
    And the gateway is reachable at its OpenAI/Anthropic-compatible endpoint

  # ==========================================================================
  # Provider-origin: forward upstream status + body verbatim
  # ==========================================================================

  @bdd @error-transparency @integration
  Scenario: Upstream terminal 4xx is forwarded verbatim on the non-streaming path
    Given the upstream provider responds 400 with a terminal error body
    And the request is non-streaming
    When the client calls the gateway with "vk-demo"
    Then the gateway responds with HTTP 400
    And the response body is the upstream error body, unmodified
    And the gateway does not wrap it in a "provider_error" envelope

  @bdd @error-transparency @integration
  Scenario: Upstream terminal 4xx is forwarded verbatim on the streaming path
    Given the upstream provider responds 400 with a terminal error body
    And the request is streaming (stream=true)
    When the client calls the gateway with "vk-demo"
    Then the gateway responds with HTTP 400, not 502
    And the response body is the upstream error body, unmodified
    And the upstream status is the HTTP status, not buried in a meta field

  @bdd @error-transparency @integration
  Scenario: Upstream retryable status is forwarded as-is without over-correction
    Given the upstream provider responds 429 with Retry-After: 30
    When the client calls the gateway with "vk-demo"
    Then the gateway responds with HTTP 429
    And the upstream retry-signalling headers (Retry-After, x-should-retry) are preserved
    And the gateway does not flatten the retryable 429 into a terminal 4xx

  @bdd @error-transparency @integration
  Scenario: Terminal upstream error is identical across stream and non-stream
    Given the upstream provider responds 401 with a terminal error body
    When the client calls the gateway streaming and non-streaming with "vk-demo"
    Then both responses carry HTTP 401
    And both response bodies match the upstream error body

  # ==========================================================================
  # End-to-end: the real wrapper must fail fast, not retry-loop
  # ==========================================================================

  @bdd @error-transparency @e2e @unimplemented
  Scenario: Credit-depleted provider key fails fast through the wrapper with no retry loop
    Given the provider account behind "vk-demo" has a depleted credit balance
    And the provider returns its terminal "credit balance too low" 400
    When a real agent wrapper (claude -p, streaming) sends a request
    Then the wrapper receives the terminal error immediately
    And the wrapper does not enter a "Retrying attempt N/10" loop
    And the surfaced message is the provider's own credit-balance message
