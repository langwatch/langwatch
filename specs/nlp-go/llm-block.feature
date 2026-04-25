Feature: LLM block — Studio signature node executes via the Go AI Gateway
  As a workflow author whose project is on the Go NLP engine
  I want every signature (LLM) node to call the LangWatch AI Gateway with my own provider credentials
  So that LiteLLM and DSPy disappear from the path while my workflow keeps producing the same outputs

  # The signature node is the most critical block. It owes byte-equivalent behavior
  # to the Python+DSPy+LiteLLM stack across six provider families, structured outputs,
  # tool calls, streaming, and the full chat-history preservation contract from
  # _shared/contract.md §10. Credentials are inline (per-request) — the gateway has
  # no per-customer credential store for studio runs; it accepts the inline-creds
  # header path described in _shared/contract.md §8.

  Background:
    Given the nlpgo service is running on port 5562 with NLPGO_BYPASS unset
    And the AI Gateway is running on port 5563 with LW_GATEWAY_INTERNAL_SECRET set
    And nlpgo is configured with the same LW_GATEWAY_INTERNAL_SECRET so it can sign gateway calls
    And a project "acme-api" exists with no VirtualKey configured

  # ============================================================================
  # OpenAI — the simplest path; baseline shape for all subsequent providers
  # ============================================================================

  @integration @v1
  Scenario: signature node with OpenAI litellm_params runs end-to-end via the gateway
    Given a workflow whose signature node has model "openai/gpt-5-mini" and litellm_params:
      | api_key | sk-test-... |
    When the TS app POSTs to "/go/studio/execute_sync" with that workflow signed by LW_NLPGO_INTERNAL_SECRET
    Then nlpgo translates the litellm_params into an inline-credentials header
    And nlpgo forwards a "/v1/chat/completions" call to the gateway with:
      | header                              | value                            |
      | X-LangWatch-Internal-Auth           | hmac-sha256 over canonical req   |
      | X-LangWatch-Inline-Credentials      | base64-json with provider+key    |
      | X-LangWatch-Project-Id              | acme-api                         |
    And the gateway dispatches to OpenAI with the inline api_key
    And the response status is 200
    And the workflow result contains the assistant message in chat_messages shape
    And the gateway emits a span with attribute "langwatch.project_id" = "acme-api"

  @integration @v1
  Scenario: signature node propagates the LangWatch trace id through to the gateway span
    Given a workflow whose signature node has model "openai/gpt-5-mini" and a litellm_params api_key
    And the TS app sends header "X-LangWatch-Trace-Id" = "trc_abc123"
    When the workflow runs through nlpgo
    Then nlpgo forwards "X-LangWatch-Trace-Id: trc_abc123" to the gateway
    And the gateway span trace_id is "trc_abc123"
    And the per-node span emitted by nlpgo is a child of trace "trc_abc123"

  # ============================================================================
  # Anthropic — model id normalization (dot→dash) and temperature clamp
  # ============================================================================

  @integration @v1
  Scenario: anthropic model id with dotted version segment is normalized to dashes
    Given a workflow whose signature node has model "anthropic/claude-opus-4.5"
    When nlpgo translates the request before calling the gateway
    Then the model id sent to the gateway is "anthropic/claude-opus-4-5"

  @integration @v1
  Scenario: anthropic alias expansion matches the TS modelIdBoundary mapping exactly
    Given a workflow whose signature node has model "anthropic/claude-sonnet-4"
    When nlpgo translates the request
    Then the model id sent to the gateway is "anthropic/claude-sonnet-4-20250514"

  @integration @v1
  Scenario: anthropic temperature greater than 1.0 is clamped to 1.0 before the gateway sees it
    Given a workflow whose signature node has model "anthropic/claude-sonnet-4-20250514" and temperature 1.5
    When nlpgo executes the node
    Then the gateway receives temperature 1.0 in the body
    And the response is 200

  # ============================================================================
  # Reasoning models — temperature pinned to 1.0, max_tokens floor at 16000
  # ============================================================================

  @integration @v1
  Scenario Outline: reasoning model overrides force temperature 1.0 and max_tokens floor
    Given a workflow whose signature node has model "<model>" with temperature 0.2 and max_tokens 1000
    When nlpgo translates the request
    Then the gateway receives temperature 1.0 in the body
    And the gateway receives max_tokens 16000 or higher

    Examples:
      | model              |
      | openai/o1-mini     |
      | openai/o3          |
      | openai/o4-preview  |
      | openai/gpt-5-mini  |

  @integration @v1
  Scenario: reasoning fields are normalized to a single canonical key before the gateway call
    Given a workflow whose signature node has any of: "reasoning", "reasoning_effort", "thinkingLevel", "effort" set to "medium"
    When nlpgo translates the request
    Then the gateway receives exactly one of those keys, with value "medium"
    And nlpgo does not duplicate the value across multiple keys

  # ============================================================================
  # Azure OpenAI — deployment name, api_version, extra_headers, optional Azure gateway proxy
  # ============================================================================

  @integration @v1
  Scenario: Azure deployment routes via api_base + api_version with deployment name from model id
    Given a workflow whose signature node has model "azure/my-gpt5-prod" and litellm_params:
      | api_key       | <key>                           |
      | api_base      | https://acme.openai.azure.com   |
      | api_version   | 2024-05-01-preview              |
    When nlpgo executes the node
    Then nlpgo's inline-credentials header carries azure.api_key, azure.api_base, azure.api_version
    And the gateway dispatches to Azure with deployment "my-gpt5-prod"
    And the response is 200

  @integration @v1
  Scenario: Azure missing api_version falls back to default 2024-05-01-preview
    Given a workflow whose signature node has model "azure/my-deployment" and litellm_params with no api_version
    When nlpgo executes the node
    Then nlpgo injects api_version "2024-05-01-preview" before signing the gateway call

  @integration @v1
  Scenario: Azure extra_headers JSON string is forwarded as a parsed object
    Given a workflow whose signature node has Azure litellm_params with extra_headers = '{"X-Internal-Tag":"acme"}'
    When nlpgo executes the node
    Then the gateway-bound request body includes header "X-Internal-Tag" with value "acme"

  @integration @v1
  Scenario: Azure with use_azure_gateway = "true" routes via the Azure API Gateway base url
    Given a workflow whose signature node has Azure litellm_params with use_azure_gateway = "true"
    And the gateway is configured with an AZURE_API_GATEWAY_BASE_URL
    When nlpgo executes the node
    Then the gateway dispatches via the AZURE_API_GATEWAY_BASE_URL
    And the response is 200

  # ============================================================================
  # AWS Bedrock — STS chain (managed) + plain access keys (BYO)
  # ============================================================================

  @integration @v1
  Scenario: Bedrock with raw IAM credentials calls the gateway with bedrock.* fields
    Given a workflow with signature node model "bedrock/anthropic.claude-3-sonnet-20240229-v1:0" and litellm_params:
      | aws_access_key_id     | AKIA...           |
      | aws_secret_access_key | <secret>          |
      | aws_region_name       | us-east-1         |
    When nlpgo executes the node
    Then the gateway-bound inline-credentials carries bedrock.aws_access_key_id, bedrock.aws_secret_access_key, bedrock.aws_region_name
    And the gateway dispatches to Bedrock in us-east-1
    And the response is 200

  @integration @v1
  Scenario: Bedrock with STS session token propagates aws_session_token and runtime endpoint
    Given a workflow with Bedrock litellm_params containing aws_session_token and aws_bedrock_runtime_endpoint (managed STS chain)
    When nlpgo executes the node
    Then the gateway-bound inline-credentials carries both fields verbatim
    And the gateway uses the runtime endpoint provided

  # ============================================================================
  # Vertex AI — inline JSON service-account key, project + location
  # ============================================================================

  @integration @v1
  Scenario: Vertex with inline service-account JSON dispatches via vertex_ai/<model>
    Given a workflow whose signature node has model "vertex_ai/gemini-2.0-flash" and litellm_params:
      | vertex_credentials | {"type":"service_account",...}  |
      | vertex_project     | acme-vertex                      |
      | vertex_location    | us-central1                      |
    And no api_key is set on the litellm_params (Vertex uses SA, not api_key)
    When nlpgo executes the node
    Then the gateway-bound inline-credentials carries vertex_ai.vertex_credentials, vertex_ai.vertex_project, vertex_ai.vertex_location
    And the gateway dispatches via Vertex with the SA
    And the response is 200

  # ============================================================================
  # Gemini AI Studio (separate from Vertex)
  # ============================================================================

  @integration @v1
  Scenario: Gemini AI Studio uses a plain api_key
    Given a workflow with signature node model "gemini/gemini-2.0-flash" and litellm_params api_key
    When nlpgo executes the node
    Then the gateway-bound inline-credentials carries gemini.api_key
    And the response is 200

  # ============================================================================
  # Custom OpenAI-compatible providers (Mistral, Together, Groq, etc.)
  # ============================================================================

  @integration @v1
  Scenario: custom provider with custom_base_url forwards as openai-compatible at the gateway boundary
    Given a workflow with signature node model "custom/my-model" and litellm_params:
      | api_key  | <key>                           |
      | api_base | https://api.together.xyz/v1     |
    When nlpgo executes the node
    Then nlpgo translates the model id to "openai/my-model" at the gateway boundary
    And the gateway-bound inline-credentials carries custom.api_key and custom.api_base
    And the gateway dispatches to https://api.together.xyz/v1
    And the response is 200

  # ============================================================================
  # Tool calls + structured outputs preserved across the engine
  # ============================================================================

  @integration @v1
  Scenario: tool_call arguments round-trip as canonical JSON without byte drift
    Given a workflow whose signature node has tools defined and the LLM responds with a tool_call
    When nlpgo serializes the assistant message back into the workflow chat_messages
    Then the tool_call arguments string is canonical-JSON encoded (sorted keys, no extra whitespace)
    And downstream nodes receive the exact same string

  @integration @v1
  Scenario: structured-output workflow returns a parseable JSON matching the response_format
    Given a workflow whose signature node sets response_format = {"type":"json_schema", "json_schema": {...}}
    When the LLM responds
    Then the assistant message content parses as JSON
    And the JSON validates against the declared json_schema

  # ============================================================================
  # Multi-turn chat history preserved across signature nodes
  # ============================================================================

  @integration @v1
  Scenario: chat_messages history is preserved across two consecutive signature nodes
    Given a workflow with two signature nodes in series, both consuming and producing chat_messages
    And the input is a 4-message history including a tool_call/tool_result pair
    When the workflow runs
    Then the second signature node's prompt contains all 4 prior messages plus the first node's assistant turn
    And tool_calls in the history are forwarded role-correct (tool messages keep tool_call_id)

  # ============================================================================
  # Streaming — SSE pass-through
  # ============================================================================

  @integration @v1
  Scenario: streaming /go/studio/execute forwards SSE deltas from the gateway in real time
    Given a workflow with one signature node configured for streaming
    When the TS app GETs "/go/studio/execute" expecting text/event-stream
    Then nlpgo emits "execution_state_change" events for each gateway delta
    And the gateway-bound /v1/chat/completions request has stream=true
    And nlpgo sends a final "done" event with the complete result
    And there is at least one "is_alive" heartbeat if the stream takes longer than NLP_STREAM_HEARTBEAT_SECONDS

  # ============================================================================
  # Errors & cancellation
  # ============================================================================

  @integration @v1
  Scenario: gateway returning 401 surfaces a clean error event in the studio stream
    Given a workflow signature node whose litellm_params api_key is intentionally wrong
    When the workflow runs through nlpgo
    Then the gateway returns 401
    And nlpgo emits an "error" event with message containing "authentication failed" and the gateway request id
    And nlpgo does NOT include the api_key value in any log line

  @integration @v1
  Scenario: client closing the SSE connection cancels the in-flight gateway request
    Given a workflow streaming a long signature node
    When the client closes the connection mid-stream
    Then nlpgo cancels the gateway request via context cancellation
    And the gateway sees an upstream client_disconnect within 1 second
    And no further node executions are scheduled

  @integration @v1
  Scenario: workflow with an unsupported node kind (agent/evaluator/retriever/custom) returns 501
    Given a workflow that contains a node of kind "evaluator"
    When the TS app POSTs to "/go/studio/execute_sync"
    Then nlpgo returns status 501 with body.type "unsupported_node_kind"
    And the TS app fall-back logic re-routes the workflow to the legacy Python path

  # ============================================================================
  # Cost attribution
  # ============================================================================

  @integration @v1
  Scenario: gateway cost attribution lands on the correct project for studio runs
    Given a workflow run for project "acme-api" on the Go path
    When the run completes
    Then the LangWatch trace at /api/trace/<trace_id> has metrics.total_cost > 0
    And the trace's project_id is "acme-api"
    And the per-node cost is reported in the workflow result

  # ============================================================================
  # Negative auth — nlpgo MUST reject unsigned /go/* calls
  # ============================================================================

  @integration @v1
  Scenario: /go/studio/execute_sync without a valid LW_NLPGO_INTERNAL_SECRET signature returns 401
    When a request hits "/go/studio/execute_sync" with a wrong signature
    Then the response status is 401
    And the response body.type is "auth_failed"
    And no gateway call is made
