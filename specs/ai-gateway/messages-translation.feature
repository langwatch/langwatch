Feature: Anthropic Messages translation: reaching non-Anthropic providers from an Anthropic-shaped client

  Claude Code speaks the Anthropic Messages API and nothing else. Pointed at the
  gateway with ANTHROPIC_BASE_URL and a virtual key, it could previously only
  reach Anthropic: the gateway raw-forwarded POST /v1/messages to whatever
  provider the credential named, without parsing or translating it.

  Against OpenAI or Gemini that failed twice over. Non-streaming returned the
  upstream's own parse error, because the Anthropic body arrived verbatim
  ("Unknown parameter: 'system'", "Unknown name \"messages\""). Streaming, which
  is the only path Claude Code actually uses, did something worse than fail: it
  hung. Zero bytes, no headers, no error frame, the gateway logging status=200
  while the client sat in `requesting` and eventually gave up with
  `api_retry error: "unknown"`. A silent stall is not an error a user can act on.

  So /v1/messages now routes on the resolved provider family. A destination that
  speaks the Anthropic wire format keeps the raw-forward path untouched, byte for
  byte, because that is what preserves prompt-cache prefixes, `thinking` blocks
  and cache-token telemetry. Every other destination is translated: the body
  becomes a neutral request, reaches the provider in that provider's own shape,
  and the response is reassembled into the Anthropic event union on the way back.

  The union is validated strictly by clients, so sequence correctness is the
  whole job. A malformed frame is a hard client failure, not a degraded one, and
  a missing terminal frame is indistinguishable from the hang this replaces.

  See _shared/contract.md and streaming.feature for the SSE byte-preservation
  rules that continue to apply to the raw-forward lane.

  Background:
    Given a virtual key whose credential resolves to a specific provider
    And the client sends an Anthropic-shaped POST /v1/messages body

  # ==========================================================================
  # Routing by provider family
  # ==========================================================================

  @bdd @messages-translation @unit
  Scenario: An Anthropic destination keeps the untouched raw-forward path
    Given the virtual key resolves to the Anthropic provider
    When the gateway builds the dispatch for the request
    Then the request body is forwarded byte-for-byte with no translation
    And the translated lane is not used

  @bdd @messages-translation @unit
  Scenario: A non-Anthropic destination is translated instead of raw-forwarded
    Given the virtual key resolves to a provider that does not speak the Anthropic wire format
    When the gateway builds the dispatch for the request
    Then the body is parsed into a neutral request and translated for that provider
    And no Anthropic-shaped bytes are sent to the provider

  @bdd @messages-translation @unit
  Scenario: Providers that host Anthropic models but expose a different API are translated
    Given the virtual key resolves to a provider that serves Anthropic models over its own protocol
    When the gateway builds the dispatch for the request
    Then the translated lane is used
    And the request no longer depends on an Anthropic-native passthrough that provider does not implement

  # ==========================================================================
  # Streaming: the event union Claude Code validates
  # ==========================================================================

  @bdd @messages-translation @integration
  Scenario: A translated stream opens with message_start and closes with message_stop
    Given the destination is a non-Anthropic provider
    When the client streams a request that produces a text answer
    Then the first event is `message_start`
    And the last event is `message_stop`
    And exactly one `message_delta` precedes the final `message_stop`

  @bdd @messages-translation @integration
  Scenario: Every content block delta arrives inside a matching start and stop pair
    Given the destination is a non-Anthropic provider
    When the client streams a request that produces a text answer
    Then every `content_block_delta` falls between a `content_block_start` and a `content_block_stop` for its own index
    And no content block is left open when the message ends

  @bdd @messages-translation @integration
  Scenario: Content block indices are contiguous from zero
    Given the destination is a non-Anthropic provider
    When the client streams a request that produces both text and a tool call
    Then the content block indices start at 0 and increase by one with no gaps

  @bdd @messages-translation @integration
  Scenario: A truncated answer still closes the message
    Given the destination is a non-Anthropic provider
    And the provider stops the answer because the token limit was reached
    When the client streams the request
    Then the stream still ends with `message_delta` and `message_stop`
    And the reported stop reason is `max_tokens`

  @bdd @messages-translation @integration
  Scenario: A provider that stops sending without a terminal event does not hang the client
    Given the destination is a non-Anthropic provider
    And the provider ends the stream without announcing completion
    When the client streams the request
    Then the gateway closes any open content blocks
    And the client still receives `message_delta` and `message_stop`

  @bdd @messages-translation @unit
  Scenario: The stop reason survives translation
    Given the destination is a non-Anthropic provider
    When the provider finishes for a given reason
    Then the reason is reported in the vocabulary the Anthropic client expects

  # ==========================================================================
  # Tool calls: the loop Claude Code runs on
  # ==========================================================================

  @bdd @messages-translation @integration
  Scenario: A tool call streams as a tool_use block with its arguments
    Given the destination is a non-Anthropic provider
    When the model calls a tool
    Then a `tool_use` content block is opened carrying the tool's id and name
    And the tool arguments arrive as `input_json_delta` updates on that block
    And the block is closed before the message ends

  @bdd @messages-translation @integration
  Scenario: Parallel tool calls each get their own block
    Given the destination is a non-Anthropic provider
    When the model calls two tools in one turn
    Then each call occupies its own content block at its own index
    And each block carries its own tool id, name and arguments

  @bdd @messages-translation @integration
  Scenario: Tool results sent back by the client reach the provider
    Given the destination is a non-Anthropic provider
    And a previous turn produced a tool call
    When the client sends the tool result back in the next request
    Then the provider receives the result associated with the call it belongs to
    And the conversation continues rather than restarting

  # ==========================================================================
  # Non-streaming
  # ==========================================================================

  @bdd @messages-translation @integration
  Scenario: A non-streaming translated response is a complete Anthropic message
    Given the destination is a non-Anthropic provider
    When the client sends a non-streaming request
    Then the response carries an id, the model, the assistant role, content blocks, a stop reason and usage
    And the client can decode it without knowing which provider served it

  # ==========================================================================
  # Failure is always actionable, never a stall
  # ==========================================================================

  @bdd @messages-translation @integration
  Scenario: A request that cannot be served fails with an Anthropic-shaped error
    Given the destination is a non-Anthropic provider
    When the request cannot be translated or the provider rejects it
    Then the client receives an Anthropic-shaped error naming the failure
    And the client is never left waiting with no bytes and no error

  @bdd @messages-translation @unit
  Scenario: Error types are named in the client's own vocabulary
    When the gateway reports a failure on the translated lane
    Then the error type is one the Anthropic client recognises for that status

  @bdd @messages-translation @integration
  Scenario: A provider failure mid-stream reaches the client as an error frame
    Given the destination is a non-Anthropic provider
    And the stream has already started
    When the provider fails part-way through
    Then any open content blocks are closed
    And the client receives a terminal error frame rather than a truncated stream

  @bdd @messages-translation @unit
  Scenario: A managed-Bedrock private endpoint is honored on the translated lane
    Given a Bedrock credential configured with a private runtime endpoint
    When the client sends a /v1/messages request
    Then the request is dispatched through the private endpoint, never the public Bedrock host
    And an invalid private endpoint fails closed with an actionable error

  @bdd @messages-translation @unit
  Scenario: Closing an abandoned stream releases the provider
    Given the destination is a non-Anthropic provider
    And the client goes away before the stream finishes
    When the gateway closes the stream
    Then the provider is released rather than left waiting to send

  # ==========================================================================
  # Non-goals: what this deliberately does not change
  # ==========================================================================

  @bdd @messages-translation @integration @unimplemented
  Scenario: Prompt caching on the Anthropic lane is unaffected
    Given the virtual key resolves to the Anthropic provider
    When the client repeats a request with a cache breakpoint
    Then the cache-token telemetry is reported exactly as before

  @bdd @messages-translation @integration @unimplemented
  Scenario: Extended thinking on the Anthropic lane is unaffected
    Given the virtual key resolves to the Anthropic provider
    When the client sends a request with extended thinking enabled
    Then the thinking blocks reach the client unchanged
