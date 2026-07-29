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
  # Mid-stream provider error EVENTS survive with their payload
  # ==========================================================================
  # An upstream can fail AFTER the stream is 200-established by emitting an
  # in-stream error event (OpenAI Responses: `event: error` with
  # `data: {"type":"error","error":{"type","code","message","param"}}`).
  # The message lives inside that nested `error` OBJECT. A bug surfaced where
  # the streaming pipeline read only the legacy flat fields (`message`,
  # `code`, `param`) off the event, so a mid-stream quota error reached the
  # client as `data: {"error":"stream error: "}`, an empty message in a
  # shape no OpenAI SDK recognises, crashing the client with a parse error
  # instead of showing the provider's actionable message.

  @bdd @error-transparency @integration
  Scenario: Mid-stream Responses error event is forwarded with its nested payload
    Given the upstream provider opens a 200 SSE stream on the Responses surface
    And mid-stream it emits an error event whose message sits in the nested error object
    When the client reads the gateway stream with "vk-demo"
    Then the client receives a terminal `event: error`
    And the data payload preserves the upstream error object verbatim (type, code, message)
    And the provider's own message is present, not an empty string
    And the payload is a JSON error object, never a bare string under an "error" key

  @bdd @error-transparency @integration
  Scenario: Gateway-origin stream failures use the standard error-event object
    Given the upstream connection drops mid-stream with no provider error body
    When the client reads the gateway stream with "vk-demo"
    Then the client receives a terminal `event: error`
    And the data payload has the shape {"type":"error","error":{"type":"provider_error","message":...}}
    And the message states the failure, never an empty string

  # ==========================================================================
  # Error identity beyond the body: type/code, provider, and the taxonomy
  # ==========================================================================
  # A provider verdict is identified by three things: the HTTP status class,
  # the provider's own error type/code (insufficient_quota vs
  # rate_limit_exceeded, overloaded_error, ThrottlingException, ...), and
  # which upstream produced it. All three must survive the gateway, on every
  # lane, whether or not the native body was captured. An incident surfaced
  # where OpenAI's 429 insufficient_quota reached clients as HTTP 500
  # {"error":{"type":"internal_error"}}, the least actionable answer
  # possible, at the exact moment clients most needed the provider's own
  # verdict.

  @bdd @error-transparency @integration
  Scenario Outline: Provider error taxonomy keeps status and identity through the gateway
    Given the upstream provider answers <status> with error type "<type>"
    When the client calls the gateway with "vk-demo"
    Then the gateway responds with HTTP <status>
    And the response error type is "<type>"
    And the response never carries the gateway's "internal_error"

    Examples:
      | status | type                 |
      | 429    | insufficient_quota   |
      | 429    | rate_limit_exceeded  |
      | 401    | invalid_api_key      |
      | 404    | model_not_found      |
      | 400    | invalid_request_error|
      | 500    | server_error         |
      | 529    | overloaded_error     |

  @bdd @error-transparency @integration
  Scenario: Upstream error responses name the provider that produced them
    Given a credential chain that can span multiple providers
    When an upstream error surfaces to the client
    Then the response carries an X-LangWatch-Provider header naming the upstream
    So that an admin can tell which provider account to look at without reading gateway source

  # ==========================================================================
  # Fallback semantics: provider failures fail over, gateway refusals do not
  # ==========================================================================
  # Failing over past a dead credential is the whole point of a fallback
  # chain. A bug surfaced where raw-forward lanes returned provider errors as
  # success-shaped responses, so a 429/5xx never advanced the chain (and fed
  # the circuit breaker a success for a failing key).

  @bdd @error-transparency @integration
  Scenario: Provider quota, rate-limit, and 5xx answers fail over to the next credential
    Given "vk-demo" has two credentials in its fallback chain
    And the first credential's provider answers 429 insufficient_quota
    When the client calls the gateway with "vk-demo"
    Then the request is retried on the second credential
    And the client receives the second credential's successful response

  @bdd @error-transparency @integration
  Scenario: An exhausted fallback chain surfaces the last provider's error
    Given "vk-demo" has two credentials and both providers answer 429
    When the client calls the gateway with "vk-demo"
    Then the gateway responds with the LAST provider's 429, body verbatim
    And never with a generic internal or chain-exhausted placeholder

  @bdd @error-transparency @integration
  Scenario: Terminal provider 4xx answers do not fail over
    Given "vk-demo" has two credentials in its fallback chain
    And the first credential's provider answers a terminal 400 invalid_request_error
    When the client calls the gateway with "vk-demo"
    Then no second credential is dialed
    And the 400 reaches the client verbatim

  @bdd @error-transparency @integration
  Scenario: The gateway's own refusals never trigger provider fallback
    Given "vk-demo" is over its gateway budget
    When the client calls the gateway with "vk-demo"
    Then the gateway answers 402 budget_exceeded without dialing any provider
    And no fallback attempt is recorded

  # ==========================================================================
  # Circuit breaker: never an internal_error, never opened by answered 4xx
  # ==========================================================================

  @bdd @error-transparency @integration
  Scenario: Provider 4xx answers do not open the circuit breaker
    Given the provider answers every request with 429 insufficient_quota
    When many requests flow through the same credential
    Then every response relays the provider's 429 verbatim
    And the circuit breaker stays closed, because an answered 4xx proves the slot alive

  @bdd @error-transparency @integration
  Scenario: Provider 5xx answers count toward opening the circuit breaker
    Given the provider answers every request with 5xx errors
    When failures repeat on the same credential
    Then later requests are answered 503 with error code "circuit_open" instead of waiting on the failing provider
    And after the cooldown the gateway dials the provider again and recovers on its own

  @bdd @error-transparency @integration
  Scenario: A caller-abandoned request neither falls back nor moves the breaker
    Given a request is in flight to a provider credential
    When the caller disconnects or its deadline expires before the provider answers
    Then the gateway dials no further credential for that request
    And later requests on that credential are answered exactly as if the abandoned request had never happened

  @bdd @error-transparency @integration
  Scenario: An open circuit breaker surfaces circuit_open, not internal_error
    Given repeated provider 5xx failures opened the credential's circuit breaker
    When the client calls the gateway with "vk-demo"
    Then the gateway responds 503 with error code "circuit_open" and fault "provider"
    And never 500 "internal_error"

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
