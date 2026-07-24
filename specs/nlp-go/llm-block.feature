Feature: LLM block — Studio signature node executes via the Go AI Gateway
  As a workflow author whose project is on the Go NLP engine
  I want every signature (LLM) node to call the LangWatch AI Gateway with my own provider credentials
  So that LiteLLM and DSPy disappear from the path while my workflow keeps producing the same outputs

  # The signature node is the most critical block. It owes byte-equivalent behavior
  # to the Python+DSPy+LiteLLM stack across six provider families, structured outputs,
  # tool calls, streaming, and the full chat-history preservation contract from
  # _shared/contract.md §10. Credentials are inline (per-request) — nlpgo imports the
  # AI Gateway as a Go library and dispatches with a `domain.Credential` value built
  # from the workflow's `litellm_params`. There is no second HTTP hop and no HMAC.
  # See _shared/contract.md §4 (no application-layer auth) and §8 (library, not HTTP).

  # All scenarios are @unimplemented because services/nlpgo/ does not yet exist.
  # The TS feature-parity checker only scans TS test roots, so Go-side signature
  # node scenarios cannot be bound via @scenario JSDoc. Python-side parity:
  # langwatch_nlp/langwatch_nlp/studio/execute/signature_node.py + dspy adapters.
  # Go-side test coverage will live under services/nlpgo/. Aspirational pending
  # nlpgo service stand-up.

  Background:
    Given the nlpgo service is running on its configured port
    And nlpgo imports the AI Gateway dispatcher in-process (no second HTTP hop)
    And a project "acme-api" exists with no VirtualKey configured

  # ============================================================================
  # OpenAI — the simplest path; baseline shape for all subsequent providers
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: signature node with OpenAI litellm_params runs end-to-end via the gateway
    Given a workflow whose signature node has model "openai/gpt-5-mini" and litellm_params:
      | api_key | sk-test-... |
    When the TS app POSTs to "/go/studio/execute_sync" with that workflow
    Then nlpgo translates the litellm_params into a domain.Credential value
    And nlpgo invokes dispatcher.DispatchStream / Dispatch in-process with:
      | field           | value                                |
      | Type            | domain.RequestTypeChat               |
      | Credential      | { ProviderID: "openai", ApiKey:... } |
      | Body            | OpenAI-shape /v1/chat/completions    |
    And the gateway dispatches to OpenAI with the inline api_key
    And the response status is 200
    And the workflow result contains the assistant message in chat_messages shape
    And the gateway emits a span with attribute "langwatch.project_id" = "acme-api"

  @integration @v1 @unimplemented
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

  @integration @v1 @unimplemented
  Scenario: anthropic model id with dotted version segment is normalized to dashes
    Given a workflow whose signature node has model "anthropic/claude-opus-4.5"
    When nlpgo translates the request before calling the gateway
    Then the model id sent to the gateway is "anthropic/claude-opus-4-5"

  @integration @v1 @unimplemented
  Scenario: anthropic alias expansion matches the TS modelIdBoundary mapping exactly
    Given a workflow whose signature node has model "anthropic/claude-sonnet-4"
    When nlpgo translates the request
    Then the model id sent to the gateway is "anthropic/claude-sonnet-4-20250514"

  @integration @v1 @unimplemented
  Scenario: anthropic temperature greater than 1.0 is clamped to 1.0 before the gateway sees it
    Given a workflow whose signature node has model "anthropic/claude-sonnet-4-20250514" and temperature 1.5
    When nlpgo executes the node
    Then the gateway receives temperature 1.0 in the body
    And the response is 200

  # ============================================================================
  # Reasoning models — temperature pinned to 1.0, max_tokens floor at 16000
  # ============================================================================

  @integration @v1 @unimplemented
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

  @integration @v1 @unimplemented
  Scenario: reasoning fields are normalized to a single canonical key before the gateway call
    Given a workflow whose signature node has any of: "reasoning", "reasoning_effort", "thinkingLevel", "effort" set to "medium"
    When nlpgo translates the request
    Then the gateway receives exactly one of those keys, with value "medium"
    And nlpgo does not duplicate the value across multiple keys

  # ============================================================================
  # Azure OpenAI — deployment name, api_version, extra_headers, optional Azure gateway proxy
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: Azure deployment routes via api_base + api_version with deployment name from model id
    Given a workflow whose signature node has model "azure/my-gpt5-prod" and litellm_params:
      | api_key       | <key>                           |
      | api_base      | https://acme.openai.azure.com   |
      | api_version   | 2024-05-01-preview              |
    When nlpgo executes the node
    Then nlpgo's domain.Credential carries azure.api_key, azure.api_base, azure.api_version
    And the gateway dispatches to Azure with deployment "my-gpt5-prod"
    And the response is 200

  @integration @v1 @unimplemented
  Scenario: Azure missing api_version falls back to default 2024-05-01-preview
    Given a workflow whose signature node has model "azure/my-deployment" and litellm_params with no api_version
    When nlpgo executes the node
    Then nlpgo injects api_version "2024-05-01-preview" into the Credential before dispatch

  @integration @v1 @unimplemented
  Scenario: Azure extra_headers JSON string is forwarded as a parsed object
    Given a workflow whose signature node has Azure litellm_params with extra_headers = '{"X-Internal-Tag":"acme"}'
    When nlpgo executes the node
    Then the gateway-bound request body includes header "X-Internal-Tag" with value "acme"

  @integration @v1 @unimplemented
  Scenario: Azure with use_azure_gateway = "true" routes via the Azure API Gateway base url
    Given a workflow whose signature node has Azure litellm_params with use_azure_gateway = "true"
    And the gateway is configured with an AZURE_API_GATEWAY_BASE_URL
    When nlpgo executes the node
    Then the gateway dispatches via the AZURE_API_GATEWAY_BASE_URL
    And the response is 200

  # ============================================================================
  # AWS Bedrock — STS chain (managed) + plain access keys (BYO)
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: Bedrock with raw IAM credentials calls the gateway with bedrock.* fields
    Given a workflow with signature node model "bedrock/anthropic.claude-3-sonnet-20240229-v1:0" and litellm_params:
      | aws_access_key_id     | AKIA...           |
      | aws_secret_access_key | <secret>          |
      | aws_region_name       | us-east-1         |
    When nlpgo executes the node
    Then the gateway-bound inline-credentials carries bedrock.aws_access_key_id, bedrock.aws_secret_access_key, bedrock.aws_region_name
    And the gateway dispatches to Bedrock in us-east-1
    And the response is 200

  @integration @v1 @unimplemented
  Scenario: Bedrock with STS session token propagates aws_session_token and runtime endpoint
    Given a workflow with Bedrock litellm_params containing aws_session_token and aws_bedrock_runtime_endpoint (managed STS chain)
    When nlpgo executes the node
    Then the gateway-bound inline-credentials carries both fields verbatim
    And the gateway uses the runtime endpoint provided

  # ============================================================================
  # Vertex AI — inline JSON service-account key, project + location
  # ============================================================================

  @integration @v1 @unimplemented
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

  @integration @v1 @unimplemented
  Scenario: Gemini AI Studio uses a plain api_key
    Given a workflow with signature node model "gemini/gemini-2.0-flash" and litellm_params api_key
    When nlpgo executes the node
    Then the gateway-bound inline-credentials carries gemini.api_key
    And the response is 200

  # ============================================================================
  # Custom OpenAI-compatible providers (Mistral, Together, Groq, etc.)
  # ============================================================================

  @integration @v1 @unimplemented
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

  @integration @v1 @unimplemented
  Scenario: tool_call arguments round-trip as canonical JSON without byte drift
    Given a workflow whose signature node has tools defined and the LLM responds with a tool_call
    When nlpgo serializes the assistant message back into the workflow chat_messages
    Then the tool_call arguments string is canonical-JSON encoded (sorted keys, no extra whitespace)
    And downstream nodes receive the exact same string

  @integration @v1 @unimplemented
  Scenario: structured-output workflow returns a parseable JSON matching the response_format
    Given a workflow whose signature node sets response_format = {"type":"json_schema", "json_schema": {...}}
    When the LLM responds
    Then the assistant message content parses as JSON
    And the JSON validates against the declared json_schema

  # Customer dogfood 2026-05-30: a Studio Prompt with Structured Outputs
  # ON (output:bool + reason:str) bound to a Bedrock Anthropic Haiku 4.5
  # inference profile returned raw prose (`TRUE\n\nReason: ...`) instead
  # of parsed JSON. Bifrost v1.4.22 routes response_format on anthropic-
  # family Bedrock models through Anthropic's native output_config.format
  # extension which has rolling per-region / per-model-version support;
  # when the combination doesn't line up the field is silently ignored
  # and the model returns prose. Python langwatch_nlp doesn't hit this
  # because LiteLLM translates response_format → forced tool_use, which
  # is the oldest + most universally supported Anthropic structured-
  # output path. nlpgo must do the same translation in its executor so
  # the Go path has python parity + the same robustness profile.
  @integration @v1
  Scenario: bedrock + anthropic response_format rewrites to forced tool_use
    Given a workflow whose signature node targets a bedrock anthropic-family model
    And the signature node sets response_format = json_schema with {output:bool, reason:str}
    When nlpgo builds the gateway request body
    Then the body has no response_format field
    And the body has a tools array with one synthesized tool whose function name starts with "lw_so_"
    And the body has tool_choice forcing that tool
    When the model returns its JSON payload as the tool_call arguments
    Then the response Content carries that JSON string lifted from the tool_call
    And the engine extracts each declared output field from the JSON

  # ============================================================================
  # Multi-turn chat history preserved across signature nodes
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: chat_messages history is preserved across two consecutive signature nodes
    Given a workflow with two signature nodes in series, both consuming and producing chat_messages
    And the input is a 4-message history including a tool_call/tool_result pair
    When the workflow runs
    Then the second signature node's prompt contains all 4 prior messages plus the first node's assistant turn
    And tool_calls in the history are forwarded role-correct (tool messages keep tool_call_id)

  # ============================================================================
  # Prompt-playground message assembly (system + variable interpolation)
  #
  # The prompt playground sends an execute_component event whose signature
  # node carries an `instructions` parameter (the system prompt the user
  # typed) plus a `messages` history (the saved template messages, which
  # may contain {{var}} placeholders, followed by the live conversation
  # turns). Regression 2026-05-14: nlpgo returned the messages array
  # verbatim — dropping the system prompt, never interpolating the
  # placeholders, and leaving an empty {{input}} template turn duplicated
  # alongside the real user turn. Python parity is template_adapter.py
  # format(): render the system from instructions, render each message's
  # content with the input variables, then drop messages whose content is
  # empty after rendering (this is what removes the unfilled {{input}}
  # placeholder turn).
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: prompt-playground signature node renders the system prompt from instructions
    Given a signature node whose instructions are "You are a helpful assistant" and whose messages history is a single user turn "{{input}}"
    And the input variable "input" is "hello there"
    When the workflow runs
    Then the assembled prompt starts with a system message containing "You are a helpful assistant"
    And the user turn content is "hello there" with no literal "{{input}}" remaining

  @integration @v1 @unimplemented
  Scenario: an unfilled template placeholder turn is dropped, not duplicated
    Given a signature node whose messages history is "{{input}}" followed by a live user turn "test6"
    And the input variable "input" is empty
    When the workflow runs
    Then the assembled prompt has exactly one user turn with content "test6"
    And there is no user turn whose content is empty or the literal "{{input}}"

  @integration @v1 @unimplemented
  Scenario: instructions with empty variables still produce a non-empty system prompt
    Given a signature node whose instructions are "You are a helpful assistant\n___{{answer}}___\n___{{unbiased}}___\nalways return passed as true"
    And the input variables "answer" and "unbiased" are empty
    When the workflow runs
    Then the assembled prompt has a system message containing "You are a helpful assistant"
    And the system message contains "always return passed as true"

  # ============================================================================
  # Streaming — SSE pass-through
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: streaming /go/studio/execute forwards SSE deltas from the gateway in real time
    Given a workflow with one signature node configured for streaming
    When the TS app GETs "/go/studio/execute" expecting text/event-stream
    Then nlpgo emits "execution_state_change" events for each gateway delta
    And the gateway-bound /v1/chat/completions request has stream=true
    And nlpgo sends a final "done" event with the complete result
    And there is at least one "is_alive_response" heartbeat if the stream takes longer than NLP_STREAM_HEARTBEAT_SECONDS

  # ============================================================================
  # Errors & cancellation
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: gateway returning 401 surfaces a clean error event in the studio stream
    Given a workflow signature node whose litellm_params api_key is intentionally wrong
    When the workflow runs through nlpgo
    Then the gateway returns 401
    And nlpgo emits an "error" event with message containing "authentication failed" and the gateway request id
    And nlpgo does NOT include the api_key value in any log line

  @integration @v1 @unimplemented
  Scenario: client closing the SSE connection cancels the in-flight gateway request
    Given a workflow streaming a long signature node
    When the client closes the connection mid-stream
    Then nlpgo cancels the gateway request via context cancellation
    And the gateway sees an upstream client_disconnect within 1 second
    And no further node executions are scheduled

  @integration @v1 @unimplemented
  Scenario: workflow with an unsupported node kind (agent/evaluator/retriever/custom) returns 501
    Given a workflow that contains a node of kind "evaluator"
    When the TS app POSTs to "/go/studio/execute_sync"
    Then nlpgo returns status 501 with body.type "unsupported_node_kind"
    And the TS app fall-back logic re-routes the workflow to the legacy Python path

  # ============================================================================
  # Cost attribution
  # ============================================================================

  @integration @v1 @unimplemented
  Scenario: gateway cost attribution lands on the correct project for studio runs
    Given a workflow run for project "acme-api" on the Go path
    When the run completes
    Then the LangWatch trace at /api/trace/<trace_id> has metrics.total_cost > 0
    And the trace's project_id is "acme-api"
    And the per-node cost is reported in the workflow result

  # ============================================================================
  # Negative paths — bad input is rejected, but auth is at the infra layer
  # ============================================================================
  #
  # Earlier drafts of this spec mandated an HMAC signature on /go/*. That bridge
  # was removed when the gateway moved to library-mode (see _shared/contract.md
  # §4 / §8). nlpgo /go/* now matches the Python NLP service's posture: no
  # application-layer auth, security comes from Lambda Function URL + URL
  # secrecy + restrictive Security Groups.

  @integration @v1 @unimplemented
  Scenario: /go/studio/execute_sync with a malformed body returns a typed 400
    When a request hits "/go/studio/execute_sync" with a body that is not valid JSON
    Then the response status is 400
    And the response body.type names the parse failure
    And no gateway call is made
