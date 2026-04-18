Feature: SSE streaming — exact byte preservation post-first-chunk
  Coding CLIs (Claude Code, Codex) parse SSE tool-call deltas with zero
  tolerance for reordering or re-chunking. We pass through byte-for-byte
  after the first chunk. Before the first chunk we can still mutate
  (inject headers, swap providers for fallback).

  See contract.md §7b.

  Background:
    Given a VK configured with a single provider and no fallback

  Rule: Pre-first-chunk mutations allowed, post-first-chunk strict passthrough

    @integration
    Scenario: response headers are injected before streaming starts
      When I POST /v1/chat/completions with stream=true
      Then the response status is 200
      And the response headers include "X-LangWatch-Request-Id"
      And the response headers include "X-LangWatch-Provider"
      And the first SSE chunk is the upstream provider's first chunk verbatim

    @integration
    Scenario: every SSE chunk after the first is byte-equivalent to upstream
      When I POST /v1/chat/completions with stream=true against OpenAI
      Then each data: line forwarded to the client SHA-256 matches the upstream data: line
      And no chunk is merged, split, or re-chunked

    @integration
    Scenario: Anthropic /v1/messages stream preserves tool-call deltas exactly
      Given the upstream stream contains tool_use / input_json_delta events
      When the client reads the stream
      Then each input_json_delta is forwarded intact
      And the sequence of event: lines is unchanged (no reordering)

  Rule: Mid-stream failure terminates, never silently switches provider

    @integration
    Scenario: upstream drops mid-stream -> terminal error event, connection closes
      Given upstream emits 3 SSE chunks then connection drops
      When the client reads
      Then the client receives the 3 legit chunks
      And then receives a terminal `event: error` with `data: {"type":"error","error":{"type":"provider_error","message":"upstream connection reset"}}`
      And the HTTP connection is closed (chunked-encoding end)
      And the gateway does NOT switch to fallback provider mid-stream

  Rule: Post-response guardrails are non-blocking on streaming

    @integration
    Scenario: post guardrail flags the assembled response without altering the stream
      Given a VK with a post-guardrail "pii-check" configured
      When I POST /v1/chat/completions with stream=true
      Then every chunk reaches the client in real time (never buffered waiting for guardrail)
      And after the stream closes, the gateway reassembles the full response
      And runs the post-guardrail asynchronously
      And records span attribute `langwatch.guardrail.post_flag` on the trace if it flags
      And the client's response was NOT modified retroactively

  Rule: Stream-chunk guardrails gate each chunk with a 50ms budget

    @integration
    Scenario: chunk guardrail blocks a forbidden chunk
      Given a VK with a `direction: stream_chunk` guardrail that blocks on "SECRET:"
      When upstream emits a chunk containing "here is the SECRET: abc"
      Then the gateway emits a terminal `event: error` with error.type "guardrail_blocked"
      And the subsequent upstream chunks are NOT forwarded

    @integration
    Scenario: chunk guardrail exceeds 50ms -> gateway falls through, logs warning
      Given a stream_chunk guardrail that takes 120ms
      When a chunk is processed
      Then the chunk is emitted to the client unmodified after the 50ms budget elapses
      And the OTel trace has `langwatch.guardrail.stream_chunk.timeout` attribute set
      And a warning log is emitted

    @integration
    Scenario: chunk guardrail modifies chunk text (PII redaction)
      Given a `direction: stream_chunk` guardrail that redacts emails
      When upstream emits a chunk containing "contact me at foo@bar.com"
      Then the chunk forwarded to the client has "foo@bar.com" replaced with "[REDACTED]"
      And the guardrail's policies_triggered is recorded in the trace

  Rule: Bifrost streaming channel mapped directly to SSE writer

    @unit
    Scenario: each BifrostStreamChunk becomes one SSE data: line
      Given a bifrost.ChatCompletionStreamRequest that yields 5 chunks
      When the gateway proxies the channel to the client
      Then the client sees 5 `data: {...}` lines plus a trailing `data: [DONE]`
      And no additional heartbeats / buffering is introduced

    @unit
    Scenario: Flush is called after every chunk so CLI gets bytes promptly
      When each chunk arrives
      Then the HTTP ResponseWriter's Flusher.Flush() is invoked
      And the test harness confirms bytes reach the client socket within 5ms of bifrost emission
