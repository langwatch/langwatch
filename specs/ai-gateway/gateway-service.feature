Feature: Gateway service — public HTTP surface and operational basics

  # All scenarios in this file describe the Go gateway service's HTTP
  # surface — content-type negotiation, request-id echoing, panic
  # recovery, graceful shutdown, structured logging, body size cap,
  # config validation, JWT secret rotation. Implemented entirely in
  # services/aigateway/, out of scope for the TS parity check.

  The Go gateway service exposes OpenAI-compatible, Anthropic-compatible,
  and operational endpoints. This feature covers the plumbing: routing,
  request ids, logging, panic recovery, graceful shutdown.

  See contract.md §3.

  Background:
    Given the gateway is listening on :5563

  Rule: Every request gets a request id

    @unit @unimplemented
    Scenario: gateway generates request id when client omits it
      When I POST /v1/chat/completions with a valid VK and no X-LangWatch-Gateway-Request-Id header
      Then the response has header "X-LangWatch-Gateway-Request-Id" set to a value matching `^req_[0-9a-f]{30}$`

    @unit @unimplemented
    Scenario: gateway echoes client-supplied request id
      When I POST with "X-LangWatch-Gateway-Request-Id: abc-correlated-123"
      Then the response echoes exactly "X-LangWatch-Gateway-Request-Id: abc-correlated-123"
      And the access log line carries the same id

  Rule: Public HTTP surface shape

    @integration @unimplemented
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

    @unit
    Scenario: /v1/models reflects effective VK allowlist
      Given the VK has model_aliases {"chat": "openai/gpt-5-mini"} and models_allowed ["gpt-5-mini"]
      When I GET /v1/models
      Then the response body includes {"id": "chat", "object": "model"}
      And includes {"id": "gpt-5-mini", "object": "model"}
      And every entry carries "created" and a non-empty "owned_by", as OpenAI clients type them

  Rule: Panics are caught and converted to 500 error envelopes

    @unit @unimplemented
    Scenario: a panic in a handler produces a JSON error, not a broken connection
      Given a test handler that panics with "divide by zero"
      When I GET the test route
      Then the response status is 500
      And the body parses as {"error": {"type": "internal_error", "code": "panic", ...}}
      And the panic is logged with stack trace

  Rule: Graceful shutdown drains in-flight requests

    @integration @unimplemented
    Scenario: SIGTERM waits up to 15s for in-flight requests
      Given the gateway is processing a slow streaming request that takes 10s
      When kubernetes sends SIGTERM
      Then /readyz immediately returns 503 (to drop from LB)
      And the in-flight stream completes normally
      And the process exits cleanly within 15s
      And new requests during the drain window are rejected with 503

  Rule: Structured JSON logs

    @unit @unimplemented
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

    @unit @unimplemented
    Scenario: missing GATEWAY_CONTROL_PLANE_SECRET fails fast in prod mode
      Given env GATEWAY_ALLOW_INSECURE is unset
      And env GATEWAY_CONTROL_PLANE_SECRET is unset
      When the gateway starts
      Then the process exits with code 2
      And stderr contains "GATEWAY_CONTROL_PLANE_SECRET is required"

    @unit @unimplemented
    Scenario: dev mode allows insecure startup for local dev
      Given env GATEWAY_ALLOW_INSECURE=1
      When the gateway starts
      Then it boots normally
      And a warning is logged

  Rule: Auth-cache stale-while-error knobs are configurable in plain seconds

    # SoftBump/HardGrace/ConfigTTL were time.Duration fields parsed from
    # strings like "5m"/"6h" — per review feedback on #5977, converted to
    # plain int64 seconds (LW_GATEWAY_AUTH_CACHE_*_SECONDS) to match this
    # service's existing GracefulSeconds/DrainDelaySeconds convention rather
    # than fixing the string-parsing path in place.
    # Bindings: services/aigateway/config_test.go

    @integration @regression
    Scenario: AuthCache seconds-suffixed env vars reach AuthCacheConfig
      Given LW_GATEWAY_AUTH_CACHE_SOFT_BUMP_SECONDS=300, _HARD_GRACE_SECONDS=21600, _CONFIG_TTL_SECONDS=90
      When the gateway loads its configuration
      Then AuthCache.SoftBumpSeconds is 300
      And AuthCache.HardGraceSeconds is 21600
      And AuthCache.ConfigTTLSeconds is 90

  Rule: Graceful shutdown window is actually configurable, and checked against the heartbeat interval and the longest legitimate stream

    # shutdown.preDrainWaitSeconds and shutdown.timeoutSeconds reach the
    # container as SERVER_DRAIN_DELAY_SECONDS / SERVER_GRACEFUL_SECONDS,
    # and serve.go passes both to pkg/lifecycle. Distinct from the "Graceful
    # SIGTERM drain (iter 24)" rule below, which describes a fuller 4-phase
    # mechanism this does not claim to fully verify.
    #
    # That the two values actually reach the rendered ConfigMap is verified
    # in .github/workflows/go-services.yaml's `helm` job, a rendered-template
    # grep assertion, the same pattern this file already uses for
    # NetworkPolicy. Not written as a Scenario here because the
    # feature-parity checker only scans Go/TS/Python/Bats test files, not CI
    # YAML steps: there would be no way to bind it, and @unimplemented would
    # falsely claim it isn't tested when it is, just not in a format the
    # checker recognizes.
    #
    # Two bounds are checked, because a request can be legitimately slow for
    # two unrelated reasons. The heartbeat interval is the chosen boundary
    # between a fast non-streaming response and a slow but legitimate one.
    # The upstream provider timeout is the only thing that bounds a stream at
    # all: the HTTP server sets ReadHeaderTimeout and neither a WriteTimeout
    # nor an IdleTimeout, so a stream can legitimately run for the full
    # 14 minutes, and a graceful window under that severs it on every rolling
    # deploy, node drain and scale-down.
    #
    # A warning marks a deployment that narrowed its graceful window, never
    # one that took the Go defaults, which clear both bounds by construction:
    # a warning every stock install emits is noise, not a signal. The gateway
    # chart is the deliberate exception. Its timeoutSeconds of 60 trips the
    # stream bound, which is the correct signal for a 75s pod grace period;
    # raising it is a pod sizing decision rather than a defaulting one.

    @unit @regression
    Scenario: stock defaults clear the graceful-vs-heartbeat check
      Given GracefulSeconds is left at the stock default
      And the effective non-streaming heartbeat interval is 45s (the stock default)
      When the gateway starts
      Then no graceful_shutdown_shorter_than_heartbeat_interval warning is emitted
      And no graceful_shutdown_shorter_than_max_stream_duration warning is emitted

    @unit @regression
    Scenario: a graceful window narrowed below the heartbeat interval warns
      Given GracefulSeconds is set to 10
      And the effective non-streaming heartbeat interval is 45s (the stock default)
      When the gateway starts
      Then a WARN log "graceful_shutdown_shorter_than_heartbeat_interval" is emitted
      And it reports the 10s graceful window and the 45s heartbeat interval

    @unit @regression
    Scenario: graceful window at or above the heartbeat interval does not warn
      Given GracefulSeconds is at least the effective heartbeat interval
      When the gateway starts
      Then no graceful_shutdown_shorter_than_heartbeat_interval warning is emitted

    @unit @regression
    Scenario: disabled heartbeating skips the check entirely
      Given the non-streaming heartbeat interval is negative (disabled)
      And GracefulSeconds is very small
      When the gateway starts
      Then no graceful_shutdown_shorter_than_heartbeat_interval warning is emitted

    @unit @regression
    Scenario: an explicit zero-or-negative graceful window skips the check
      Given GracefulSeconds is 0 or negative
      When the gateway starts
      Then no graceful_shutdown_shorter_than_heartbeat_interval warning is emitted

    @unit @regression
    Scenario: an unset heartbeat interval resolves to the default before comparing
      Given the non-streaming heartbeat interval is unset (zero)
      And GracefulSeconds is below the resolved default heartbeat interval
      When the gateway starts
      Then the warning compares against the resolved 45s default, not literal zero

    @unit @regression
    Scenario: a graceful window below the upstream stream ceiling warns
      Given GracefulSeconds is set to 60, which is above the 45s heartbeat interval
      When the gateway starts
      Then no graceful_shutdown_shorter_than_heartbeat_interval warning is emitted
      But a WARN log "graceful_shutdown_shorter_than_max_stream_duration" is emitted
      And it reports the 60s graceful window and the upstream stream ceiling

    @unit @regression
    Scenario: a graceful window at or above the upstream stream ceiling stays quiet
      Given GracefulSeconds equals the upstream provider request timeout
      When the gateway starts
      Then no graceful_shutdown_shorter_than_max_stream_duration warning is emitted
      And a window above that ceiling stays quiet too

    @unit @regression
    Scenario: disabled heartbeating still checks the stream ceiling
      Given the non-streaming heartbeat interval is negative (disabled)
      And GracefulSeconds is very small
      When the gateway starts
      Then no graceful_shutdown_shorter_than_heartbeat_interval warning is emitted
      But a graceful_shutdown_shorter_than_max_stream_duration warning is emitted

    @unit @regression
    Scenario: SERVER_DRAIN_DELAY_SECONDS reaches Server.DrainDelaySeconds
      Given env SERVER_DRAIN_DELAY_SECONDS=7
      When the gateway loads its configuration
      Then Server.DrainDelaySeconds is 7

    @unit @regression
    Scenario: the default graceful window outlasts the heartbeat interval
      Given no shutdown environment variables are set
      When the gateway loads its configuration
      Then Server.GracefulSeconds exceeds the 45s non-streaming heartbeat interval

  Rule: A request that finishes during shutdown still has its spend recorded

    # An operator sees this as money, not as ordering: a request billed on the
    # way out of a rolling deploy must still be charged. It is worth stating
    # because the failure is silent. Spool.Append counts and discards every
    # record handed to it after Close, so a spend pipeline torn down before
    # the listener has drained loses the spend of every request that finishes
    # during the drain. Such a request has already had its admitSpend shipped,
    # which leaves an admitted spend that is never confirmed.
    #
    # Two things produce the behavior: the listener is stopped before the
    # spend pipeline, and stopping the drainer waits for a drain already in
    # flight rather than only asking it to stop. Telemetry is torn down last,
    # so the shutdown itself is still traced.
    #
    # The unit bindings assert those mechanisms, since the ordering is what a
    # regression would change; the end-to-end behavior was verified against a
    # real gateway binary, where reverting the order alone lost a confirmSpend.
    # Bindings: services/aigateway/serve_test.go,
    # services/aigateway/adapters/spendemitter/drainer_lifecycle_test.go

    @unit @regression
    Scenario: the listener drains before the spend spool and drainer
      Given a gateway shutting down with spend recording configured
      When a request completes during the drain
      Then its spend is still recorded rather than dropped
      And the shutdown itself is still traced

    @unit @regression
    Scenario: an absent spend pipeline still leaves the listener draining first
      Given a gateway running with no spend recording configured
      When it shuts down
      Then in-flight requests are still drained before anything else stops

    @unit @regression
    Scenario: a drain already in flight finishes before the spool closes
      Given a spend drain is mid-flight when shutdown begins
      When the drainer is stopped
      Then the in-flight drain finishes before the spool it reads from closes
      And a shipper that ignores cancellation costs the shutdown budget rather than hanging shutdown

  Rule: Seconds-valued configuration is range-checked before it becomes a duration

    # Every seconds field is turned into a time.Duration by multiplying by a
    # billion, so a nanosecond count pasted into a seconds field wraps int64
    # into a negative duration, which consumers read as "disabled" or as an
    # instant timeout. A ten-year ceiling is orders of magnitude past any
    # legitimate setting and keeps the multiplication far from overflow.
    # Bindings: services/aigateway/config_test.go

    @unit @regression
    Scenario: an absurd seconds value is refused instead of overflowing a duration
      Given a seconds-valued env var is set to a nanosecond-scale number
      When the gateway loads its configuration
      Then it refuses to start and names the offending variable

    @unit @regression
    Scenario: a legitimate large seconds value is still accepted
      Given LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS is one year in seconds
      When the gateway loads its configuration
      Then AuthCache.HardGraceSeconds is 31536000

    @unit @regression
    Scenario: the largest in-range seconds value is accepted and the next one is not
      Given a seconds-valued env var is set to the largest supported value
      When the gateway loads its configuration
      Then it starts, and the value is still a positive time span
      But one second more is refused

    # A wait cannot be run backwards. Where other seconds fields read a
    # negative number as "disabled", the shutdown budget and the drain delay
    # are time the gateway spends waiting, so a negative there would answer
    # SIGTERM by dropping every in-flight request at once. Zero already says
    # "do not wait".
    @unit @regression
    Scenario: a negative shutdown budget is refused instead of draining nothing
      Given SERVER_GRACEFUL_SECONDS or SERVER_DRAIN_DELAY_SECONDS is negative
      When the gateway loads its configuration
      Then it refuses to start and names the offending variable

    @unit @regression
    Scenario: zero is accepted as an explicit no-wait
      Given SERVER_DRAIN_DELAY_SECONDS is 0
      When the gateway loads its configuration
      Then it starts with no drain delay at all

  Rule: The retired duration-string variables stop a boot rather than being ignored

    # Nothing reads LW_GATEWAY_AUTH_CACHE_SOFT_BUMP / _HARD_GRACE / _CONFIG_TTL
    # any more. A deployment that still carries one would boot on the default
    # instead, so an operator who had set the hard grace to hard-fail at JWT
    # exp would come back up serving stale bundles for six hours with nothing
    # to tell them their setting had stopped applying.
    # Bindings: services/aigateway/config_test.go

    @unit @regression
    Scenario: a retired duration-string variable stops startup and names its replacement
      Given LW_GATEWAY_AUTH_CACHE_HARD_GRACE is still set in the environment
      When the gateway loads its configuration
      Then it refuses to start
      And the error names LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS as the variable to use

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

  Rule: Compressed request bodies are decoded before anything reads them

    # Clients are free to compress what they upload, and coding agents do:
    # codex 0.145 posts /v1/responses under `Content-Encoding: zstd` once the
    # user is signed in with an OpenAI account. Every stage past the transport
    # (model peek, stream detection, guardrails, the provider adapters) reads
    # JSON, so the compressed bytes have to be decoded at the edge. Reading
    # them raw finds no top-level `model` and fails the turn with a 400 for a
    # missing model field before any provider is contacted.

    @integration
    Scenario Outline: a compressed body is decoded on every dispatch lane
      Given a valid VK
      When I POST <path> with a <encoding>-compressed JSON body and header "Content-Encoding: <encoding>"
      Then the gateway resolves the model from the decoded body
      And the provider receives the decoded JSON body
      And the response status is 200

      Examples:
        | path                  | encoding |
        | /v1/chat/completions  | gzip     |
        | /v1/chat/completions  | deflate  |
        | /v1/chat/completions  | br       |
        | /v1/chat/completions  | zstd     |
        | /v1/responses         | zstd     |
        | /v1/embeddings        | zstd     |

    @integration
    Scenario: the passthrough lane does not forward a stale Content-Encoding
      Given a valid VK
      When I POST /v1beta/models/gemini-2.5-flash:generateContent with a gzip-compressed body
      Then the provider receives the decoded JSON body
      And the forwarded upstream headers carry no "Content-Encoding"

    @integration
    Scenario: a content coding the gateway cannot decode is a bad request
      Given a valid VK
      When I POST /v1/chat/completions with header "Content-Encoding: snappy"
      Then the response status is 400
      And error.type equals "bad_request"
      And error.message references "unsupported content-encoding"

    @integration
    Scenario: a compression bomb is capped at the same ceiling as a raw body
      Given GATEWAY_MAX_REQUEST_BODY_BYTES = 65536
      When I POST /v1/chat/completions with a zstd body that fits the cap on the wire but decodes to 4 MiB
      Then the response status is 413
      And error.type equals "payload_too_large"
      And no provider dispatch occurs

    # The prefix-peek lanes hit the ceiling while filling the peek window rather
    # than on a full-body read, and the failure has to be answered there: peeking
    # at a truncated payload reports whatever the peek made of it instead of the
    # limit that was actually crossed.
    @integration
    Scenario: a compression bomb on the peek lane is capped too
      Given GATEWAY_MAX_REQUEST_BODY_BYTES = 8192
      When I POST /v1/embeddings with a zstd body that fits the cap on the wire but decodes to 1 MiB
      Then the response status is 413
      And error.type equals "payload_too_large"
      And no provider dispatch occurs

    # The peek lane hands the rest of the body to the pipeline as a reader, so a
    # ceiling above the peek window is crossed after the transport has already
    # let the request through. An unclassified failure at that depth answers
    # 500, hiding a limit the client could have acted on.
    @integration
    Scenario: a compression bomb caught after the peek is still a 413
      Given GATEWAY_MAX_REQUEST_BODY_BYTES = 65536
      When I POST /v1/embeddings with a zstd body that decodes to 4 MiB, past the 32 KiB peek window
      Then the response status is 413
      And error.type equals "payload_too_large"
      And no provider dispatch occurs

  Rule: A request with no model says where THAT surface expects one

    # This is the gateway's largest single source of 400s, and for five days it
    # was one virtual key posting bodies with no top-level `model` round the
    # clock, retrying against a rejection that read, in full, "missing model
    # field". That names no field, no body and no endpoint, so the operator on
    # the other end had nothing to correct and the loop never stopped. The
    # handled error therefore carries a stable `missing_model` code plus
    # the request surface in metadata; operators and clients need not infer
    # this high-volume rejection from prose. Resolution still runs before the
    # request is labeled with a model, so the request counter records
    # model="unknown".
    #
    # Model resolution is unconditional, so every surface reaches this
    # rejection - and the surfaces disagree about where a model comes from.
    # Three read a top-level JSON field, transcription reads a multipart form
    # part, and the Gemini passthrough reads the URL path. A single message
    # naming the JSON endpoints is not merely vague at the other four, it is
    # wrong: it sends a caller to fix a request shape they are not using.
    #
    # See dev/docs/adr/045-domain-errors-handled-boundary.md for the handled-
    # error contract this rule follows.
    #
    # Bindings: services/aigateway/adapters/modelresolver/resolver_test.go

    @unit
    Scenario: a request with no model is rejected with a message the client can act on
      Given a valid VK
      When a request arrives naming no model
      Then the rejection has handled error code "missing_model"
      And its metadata names the request surface
      And the rejection names the endpoint the caller actually used
      And it says where that endpoint takes its model from
      And it shows what a correct request looks like
      And it never names a request shape the caller is not using
      And the failure is attributed to the caller rather than to the platform

  Rule: Graceful SIGTERM drain (iter 24, `ea167ca`)

    # Four-phase shutdown guarantees in-flight requests complete before pod exit.
    # Preserves streaming connections (no mid-stream 5xx from drain).
    # Bindings: charts/gateway/tests/shutdown-values.sh, run by the `helm` job
    # in .github/workflows/go-services.yaml. The phase scenarios below describe
    # the running gateway's own drain behaviour and are not covered there.

    Scenario: SIGTERM phase 1 — readiness probe flips to 503 draining
      When the gateway receives SIGTERM
      Then within 100ms GET /readyz returns 503
      And the body JSON contains {"status": "draining"}
      And GET /healthz still returns 200 (liveness unchanged)
      And structured log "gateway_draining" is emitted with preDrainWaitSeconds duration

    Scenario: SIGTERM phase 2 — preDrainWaitSeconds lets load balancer propagate the 503
      Given Helm values.shutdown.preDrainWaitSeconds = 5
      When the gateway receives SIGTERM
      Then the gateway waits 5s for LB endpoint removal BEFORE stopping accept
      And new requests continue landing during preDrainWaitSeconds (LB still routes)
      And each new request is still served correctly (no rejection)

    Scenario: SIGTERM phase 3 — server.Shutdown(timeoutSeconds) drains in-flight handlers
      Given Helm values.shutdown.timeoutSeconds = 60
      When the gateway has 20 in-flight streaming requests at SIGTERM
      Then the server stops accepting new connections
      And in-flight requests complete naturally (up to 15s)
      And gauge gateway_in_flight_requests decrements as handlers finish
      And structured log "gateway_shutting_down" is emitted at shutdown start
      And structured log "gateway_stopped" is emitted when drain completes

    @unit @regression
    Scenario: preDrainWaitSeconds + timeoutSeconds MUST be within terminationGracePeriodSeconds
      Given Helm values.shutdown.preDrainWaitSeconds = 5 + timeoutSeconds = 60 + slack = 10
      Then terminationGracePeriodSeconds must be ≥ 75 (5+60+10)
      And chart helm-template validation asserts this invariant

    @unit @regression
    Scenario: the duration-string shutdown keys are refused by the chart
      Given a values file sets shutdown.preDrainWait or shutdown.timeout
      Then helm template fails and names the Seconds-suffixed key to use instead
      And no release installs with drain timing that silently ignores those values

    @unit @regression
    Scenario: the drain timing an operator sets is what the pod runs with
      Given a values file sets shutdown.preDrainWaitSeconds and shutdown.timeoutSeconds
      When the release is rendered
      Then the pod receives exactly those two numbers as its drain delay and shutdown budget
      And a release that took the defaults receives the defaults

    @unit @regression
    Scenario: a drain budget wider than the pod's grace period is refused
      Given a values file widens the drain past what terminationGracePeriodSeconds allows
      Then helm template fails and names the grace period the drain would need
      And raising terminationGracePeriodSeconds to that number renders

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

  Rule: One inbound body cap, stated once

    # The cap is named in the code every deployment falls back to, in the
    # Helm value the chart renders into the container, and in the operator
    # docs a pod gets sized from. Three sources, one number: when they
    # disagree an operator provisions for the cap the docs promise and the
    # gateway enforces a different one, and the only symptom is a 413 on a
    # payload the docs said would fit.

    @unit
    Scenario: the body cap is the same number in the code, the chart and the docs
      Given the gateway's default inbound body cap
      When the Helm chart's rendered value and the self-hosting docs are read
      Then all three state the same number of bytes
      And changing any one of them alone fails the build
