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
