Feature: Gateway service — public HTTP surface and operational basics
  The Go gateway service exposes OpenAI-compatible, Anthropic-compatible,
  and operational endpoints. This feature covers the plumbing: routing,
  request ids, logging, panic recovery, graceful shutdown.

  See contract.md §3.

  Background:
    Given the gateway is listening on :5590

  Rule: Every request gets a request id

    @unit
    Scenario: gateway generates request id when client omits it
      When I POST /v1/chat/completions with a valid VK and no X-LangWatch-Request-Id header
      Then the response has header "X-LangWatch-Request-Id" set to a value matching `^req_[0-9a-f]{30}$`

    @unit
    Scenario: gateway echoes client-supplied request id
      When I POST with "X-LangWatch-Request-Id: abc-correlated-123"
      Then the response echoes exactly "X-LangWatch-Request-Id: abc-correlated-123"
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
