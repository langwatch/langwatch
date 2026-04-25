Feature: Front-door reverse proxy — nlpgo routes /go/* itself, everything else to uvicorn
  As a developer or operator hitting any HTTP path on the langwatch_nlp container
  I want a single transparent entry on :5562 that hides the two-process layout
  So that callers only need to know one URL, with no awareness of which engine handles which path

  # _shared/contract.md §3. The front-door is a small, well-behaved chi handler:
  # - exact in-process routes for /go/*, /healthz, /readyz
  # - everything else: a httputil.ReverseProxy with no body buffering, streaming-safe,
  #   that forwards to the uvicorn child at 127.0.0.1:5561.
  # NLPGO_BYPASS=1 short-circuits this whole skill — it's handled by the container's
  # entry script before nlpgo would have started, see parallel-deployment.feature.

  Background:
    Given the container is up with nlpgo on :5562 and uvicorn on :5561

  # ============================================================================
  # In-process route table
  # ============================================================================

  @integration @v1
  Scenario Outline: /go/* and health routes are handled by nlpgo's in-process router
    When a request hits "<path>"
    Then nlpgo's in-process handler runs
    And no upstream HTTP call to :5561 is made for this request

    Examples:
      | path                            |
      | /go/studio/execute_sync         |
      | /go/studio/execute              |
      | /go/proxy/v1/chat/completions   |
      | /go/proxy/v1/embeddings         |
      | /go/proxy/v1/models             |
      | /healthz                        |
      | /readyz                         |

  @integration @v1
  Scenario: GET /readyz returns 503 until uvicorn child first reports healthy
    Given the container has just started
    When the uvicorn child has not yet returned 200 from its own /healthz
    Then GET /readyz on :5562 returns 503
    When the uvicorn child becomes healthy
    Then the next GET /readyz returns 200 within 1 second

  # ============================================================================
  # Reverse-proxy behavior for legacy paths
  # ============================================================================

  @integration @v1
  Scenario Outline: every path not in the in-process route table is reverse-proxied to uvicorn
    When a request hits "<path>" with method "<method>" and body "<body>"
    Then nlpgo forwards to "http://127.0.0.1:5561<path>" with the same method, headers, and body
    And the upstream response status, headers, and body are returned to the client unchanged

    Examples:
      | method | path                              | body         |
      | POST   | /studio/execute_sync              | {workflow}   |
      | POST   | /studio/execute                   | {workflow}   |
      | POST   | /proxy/v1/chat/completions        | {messages}   |
      | POST   | /topics/batch_clustering          | {traces}     |
      | POST   | /topics/incremental_clustering    | {traces}     |

  @integration @v1
  Scenario: query-string and trailing-slash paths are forwarded byte-equivalent
    When a GET request hits "/proxy/v1/models?provider=openai" (with query string)
    Then nlpgo reverse-proxies to "http://127.0.0.1:5561/proxy/v1/models?provider=openai"
    And the path-and-query land at uvicorn unchanged

  @integration @v1
  Scenario: streaming response bodies pass through with flush per chunk
    Given a uvicorn endpoint that emits one SSE "data:" line every 200ms for 5 seconds
    When the client GETs that endpoint via :5562 (proxy hop)
    Then each SSE chunk arrives at the client within 50ms of uvicorn writing it
    And nlpgo never accumulates the full body before flushing
    And the connection stays open until uvicorn closes it

  @integration @v1
  Scenario: large request bodies are streamed (not buffered) into uvicorn
    Given a POST /studio/execute_sync with a 10 MB body
    When the request flows through nlpgo's proxy
    Then nlpgo does not buffer the full body before forwarding
    And the proxy uses chunked transfer encoding when the client did

  @integration @v1
  Scenario: client cancellation propagates to uvicorn
    Given the client closes the connection while uvicorn is mid-response
    When nlpgo observes the client close
    Then nlpgo cancels the upstream request via context cancellation
    And uvicorn's logs show a client-disconnect for that request id
    And nlpgo emits a "proxy_cancel" log line tagged with that request id

  # ============================================================================
  # Auth boundary in the front door
  # ============================================================================

  @integration @v1
  Scenario: /go/* rejects unsigned requests at the front door — never reaches the upstream
    When a request hits "/go/studio/execute_sync" with no LW_NLPGO_INTERNAL_SECRET signature
    Then the front door returns 401 with body.type "auth_failed"
    And no proxy hop, no in-process handler is invoked beyond the auth middleware

  @integration @v1
  Scenario: legacy paths are NOT auth-checked by nlpgo (preserves today's behavior)
    When a request hits "/studio/execute_sync" with no signature
    Then the request is reverse-proxied to uvicorn unchanged
    And uvicorn handles the request as it does today

  # ============================================================================
  # Header hygiene
  # ============================================================================

  @integration @v1
  Scenario: hop-by-hop headers are stripped on both directions per RFC 7230
    When a request includes "Connection: keep-alive" or "Transfer-Encoding: chunked" headers
    Then those hop-by-hop headers do not appear in the request that reaches uvicorn
    And those hop-by-hop headers do not appear in the response that reaches the client

  @integration @v1
  Scenario: X-Forwarded-For is appended (not replaced) when forwarding to uvicorn
    Given the incoming request has "X-Forwarded-For: 1.2.3.4"
    And the connecting peer's IP is 5.6.7.8
    When nlpgo reverse-proxies to uvicorn
    Then uvicorn sees "X-Forwarded-For: 1.2.3.4, 5.6.7.8"

  @integration @v1
  Scenario: request id is preserved (or generated) and surfaces in both nlpgo and uvicorn logs
    Given a request with no "X-Request-Id" header
    When the request flows through nlpgo
    Then nlpgo generates a "X-Request-Id: req_<30hex>"
    And the proxied request to uvicorn carries that id
    And both nlpgo's and uvicorn's access logs contain the same request id

  # ============================================================================
  # Failure modes
  # ============================================================================

  @integration @v1
  Scenario: uvicorn child is unreachable — nlpgo returns 502 with a clear envelope
    Given the uvicorn child has been stopped (TCP refused on :5561)
    When a legacy-path request arrives
    Then nlpgo returns 502 with body.type "upstream_unreachable"
    And the response includes a "X-LangWatch-Upstream: uvicorn" header
    And nlpgo emits a structured log line at level "error"

  @integration @v1
  Scenario: uvicorn returns a 5xx — nlpgo forwards it without rewriting
    Given the uvicorn child returns 503 for a /studio/execute_sync request
    Then nlpgo returns 503 to the client with the same body
    And nlpgo does not retry the request (idempotent retries are the caller's responsibility)

  # ============================================================================
  # The "anything else" trap
  # ============================================================================

  @integration @v1
  Scenario: an arbitrary unknown path is reverse-proxied (no nlpgo hardcoding of legacy routes)
    When a request hits "/some/new/python-only/route" that doesn't exist in nlpgo's table
    Then nlpgo reverse-proxies it to "http://127.0.0.1:5561/some/new/python-only/route"
    And whatever uvicorn returns (including 404) is forwarded to the client
