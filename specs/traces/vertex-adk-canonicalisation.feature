Feature: Vertex AI Agent Engine (Google ADK) span canonicalisation
  As a LangWatch user tracing agents built with Google's Agent Development Kit
  I want LLM and tool spans reported via Vertex AI to show their inputs and outputs
  So that I can inspect conversations without digging through raw span attributes

  # =========================================================================
  # What this covers
  # =========================================================================
  #
  # Google ADK / Vertex AI Agent Engine reports spans with standard gen_ai.*
  # attributes (operation name, model, provider "gcp.vertex.agent", token
  # usage) but carries the actual conversation content in vendor payloads:
  #
  #   - gcp.vertex.agent.llm_request   (system instruction + chat contents)
  #   - gcp.vertex.agent.llm_response  (model reply, incl. tool calls)
  #   - gcp.vertex.agent.tool_call_args / gcp.vertex.agent.tool_response
  #
  # Without dedicated handling those payloads pass through as opaque
  # attributes and the span shows no input or output.

  Background:
    Given a span reported by a Vertex AI agent

  Scenario: LLM call input is extracted from the request payload
    Given the span carries a request payload with a conversation history
    When the span is canonicalised
    Then the span input shows the conversation as chat messages

  Scenario: The system instruction is surfaced separately from the conversation
    Given the span carries a request payload with a system instruction
    When the span is canonicalised
    Then the system instruction is shown as the span's system instructions
    And it does not appear as a chat message

  Scenario: LLM call output is extracted from the response payload
    Given the span carries a response payload with the model's reply
    When the span is canonicalised
    Then the span output shows the reply as a chat message

  Scenario: Tool interactions in the conversation are preserved
    Given the conversation history contains a tool call and its result
    When the span is canonicalised
    Then the tool call appears as an assistant tool call message
    And the tool result appears as a tool message

  Scenario: Tool execution spans show their arguments and result
    Given a tool execution span with call arguments and a response
    When the span is canonicalised
    Then the span input shows the tool call arguments
    And the span output shows the tool response

  Scenario: Tool execution spans are classified as tool spans
    Given a tool execution span
    When the span is canonicalised
    Then the span is typed as a tool span, not an LLM span

  Scenario: Token usage falls back to the response usage metadata
    Given the span reports no standard token usage
    And the response payload carries usage metadata
    When the span is canonicalised
    Then the span metrics show the prompt and completion token counts
    And cached prompt tokens are reported as cache-read tokens

  Scenario: Explicitly reported token usage is not overridden
    Given the span reports standard token usage
    And the response payload carries different usage metadata
    When the span is canonicalised
    Then the span metrics keep the explicitly reported token counts

  Scenario: Spans from other providers are untouched
    Given a span reported by a different SDK
    When the span is canonicalised
    Then no Vertex AI extraction is applied
