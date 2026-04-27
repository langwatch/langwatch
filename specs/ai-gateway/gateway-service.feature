Feature: Gateway service — public HTTP surface and operational basics
  The Go gateway service exposes OpenAI-compatible, Anthropic-compatible,
  and operational endpoints. This feature covers the plumbing: routing,
  request ids, logging, panic recovery, graceful shutdown.

  See contract.md §3.

  Background:
    Given the gateway is listening on :5563

  Rule: Every request gets a request id

    @unit
    Scenario: gateway generates request id when client omits it
      When I POST /v1/chat/completions with a valid VK and no X-LangWatch-Gateway-Request-Id header
      Then the response has header "X-LangWatch-Gateway-Request-Id" set to a value matching `^req_[0-9a-f]{30}$`

    @unit
    Scenario: gateway echoes client-supplied request id
      When I POST with "X-LangWatch-Gateway-Request-Id: abc-correlated-123"
      Then the response echoes exactly "X-LangWatch-Gateway-Request-Id: abc-correlated-123"
      And the access log line carries the same id

  Rule: Public HTTP surface shape

    @integration
    Scenario Outline: public routes respond with the expected content-type
      When I <method> <path> with a valid VK
      Then the response content-type is <content_type>

      Examples:
        | method | path                         | content_type                   |
        | POST   | /v1/chat/completions         | application/json               |
        | POST   | /v1/chat/completions stream=true | text/event-stream          |
        | POST   | /v1/messages                 | application/json               |
        | POST   | /v1/messages stream=true     | text/event-stream              |
        | POST   | /v1/embeddings               | application/json               |
        | POST   | /v1/responses                | application/json               |
        | GET    | /v1/models                   | application/json               |
        | GET    | /healthz                     | application/json               |
        | GET    | /readyz                      | application/json               |
        | GET    | /startupz                    | application/json               |

    @integration
    Scenario: /v1/models reflects effective VK allowlist
      Given the VK has model_aliases {"chat": "openai/gpt-5-mini"} and models_allowed ["gpt-5-mini"]
      When I GET /v1/models
      Then the response body includes {"id": "chat", "object": "model"}
      And includes {"id": "gpt-5-mini", "object": "model"}

  Rule: Panics are caught and converted to 500 error envelopes

    @unit
    Scenario: a panic in a handler produces a JSON error, not a broken connection
      Given a test handler that panics with "divide by zero"
      When I GET the test route
      Then the response status is 500
      And the body parses as {"error": {"type": "internal_error", "code": "panic", ...}}
      And the panic is logged with stack trace

  Rule: Graceful shutdown drains in-flight requests

    @integration
    Scenario: SIGTERM waits up to 15s for in-flight requests
      Given the gateway is processing a slow streaming request that takes 10s
      When kubernetes sends SIGTERM
      Then /readyz immediately returns 503 (to drop from LB)
      And the in-flight stream completes normally
      And the process exits cleanly within 15s
      And new requests during the drain window are rejected with 503

  Rule: Structured JSON logs

    @unit
    Scenario: every request produces one access log line with the core fields
      When I POST /v1/chat/completions
      Then stdout contains one JSON log line with fields:
        | method      | "POST"                  |
        | path        | "/v1/chat/completions"  |
        | status      | (integer)               |
        | duration_ms | (integer)               |
        | request_id  | (string)                |
        | remote      | (string)                |

  Rule: Configuration is validated on startup

    @unit
    Scenario: missing GATEWAY_CONTROL_PLANE_SECRET fails fast in prod mode
      Given env GATEWAY_ALLOW_INSECURE is unset
      And env GATEWAY_CONTROL_PLANE_SECRET is unset
      When the gateway starts
      Then the process exits with code 2
      And stderr contains "GATEWAY_CONTROL_PLANE_SECRET is required"

    @unit
    Scenario: dev mode allows insecure startup for local dev
      Given env GATEWAY_ALLOW_INSECURE=1
      When the gateway starts
      Then it boots normally
      And a warning is logged

  Rule: Request body size cap (iter 23, `79b46bf`)

    # The gateway enforces a per-request body size limit BEFORE auth / dispatch
    # so a drive-by scan of large bodies can't pressure pod memory or auth cache.
    # Default 10 MiB via GATEWAY_MAX_REQUEST_BODY_BYTES; configurable per deployment.

    Scenario: declared Content-Length above the cap returns 413 without draining the socket
      Given GATEWAY_MAX_REQUEST_BODY_BYTES = 10485760 (10 MiB)
      When a POST /v1/chat/completions arrives with Content-Length: 12000000
      Then the response status is 413
      And error.type equals "payload_too_large"
      And error.code equals "payload_too_large"
      And error.message references "exceeds the configured maximum"
      And the socket is closed within 100ms (body NOT drained off the wire)
      And auth middleware did NOT execute

    Scenario: chunked body that overruns the cap trips http.MaxBytesError
      Given GATEWAY_MAX_REQUEST_BODY_BYTES = 10485760
      When a POST /v1/chat/completions arrives with Transfer-Encoding: chunked, total body 12 MiB
      Then at the 10 MiB+1 byte read the middleware returns *http.MaxBytesError
      And the response status is 413 payload_too_large
      And no bifrost dispatch occurs

    Scenario: body under cap gets a clean 401 on unauth (auth runs AFTER body-size check)
      Given GATEWAY_MAX_REQUEST_BODY_BYTES = 10485760
      When a POST /v1/chat/completions arrives with a 1 MiB body and NO Authorization header
      Then the response status is 401
      And error.type equals "invalid_api_key"
      And the body-size cap did NOT fire

    Scenario: cap is tunable via Helm values.security.maxRequestBodyBytes
      Given Helm values.security.maxRequestBodyBytes = 52428800 (50 MiB)
      When the gateway pod starts
      Then GATEWAY_MAX_REQUEST_BODY_BYTES resolves to 52428800
      And 30 MiB requests succeed (below new cap)
      And 60 MiB requests still return 413

  Rule: Graceful SIGTERM drain (iter 24, `ea167ca`)

    # Four-phase shutdown guarantees in-flight requests complete before pod exit.
    # Preserves streaming connections (no mid-stream 5xx from drain).

    Scenario: SIGTERM phase 1 — readiness probe flips to 503 draining
      When the gateway receives SIGTERM
      Then within 100ms GET /readyz returns 503
      And the body JSON contains {"status": "draining"}
      And GET /healthz still returns 200 (liveness unchanged)
      And structured log "gateway_draining" is emitted with preDrainWait duration

    Scenario: SIGTERM phase 2 — preDrainWait lets load balancer propagate the 503
      Given Helm values.shutdown.preDrainWait = 5s
      When the gateway receives SIGTERM
      Then the gateway waits 5s for LB endpoint removal BEFORE stopping accept
      And new requests continue landing during preDrainWait (LB still routes)
      And each new request is still served correctly (no rejection)

    Scenario: SIGTERM phase 3 — server.Shutdown(timeout) drains in-flight handlers
      Given Helm values.shutdown.timeout = 15s
      When the gateway has 20 in-flight streaming requests at SIGTERM
      Then the server stops accepting new connections
      And in-flight requests complete naturally (up to 15s)
      And gauge gateway_in_flight_requests decrements as handlers finish
      And structured log "gateway_shutting_down" is emitted at shutdown start
      And structured log "gateway_stopped" is emitted when drain completes

    Scenario: preDrainWait + timeout MUST be within terminationGracePeriodSeconds
      Given Helm values.shutdown.preDrainWait = 5s + timeout = 15s + slack = 10s
      Then terminationGracePeriodSeconds must be ≥ 30s (5+15+10)
      And chart helm-template validation asserts this invariant

    Scenario: stuck handler beyond timeout is force-killed
      Given a handler that blocks past the shutdown timeout
      When SIGTERM drain reaches the timeout
      Then the handler is terminated
      And the response to that client is an SSE error frame (streaming) or 503 (non-streaming)
      And the pod exits with code 0 (clean shutdown reported)

  Rule: JWT secret rotation (iter 25, `921365f`)

    # Dual-key verification window for zero-downtime rotation of LW_GATEWAY_JWT_SECRET.

    Scenario: both current and previous JWT secret verify bundles during rotation window
      Given env LW_GATEWAY_JWT_SECRET = "new-key"
      And env LW_GATEWAY_JWT_SECRET_PREVIOUS = "old-key"
      When a bundle arrives signed with "old-key"
      Then it verifies successfully (previous-key path)
      When a bundle arrives signed with "new-key"
      Then it verifies successfully (current-key path)
      When a bundle arrives signed with "random-other-key"
      Then verification fails with 401

    Scenario: boot emits a WARN log when rotation window is active
      Given env LW_GATEWAY_JWT_SECRET_PREVIOUS is set
      When the gateway starts
      Then structured log level=WARN msg="jwt_secret_rotation_active" is emitted
      And the log includes guidance to remove _PREVIOUS after the rotation window

    Scenario: steady state — no _PREVIOUS means strict single-key verification
      Given env LW_GATEWAY_JWT_SECRET_PREVIOUS is unset
      When a bundle arrives signed with the current secret
      Then it verifies successfully
      When a bundle arrives signed with any other key
      Then verification fails with 401
      And no WARN log is emitted

    Scenario: INTERNAL_SECRET follows the same dual-key pattern
      Given env LW_GATEWAY_INTERNAL_SECRET_PREVIOUS is set
      When a gateway→app internal call's HMAC signature verifies against either key
      Then the request proceeds
      Pair with LW_GATEWAY_JWT_SECRET_PREVIOUS rotate in a single operation for contract consistency

  Rule: Effective-config structured log on boot (iter 27, `d70adf6`)

    # One structured log line on every boot containing the full effective config.
    # Secrets pass through redact() helper emitting "set(len=N)" not the value.

    Scenario: boot emits gateway_effective_config with every struct present
      When the gateway starts
      Then exactly one structured log line with msg="gateway_effective_config" is emitted
      And the line contains every Config struct: ControlPlane, Cache, Budget, Guardrails, OTel, Bifrost, Startup, Security, Shutdown, Admin
      And every field's resolved value is included (default OR override)

    Scenario: secrets are redacted as "set(len=N)" not the raw value
      Given env LW_GATEWAY_INTERNAL_SECRET = "mysecretvalue1234567890"
      When the gateway emits gateway_effective_config
      Then the line contains ControlPlane.internalSecret = "set(len=23)"
      And the literal value "mysecretvalue1234567890" is NOT present in the log

    Scenario: unset secrets are redacted as "unset"
      Given env LW_GATEWAY_JWT_SECRET_PREVIOUS is unset
      When the gateway emits gateway_effective_config
      Then the line contains the field as "unset"

    Scenario: operators grep gateway_effective_config to debug env-override bugs
      Given an operator sets LW_GATEWAY_BUDGET_DEBIT_RETRY_MAX = 12 via Helm
      When kubectl logs | grep gateway_effective_config | jq .
      Then the operator sees Budget.debitRetryMax = 12 in the parsed output
      And can immediately verify the value matches what was set in values.yaml
      And if the value is still the default, the operator knows the env var didn't propagate to this container

  Rule: X-LangWatch-Gateway-Version response header (iter 27)

    Scenario: every response carries the gateway version for "which deploy returned this?" attribution
      When any request flows through the gateway (success or error)
      Then response header "X-Langwatch-Gateway-Version" is set to the gateway version string
      And the header is present on 200, 401, 403, 429, 413, 500, 503 — every path
      And operators can cross-ref customer-reported issues to specific gateway builds
