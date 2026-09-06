Feature: Provider fallback chain

  # All scenarios in this file describe the gateway data-plane fallback
  # engine (5xx/timeout/429/network triggers, circuit breakers, mid-
  # stream fallback). Implemented in Go (services/aigateway/), out of
  # scope for the TS parity check — verified via Go unit + integration
  # tests in services/aigateway/.

  When a primary provider fails for a reason that indicates "try again
  elsewhere" (5xx, timeout, 429, network, and 404 because in a multi-provider
  chain it usually means this provider does not serve that model), the gateway
  walks the VK's fallback chain, as far as the key's attempt budget allows: a
  key with no chain gets one attempt and the error reaches the caller.
  Terminal errors (400/401/403) are returned as-is so the real problem is
  visible. Terminal is not the same as the caller's fault: a 401 or 403 is
  usually the operator's provider credential, and switching credentials would
  hide the thing they have to fix.

  See contract.md §7.

  Background:
    Given a VK with fallback config:
      """
      {
        "chain": ["pc_openai_primary", "pc_anthropic_secondary", "pc_gemini_tertiary"],
        "max_attempts": 3
      }
      """

  Rule: Fallback triggers on 5xx

    @integration @unimplemented
    Scenario: primary 503 triggers fallback to secondary
      Given "pc_openai_primary" returns 503 Service Unavailable
      And "pc_anthropic_secondary" returns 200 with a valid completion
      When I POST /v1/chat/completions
      Then the client receives 200 from anthropic
      And the response header "X-LangWatch-Provider: anthropic" is set
      And the response header "X-LangWatch-Fallback-Count: 1" is set
      And the OTel trace has two child spans tagged langwatch.fallback.attempt=0 and =1

    @integration @unimplemented
    Scenario: primary timeout triggers fallback
      Given "pc_openai_primary" never answers and its attempt times out
      And the caller is still connected, so there is budget for another attempt
      And "pc_anthropic_secondary" returns 200
      When I POST /v1/chat/completions
      Then the client receives 200 from anthropic
      And a caller who has already given up gets no further attempt

    @integration @unimplemented
    Scenario: 429 from primary triggers fallback
      Given "pc_openai_primary" returns 429 with Retry-After: 60
      When I POST /v1/chat/completions
      Then the gateway falls back to secondary immediately (no honor of Retry-After before fallback)

  Rule: Fallback does NOT trigger on a terminal upstream error

    @integration @unimplemented
    Scenario: primary 400 returns as-is without fallback
      Given "pc_openai_primary" returns 400 with {"error": {"message": "invalid model parameter"}}
      When I POST /v1/chat/completions
      Then the client receives 400
      And "pc_anthropic_secondary" is NOT called
      And the error envelope type is "bad_request"
      And the response includes the upstream error message for debugging

    @integration @unimplemented
    Scenario: primary 401 (provider creds bad) returns as-is
      Given "pc_openai_primary" returns 401 from OpenAI (invalid provider API key)
      When I POST /v1/chat/completions
      Then the client receives 500 with error.type "internal_error"
      And the error.message hints at a provider credential issue (so the customer fixes their pc_*)
      And "pc_anthropic_secondary" is NOT called

    @integration @unimplemented
    Scenario: primary 403 (provider refuses the account) returns as-is
      Given "pc_openai_primary" returns 403 from OpenAI
      When I POST /v1/chat/completions
      Then fallback does NOT trigger
      And the error propagates so the customer fixes the account it names

  Rule: Which failures walk the chain is not per-key configuration

    The chain is walked on the real upstream outcome, decided in one place
    from the response itself. There is no per-key trigger list: a list could
    only ever narrow the set, and every narrowing turns a failure the gateway
    could have recovered from into one the customer sees.

    A deploy rolls one side at a time, so for a while the two sides disagree
    about what the fallback block contains. Neither may refuse the other, in
    either direction, or a routine deploy takes traffic down.

    @unit
    Scenario: A key keeps serving while a deploy is half done
      Given the control plane and the gateway are mid-deploy on different versions
      When a request arrives for a key whose policy allows three attempts
      Then the request is served
      And the key gets the three attempts its operator configured
      And this holds whichever of the two sides is the newer one

  Rule: All attempts exhausted returns the last error

    @integration @unimplemented
    Scenario: all providers 503 returns provider_error
      Given every provider in the chain returns 503
      When I POST /v1/chat/completions
      Then the client receives 502
      And the error envelope type is "provider_error"
      And X-LangWatch-Fallback-Count matches chain length (or max_attempts, whichever is smaller)

  Rule: Circuit breaker preempts hopeless attempts

    @integration @unimplemented
    Scenario: consecutive failures open the circuit for primary
      Given "pc_openai_primary" has returned 5xx for the last 10 requests in the last 30s
      When I POST /v1/chat/completions with {"model": "chat"}
      Then the gateway skips primary (circuit open) and dispatches directly to secondary
      And the circuit-open state is logged with span attribute langwatch.provider.circuit=open

    @integration @unimplemented
    Scenario: circuit half-opens after cool-down
      Given primary's circuit has been open for 60s
      When a new request is attempted
      Then the gateway makes ONE probe request to primary
      And on success, the circuit closes
      And on failure, the circuit stays open for another cool-down window

  Rule: Streaming respects the first-chunk-commit rule

    @integration @unimplemented
    Scenario: primary fails before first chunk, fallback is transparent
      Given the client sends stream=true
      And primary returns 503 before any SSE chunk
      When the gateway dispatches
      Then the gateway silently falls back to secondary
      And the client sees a clean SSE stream from secondary (no partial data from primary)
      And response headers indicate X-LangWatch-Provider: anthropic

    @integration @unimplemented
    Scenario: primary fails mid-stream, gateway terminates (no silent switch)
      Given the client sends stream=true
      And primary sent 3 SSE chunks then connection drops
      When the upstream error fires
      Then the gateway writes a terminal SSE event {"error": {"type": "provider_error"}}
      And closes the client connection
      And does NOT silently switch to secondary mid-stream (would produce a Frankenstein response)
      And the OTel trace records the partial completion for observability

  Rule: Fallback is not retry (avoid double-spend on non-idempotent calls)

    @integration @unimplemented
    Scenario: gateway does not retry a POST once headers were sent upstream
      Given primary's TCP connection dropped after headers were sent
      When the gateway detects the drop
      Then the gateway does NOT attempt the same request against primary
      And it may attempt fallback (new upstream) if fallback is armed

  Rule: Failing over is a choice the key makes, not a default it inherits

    Fallback sends a request, and its payload, to a different vendor than the
    one the caller asked for. That is a decision worth stating: a key now
    carries its routing behaviour explicitly, and a new key does not fail
    over unless somebody says it should. Keys created before the choice
    existed are pinned to the old behaviour, so nothing changes underneath a
    customer who never made the choice.

    @integration
    Scenario: A key with no fallback attempts one provider and stops
      Given a key whose routing behaviour is "no fallback"
      When its configuration reaches the gateway
      Then the gateway is allowed a single dispatch attempt

    @integration
    Scenario: A key with no fallback surfaces the provider's failure
      Given a key whose routing behaviour is "no fallback"
      And the provider serving the requested model is down
      When a request arrives
      Then the caller gets the provider's failure, promptly and in full
      And no other provider is contacted
      # Promptly matters: the failure mode this file exists to prevent is a
      # request that hangs instead of failing.

    @integration
    Scenario: A key set to fall back still walks every eligible provider
      Given a key whose routing behaviour is "fall back to every provider"
      And the first provider in the chain is down
      When a request arrives
      Then the next eligible provider serves it

    @integration
    Scenario: Keys that predate the choice keep falling back
      Given a key created before routing behaviour was explicit
      When its configuration is read
      Then it falls back across every provider it can reach
