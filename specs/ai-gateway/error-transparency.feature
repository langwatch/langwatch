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

  # A provider 2xx the engine cannot decode is still the provider's answer.
  # OpenAI's Responses image_generation_call item carries "action":"generate"
  # as a string, and the engine schema reads that field as an object. Treating
  # that decode failure as an engine error writes the complete, valid 200 body
  # under a 502 and records zero usage for a request the provider billed.
  @bdd @error-transparency @integration
  Scenario: A provider 200 the engine cannot decode is forwarded as a 200 with its usage
    Given the upstream provider responds 200 on /v1/responses with an image_generation_call output item
    And the engine fails to decode that body into its schema
    When the client calls the gateway with "vk-demo"
    Then the gateway responds with HTTP 200
    And the response body is the provider's body, unmodified
    And the request's usage is read from the provider's usage block, not zero
    And the gateway logs the decode failure at warn level

  # The handled-error marker proves a response body is LangWatch-authored, so
  # a forwarded provider response must never carry one — on the error path OR
  # the passthrough lane, which forwards upstream headers wholesale.
  @bdd @error-transparency @integration
  Scenario: A provider-set marker header cannot survive the passthrough lane
    Given the upstream provider answers a passthrough request with an error
    And the provider set the LangWatch handled-error marker on its response
    When the gateway forwards that response to the client
    Then the marker header is stripped
    And the provider's body and status are still forwarded verbatim

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
  # Engine-origin failures: a request that never reached a provider
  # ==========================================================================
  # The dispatch engine can fail before any provider is dialed — a credential
  # that mints no token, a key that declares no such model, a deployment map
  # that is missing, an operation the provider does not implement. These carry
  # no HTTP status because no HTTP call was made, and the gateway used to read
  # that absent status as a timeout: every one of them reached the client as a
  # retryable 504 "Gateway Timeout", was attributed to the provider, was
  # retried across the whole credential chain, and counted a circuit-breaker
  # failure against a slot that was perfectly healthy.
  #
  # Over one production week that mask covered 23 failures and not one of them
  # was a timeout. Two thirds completed in under 100ms. They were: "no keys
  # found that support model", "deployments not set", "chat_completion is not
  # supported by elevenlabs provider", and "failed to retrieve aws
  # credentials". All four are settings mistakes, terminal, and unfixable by
  # any retry.
  #
  # The engine states which kind of failure it had, and the gateway must read
  # it: whether the PROVIDER produced the error or the engine did, the error
  # type it stamped, and the wrapped cause underneath its category message.
  #
  # Bindings: services/aigateway/adapters/providers/bifrost_error_test.go,
  # services/aigateway/app/dispatch_test.go

  @bdd @error-transparency @unit
  Scenario Outline: An engine failure that never reached a provider is terminal, not a timeout
    Given the dispatch engine fails with "<failure>" before any provider is dialed
    When the client calls the gateway with "vk-demo"
    Then the error code is "<code>", never "provider_timeout"
    And the client receives a terminal 4xx, so no retry loop begins
    And the failure is attributed to the customer, whose settings fix it

    Examples:
      | failure                                            | code                        |
      | the credential mints no authentication token       | provider_credential_invalid |
      | no key on the slot declares the requested model    | provider_config_invalid     |
      | the provider slot has no deployment map            | provider_config_invalid     |
      | the provider does not implement the operation      | provider_config_invalid     |

  @bdd @error-transparency @unit
  Scenario: A genuine timeout is still called a timeout
    Given the engine stamps the failure with its request-timed-out signal
    When the client calls the gateway with "vk-demo"
    Then the error code is "provider_timeout"
    And the failure is attributed to the provider
    And the request is retried on the next credential

  @bdd @error-transparency @unit
  Scenario: A provider that was never reached is retryable, unlike a settings mistake
    Given the request fails in transport before the provider answers
    When the client calls the gateway with "vk-demo"
    Then the error code is "provider_connection_failed"
    And the request is retried on the next credential
    And the failure counts toward opening that credential's circuit breaker

  # An error the engine produced is not an answer any provider gave, so it must
  # not be dressed as one. The engine says which it is; forwarding its own
  # synthesised status as an upstream response would claim a provider answered
  # when none did.
  @bdd @error-transparency @unit
  Scenario: An engine-produced error is never forwarded as a provider answer
    Given the engine fails a request without any provider responding
    When the gateway classifies that failure
    Then the failure carries the gateway's own error code
    And it is not forwarded as an upstream provider response

  # The engine's own message is a category; the reason sits in the cause it
  # wrapped. "error creating auth token source" is the identical sentence for a
  # credential that is not JSON, one missing a "type" field, and an environment
  # with no default credentials — three problems with three different fixes.
  @bdd @error-transparency @unit
  Scenario: The engine's wrapped cause survives classification
    Given the engine reports a category message with a wrapped cause underneath
    When the gateway classifies that failure
    Then the cause travels with the error for the operator
    And the cause is never placed in the client-facing metadata
    And the customer reads what to change instead of what broke internally

  # A failure that arrives once the stream is open reaches the caller through a
  # different writer than the one every other failure uses, so "the customer
  # never reads the internal cause" has to be stated for both or it holds for
  # one. The streaming writer rendered the whole error object, metadata and
  # wrapped cause included.
  @bdd @error-transparency @integration
  Scenario: A handled failure states the same thing mid-stream as it does before the stream opens
    Given a failure the gateway can name, carrying an internal cause
    When it happens after the response stream has already opened
    Then the caller reads the same customer-facing sentence as on the non-streaming path
    And the error keeps the code that names the failure
    And neither the internal cause nor the diagnostic metadata appears in the stream

  @bdd @error-transparency @unit
  Scenario: A terminal setup failure does not spend the fallback chain
    Given "vk-demo" has two credentials in its fallback chain
    And the first credential cannot authenticate at all
    When the client calls the gateway with "vk-demo"
    Then no second credential is dialed, because the same failure would repeat
    And the credential's circuit breaker is not moved by the refusal

  @bdd @error-transparency @unit
  Scenario: The engine's own refusal to fall over is honored
    Given the dispatch engine marks a failure as one no other credential can improve
    When the client calls the gateway with "vk-demo"
    Then the chain stops at that credential
    And the client still receives the same error the engine produced

  # ==========================================================================
  # Remediation: a terminal failure says what to change
  # ==========================================================================
  # A gateway error is usually read by an agent or an SDK, not by a person
  # looking at our UI, and often by someone who cannot see our settings screens
  # at all. For the terminal failures — the ones no retry can clear — the
  # remediation IS the interface, and the copy has to name the artefact the
  # reader must go and change.
  #
  # "Check your credentials" means something different for every provider: a
  # service-account JSON document for Vertex, an access key and secret for
  # Bedrock, a key plus a resource endpoint for Azure. The Vertex report this
  # feature grew out of is the case in point — the reader, given nothing
  # specific, went looking at the region, which was correct all along.
  #
  # Bindings: services/aigateway/domain/remediation_test.go,
  # platform/app/src/features/errors/components/__tests__/HandledErrorAlert.integration.test.tsx

  @bdd @error-transparency @unit
  Scenario: A terminal provider failure tells the caller how to fix it
    Given a request fails because the provider's credentials cannot authenticate
    When the gateway answers the caller
    Then the answer carries remediation steps naming what that provider's credential is
    And it links the setup page for that provider, not a generic index
    And it says the failure will repeat until the credential is corrected
    And every page it links exists

  @bdd @error-transparency @unit
  Scenario: A provider-setup failure tells the customer how to fix it
    Given a provider-setup failure surfaces in the product
    When the customer reads the error
    Then it names which provider and which model, rather than "this provider"
    And it shows the remediation steps the gateway sent
    And it offers the provider's own documentation
    And it never tells them to retry a credential that cannot work

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
