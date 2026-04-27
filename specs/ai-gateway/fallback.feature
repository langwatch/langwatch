Feature: Provider fallback chain
  When a primary provider fails for a reason that indicates "try again
  elsewhere" (5xx, timeout, 429, network), the gateway walks the VK's
  fallback chain. Client-fault errors (400/401/403/404) are returned as-is
  so the customer sees the real problem.

  See contract.md §7.

  Background:
    Given a VK with fallback config:
      """
      {
        "on": ["5xx", "timeout", "rate_limit_exceeded", "network_error"],
        "chain": ["pc_openai_primary", "pc_anthropic_secondary", "pc_gemini_tertiary"],
        "timeout_ms": 10000,
        "max_attempts": 3
      }
      """

  Rule: Fallback triggers on 5xx

    @integration
    Scenario: primary 503 triggers fallback to secondary
      Given "pc_openai_primary" returns 503 Service Unavailable
      And "pc_anthropic_secondary" returns 200 with a valid completion
      When I POST /v1/chat/completions
      Then the client receives 200 from anthropic
      And the response header "X-LangWatch-Provider: anthropic" is set
      And the response header "X-LangWatch-Fallback-Count: 1" is set
      And the OTel trace has two child spans tagged langwatch.fallback.attempt=0 and =1

    @integration
    Scenario: primary timeout triggers fallback
      Given "pc_openai_primary" exceeds timeout_ms
      And "pc_anthropic_secondary" returns 200
      When I POST /v1/chat/completions
      Then the client receives 200 from anthropic
      And the timeout_ms limit is enforced per attempt, not across attempts

    @integration
    Scenario: 429 from primary triggers fallback
      Given "pc_openai_primary" returns 429 with Retry-After: 60
      When I POST /v1/chat/completions
      Then the gateway falls back to secondary immediately (no honor of Retry-After before fallback)

  Rule: Fallback does NOT trigger on client-fault errors

    @integration
    Scenario: primary 400 returns as-is without fallback
      Given "pc_openai_primary" returns 400 with {"error": {"message": "invalid model parameter"}}
      When I POST /v1/chat/completions
      Then the client receives 400
      And "pc_anthropic_secondary" is NOT called
      And the error envelope type is "bad_request"
      And the response includes the upstream error message for debugging

    @integration
    Scenario: primary 401 (provider creds bad) returns as-is
      Given "pc_openai_primary" returns 401 from OpenAI (invalid provider API key)
      When I POST /v1/chat/completions
      Then the client receives 500 with error.type "internal_error"
      And the error.message hints at a provider credential issue (so the customer fixes their pc_*)
      And "pc_anthropic_secondary" is NOT called

    @integration
    Scenario: primary 404 (model unknown at provider) returns as-is
      When the request uses a model that does not exist at the primary provider
      Then fallback does NOT trigger
      And the error propagates so the user corrects their request

  Rule: All attempts exhausted returns the last error

    @integration
    Scenario: all providers 503 returns provider_error
      Given every provider in the chain returns 503
      When I POST /v1/chat/completions
      Then the client receives 502
      And the error envelope type is "provider_error"
      And X-LangWatch-Fallback-Count matches chain length (or max_attempts, whichever is smaller)

  Rule: Circuit breaker preempts hopeless attempts

    @integration
    Scenario: consecutive failures open the circuit for primary
      Given "pc_openai_primary" has returned 5xx for the last 10 requests in the last 30s
      When I POST /v1/chat/completions with {"model": "chat"}
      Then the gateway skips primary (circuit open) and dispatches directly to secondary
      And the circuit-open state is logged with span attribute langwatch.provider.circuit=open

    @integration
    Scenario: circuit half-opens after cool-down
      Given primary's circuit has been open for 60s
      When a new request is attempted
      Then the gateway makes ONE probe request to primary
      And on success, the circuit closes
      And on failure, the circuit stays open for another cool-down window

  Rule: Streaming respects the first-chunk-commit rule

    @integration
    Scenario: primary fails before first chunk, fallback is transparent
      Given the client sends stream=true
      And primary returns 503 before any SSE chunk
      When the gateway dispatches
      Then the gateway silently falls back to secondary
      And the client sees a clean SSE stream from secondary (no partial data from primary)
      And response headers indicate X-LangWatch-Provider: anthropic

    @integration
    Scenario: primary fails mid-stream, gateway terminates (no silent switch)
      Given the client sends stream=true
      And primary sent 3 SSE chunks then connection drops
      When the upstream error fires
      Then the gateway writes a terminal SSE event {"error": {"type": "provider_error"}}
      And closes the client connection
      And does NOT silently switch to secondary mid-stream (would produce a Frankenstein response)
      And the OTel trace records the partial completion for observability

  Rule: Fallback is not retry (avoid double-spend on non-idempotent calls)

    @integration
    Scenario: gateway does not retry a POST once headers were sent upstream
      Given primary's TCP connection dropped after headers were sent
      When the gateway detects the drop
      Then the gateway does NOT attempt the same request against primary
      And it may attempt fallback (new upstream) if fallback is armed
