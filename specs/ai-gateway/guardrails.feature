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
      | stream_chunk  | profanity       | modify      |

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
