Feature: Guardrails wrap every gateway dispatch
  The gateway calls LangWatch's guardrail service before dispatch (`request`),
  after response (`response`), and optionally per-chunk on streams
  (`stream_chunk`). Verdicts are allow | block | modify. A blocked request
  never reaches the provider (no cost, no log).

  See contract.md §4.6, §7b.

  Background:
    Given a VK with:
      | direction     | guardrail       | on_block    |
      | request       | pii-detector    | block       |
      | response      | hallucination   | flag (warn) |
      | stream_chunk  | profanity       | block       |

  Rule: Request-direction guardrails run pre-dispatch

    @integration
    Scenario: request with PII is blocked before reaching the provider
      When I POST /v1/chat/completions with a message containing "SSN: 123-45-6789"
      Then the gateway calls POST /internal/gateway/guardrail/check with direction=request
      And the verdict is "block" with policies_triggered: ["pii-ssn"]
      And the response status is 403
      And the error envelope type is "guardrail_blocked"
      And the upstream provider is NOT called
      And budget-debit is called with status="blocked_by_guardrail" and actual_cost_usd=0

    @integration
    Scenario: request with modify verdict redacts content before dispatch
      Given the guardrail returns verdict=modify with a redacted message
      When I POST /v1/chat/completions with "email is foo@bar.com"
      Then the gateway forwards the modified content ("email is [REDACTED]") to the provider
      And the response span records `langwatch.guardrail.applied=["pii-email"]`

  Rule: Response-direction guardrails can block or flag

    @integration
    Scenario: response with hallucination flag records attribute but does not alter body
      Given the guardrail returns verdict=allow with policies_triggered: ["hallucination"]
      When the provider returns a completion
      Then the client receives the completion unchanged
      And the OTel trace has `langwatch.guardrail.post_flag=["hallucination"]`

    @integration
    Scenario: response-direction block replaces body with a safe error envelope
      Given the post-guardrail returns verdict=block for the response
      When the upstream returns a completion
      Then the client receives 403 with error.type "guardrail_blocked"
      And the completion was NOT forwarded to the client
      And the budget-debit captures input tokens (provider cost) but nobody saw the output
      And a zero-cost `blocked_by_guardrail` debit is recorded so dashboards still count the attempt

    @integration
    Scenario: response-direction modify rewrites the assistant text in place
      Given the post-guardrail returns verdict=modify for the response
      When the upstream returns a completion
      Then the first choice.message.content (or first text block on /v1/messages) is replaced with the rewritten text
      And the redaction is transparent to the client (no error, no warning header)
      And the OTel trace has `langwatch.guardrail.post.verdict=modify`

    @integration
    Scenario: content-block responses skip post-evaluation
      Given the upstream returns a tool_calls response (no text)
      When the post-guardrail would otherwise run
      Then the guardrail is NOT invoked on the tool_calls payload
      And the OTel trace has `langwatch.guardrail.post.skipped=no_text`
      # Deny / modify decisions on structured output go through `pre` or a
      # dedicated content-aware guardrail; post-response only evaluates text.

    @integration
    Scenario: post-guardrail fires on /v1/chat/completions AND /v1/messages
      When the post-guardrail returns block on either endpoint
      Then the client receives 403 guardrail_blocked on both surfaces
      And the dispatcher path is identical — no per-endpoint divergence

  Rule: Response-direction fail-open opt-in

    @integration
    Scenario: response-guardrail upstream 503 -> fail-closed by default
      Given POST /internal/gateway/guardrail/check returns 503 on the post-direction run
      When the upstream has already returned a completion
      Then the gateway returns 503 with error.type "guardrail_upstream_unavailable"
      And the client NEVER sees the ungoverned completion text

    @integration
    Scenario: response-direction fail-open via VK opt-in
      Given the VK has `guardrails.response_fail_open: true`
      When the post-guardrail upstream returns 503
      Then the gateway passes the upstream completion through unmodified
      And a warn log is emitted with the VK id and guardrail id
      And the OTel trace has `langwatch.guardrail.fail_open=true`

  Rule: Guardrail latency budget is enforced

    @integration
    Scenario: pre-guardrail exceeding 800ms times out and the request fails closed
      Given the request-direction guardrail is slower than 800ms
      When a request arrives
      Then the gateway returns 503 with error.type "service_unavailable"
      And the log records `langwatch.guardrail.timeout=pre`
      And the request does NOT silently bypass the guardrail (fail-closed)

  Rule: Multiple guardrails run in parallel

    @integration
    Scenario: 3 request-direction guardrails run concurrently; fastest block wins
      Given three guardrails attached (pii, toxicity, promptinjection)
      When a request arrives
      Then all three are called in parallel
      And the first to return `block` short-circuits the rest
      And the other in-flight guardrail calls are cancelled (ctx cancel)

  Rule: Guardrail results appear in gateway logs and Observability

    @integration
    Scenario: guardrail verdicts ship with the trace
      When a request is blocked by a guardrail
      Then the OTel trace has spans for each guardrail call
      And span attributes include `langwatch.guardrail.id`, `langwatch.guardrail.verdict`, `langwatch.guardrail.duration_ms`, `langwatch.guardrail.policies_triggered`
      And the LangWatch trace UI renders the full verdict chain

  Rule: If guardrail service is entirely offline

    @integration
    Scenario: guardrail upstream 503 -> fail-closed by default
      Given POST /internal/gateway/guardrail/check returns 503
      When a request with a required guardrail arrives
      Then the gateway returns 503 with error.type "service_unavailable"
      And the message mentions "guardrail service unreachable"
      And the request does NOT reach the upstream provider

    @integration
    Scenario: fail-open override per VK for non-sensitive tenants
      Given the VK has `guardrail_fail_open: true` flag set
      When guardrail upstream returns 503
      Then the gateway dispatches anyway
      And a warning span attribute `langwatch.guardrail.fail_open=true` is set
      And the trace clearly shows the guardrail was skipped

  Rule: stream_chunk guardrails terminate (not modify) on block in v1

    @integration
    Scenario: only chunks with visible delta text invoke the guardrail
      Given a VK with a stream_chunk guardrail attached
      When the upstream emits a role-only frame, a tool-call delta, and a terminal usage frame
      Then none of these frames invoke the guardrail service
      And the OTel trace records `langwatch.guardrail.stream_chunk.skipped=no_text`
      # ~95% of stream frames carry no visible delta; skipping them keeps stream
      # latency at near-zero overhead.

    @integration
    Scenario: visible delta text triggers the stream_chunk guardrail with a 50ms budget
      Given a VK with a stream_chunk guardrail attached
      When the upstream emits a visible assistant text delta
      Then the guardrail is called with that chunk's text
      And the call is bounded to 50ms per chunk

    @integration
    Scenario: stream_chunk block emits the byte-locked guardrail terminator
      Given the stream_chunk guardrail returns verdict=block with reason "pii_detected"
      When a visible delta chunk is being emitted
      Then the gateway writes exactly:
        """
        event: error
        data: {"error":{"type":"guardrail_blocked","code":"stream_chunk_blocked","message":"pii_detected","param":null}}

        """
      And the stream channel is closed
      And subsequent upstream chunks are discarded
      And `gateway_guardrail_verdicts_total{direction=stream_chunk,verdict=block}` increments

    @integration
    Scenario: stream_chunk timeout falls open (does NOT block the user's stream)
      Given the stream_chunk guardrail exceeds the 50ms budget
      When a visible delta chunk is being emitted
      Then the chunk is emitted to the client unchanged
      And the trace records `langwatch.guardrail.stream_chunk_fail_open=timeout`
      And `gateway_guardrail_verdicts_total{direction=stream_chunk,verdict=fail_open}` increments
      # Failing the user's stream on a slow policy service is worse than
      # occasional pass-through — but the metric surfaces degraded services.

    @integration
    Scenario: stream_chunk upstream error falls open (same policy as timeout)
      Given POST /internal/gateway/guardrail/check returns 500 during a chunk check
      When a visible delta chunk is being emitted
      Then the chunk is emitted to the client unchanged
      And the trace records `langwatch.guardrail.stream_chunk_fail_open=upstream_error`

    @integration
    Scenario: stream_chunk modify verdict is treated as block in v1
      Given the stream_chunk guardrail returns verdict=modify with edited_text
      When a visible delta chunk is being emitted
      Then the gateway emits the terminal guardrail_blocked error frame
      And the edited_text is NOT written to the stream
      # Provider-shape-specific chunk rewriting is deferred to a future iter.
      # "redact on stream" in v1 = block + client-retry.
