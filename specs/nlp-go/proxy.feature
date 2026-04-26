Feature: Proxy passthrough — playground LLM calls via /go/proxy/v1/*
  As a developer using the Prompt Playground in the LangWatch UI
  I want my OpenAI-shaped requests to traverse the Go path when my project is flagged in
  So that I get the new gateway-backed cost tracking without any change in request/response shape

  # _shared/contract.md §1 + §11 + §8: the playground hits /proxy/v1/* today on uvicorn.
  # When the project is on the Go engine, the TS app prepends /go/ and forwards the
  # request to nlpgo, which carries the x-litellm-* credential headers through to the
  # in-process gateway dispatcher. nlpgo translates the headers into a domain.Credential
  # and forwards verbatim — preserving every byte of the OpenAI shape including
  # streaming SSE, tool calls, image content, and the function-calling Beta variants.

  Background:
    Given nlpgo is running with the in-process AI Gateway dispatcher loaded
    And a project "acme-api" exists

  # ============================================================================
  # Path shape and method coverage
  # ============================================================================

  @integration @v1
  Scenario Outline: every OpenAI-style /v1/* method is reachable under /go/proxy/v1/*
    When the TS app forwards a "<method>" request to "/go/proxy/v1<subpath>"
    Then nlpgo dispatches a corresponding gateway call to "<gateway_path>"
    And the response status is 200
    And the response body shape matches OpenAI's spec for "<subpath>"

    Examples:
      | method | subpath               | gateway_path             |
      | POST   | /chat/completions     | /v1/chat/completions     |
      | POST   | /messages             | /v1/messages             |
      | POST   | /responses            | /v1/responses            |
      | POST   | /embeddings           | /v1/embeddings           |
      | GET    | /models               | /v1/models               |

  # ============================================================================
  # x-litellm-* header → inline credentials translation
  # ============================================================================

  @integration @v1
  Scenario: x-litellm-api_key is mapped into inline credentials before the gateway call
    Given the TS app sends "x-litellm-api_key: sk-test-..." with the playground request
    When nlpgo forwards the request to the gateway
    Then nlpgo strips every "x-litellm-*" header from the outbound request
    And nlpgo adds a "X-LangWatch-Inline-Credentials" header carrying the api_key in JSON
    And the gateway-bound HMAC signature includes the inline-credentials header bytes

  @integration @v1
  Scenario Outline: x-litellm-<provider_field> headers map into the right inline-credentials slot
    Given the TS app sends "<header_in>" with the playground request
    When nlpgo forwards the request
    Then the inline-credentials JSON has "<json_path>" set to the same value

    Examples:
      | header_in                          | json_path                              |
      | x-litellm-api_base                 | openai.api_base                        |
      | x-litellm-organization             | openai.organization                    |
      | x-litellm-aws_access_key_id        | bedrock.aws_access_key_id              |
      | x-litellm-aws_secret_access_key    | bedrock.aws_secret_access_key          |
      | x-litellm-aws_session_token        | bedrock.aws_session_token              |
      | x-litellm-aws_region_name          | bedrock.aws_region_name                |
      | x-litellm-vertex_credentials       | vertex_ai.vertex_credentials           |
      | x-litellm-vertex_project           | vertex_ai.vertex_project               |
      | x-litellm-vertex_location          | vertex_ai.vertex_location              |
      | x-litellm-api_version              | azure.api_version                      |

  # ============================================================================
  # Streaming pass-through
  # ============================================================================

  @integration @v1
  Scenario: SSE streaming from /go/proxy/v1/chat/completions forwards deltas without buffering
    Given the playground request has body { "stream": true, ... }
    When nlpgo forwards the request to the gateway
    Then nlpgo proxies the response with no transfer-encoding rewrites
    And each SSE "data:" chunk arrives at the client within 100ms of the gateway emitting it
    And the final "data: [DONE]" sentinel is forwarded verbatim
    And nlpgo does NOT enable any compression or response buffering on this path

  # ============================================================================
  # Bytes-equivalent passthrough — the playground UI relies on exact OpenAI shape
  # ============================================================================

  @integration @v1
  Scenario: response body is byte-equivalent to the gateway's response (no rewrite)
    Given a non-streaming chat_completions request via /go/proxy/v1/chat/completions
    When the gateway returns a JSON body
    Then nlpgo returns the same bytes to the client (modulo Content-Length recalculation)
    And the "id", "created", "model", "choices", "usage" fields are present and unmodified
    And nlpgo does NOT inject extra fields into the body

  @integration @v1
  Scenario: tool_call arguments arrive at the playground as a raw JSON string
    Given a non-streaming chat_completions response with a tool_call
    When nlpgo proxies the response back
    Then choices[0].message.tool_calls[0].function.arguments is a string (not a parsed object)
    And the string contents are the canonical JSON the gateway emitted

  # ============================================================================
  # Auth + bypass behavior
  # ============================================================================

  @integration @v1
  Scenario: /go/proxy/v1/* without provider headers returns a typed 400 before any dispatch
    When a request to "/go/proxy/v1/chat/completions" arrives with no x-litellm-* credential headers and no provider prefix in body.model
    Then the response status is 400
    And no gateway call is made

  @integration @v1
  Scenario: /go/proxy/v1/* requests under NLPGO_BYPASS=1 never reach the Go binary
    Given the container is started with NLPGO_BYPASS=1
    When a request to "/go/proxy/v1/chat/completions" arrives
    Then nlpgo is not in the path; the entry script forwards directly to uvicorn :5561
    And the legacy /proxy/v1/chat/completions handler responds (path rewrite handled by entry script)

  # ============================================================================
  # Errors
  # ============================================================================

  @integration @v1
  Scenario: gateway 4xx errors are forwarded with envelope intact
    Given the gateway returns a 400 with envelope { "type": "model_invalid", "message": "..." }
    When nlpgo proxies the error back
    Then the client receives status 400
    And the body is the same envelope verbatim
    And nlpgo emits an access-log line tagged status=400

  @integration @v1
  Scenario: gateway timeout surfaces as 504 with a clear envelope, no half-written stream
    Given the gateway never responds within the proxy timeout
    When the client request times out
    Then nlpgo returns 504 with body.type "upstream_timeout"
    And no partial bytes have been written to the response body
