Feature: SSE streaming — exact byte preservation post-first-chunk

  # All scenarios in this file describe gateway data-plane SSE behaviour
  # (response-header injection before first chunk, byte-equivalent
  # passthrough, mid-stream upstream drop handling, post-guardrail
  # non-blocking, per-chunk guardrail). Implemented in the Go gateway
  # service, out of scope for the TS parity check.

  Coding CLIs (Claude Code, Codex) parse SSE tool-call deltas with zero
  tolerance for reordering or re-chunking. We pass through byte-for-byte
  after the first chunk. Before the first chunk we can still mutate
  (inject headers, swap providers for fallback).

  See contract.md §7b.

  Background:
    Given a VK configured with a single provider and no fallback

  Rule: Pre-first-chunk mutations allowed, post-first-chunk strict passthrough

    @integration @unimplemented
    Scenario: response headers are injected before streaming starts
      When I POST /v1/chat/completions with stream=true
      Then the response status is 200
      And the response headers include "X-LangWatch-Request-Id"
      And the response headers include "X-LangWatch-Provider"
      And the first SSE chunk is the upstream provider's first chunk verbatim

    @integration @unimplemented
    Scenario: every SSE chunk after the first is byte-equivalent to upstream
      When I POST /v1/chat/completions with stream=true against OpenAI
      Then each data: line forwarded to the client SHA-256 matches the upstream data: line
      And no chunk is merged, split, or re-chunked

    @integration @unimplemented
    Scenario: Anthropic /v1/messages stream preserves tool-call deltas exactly
      Given the upstream stream contains tool_use / input_json_delta events
      When the client reads the stream
      Then each input_json_delta is forwarded intact
      And the sequence of event: lines is unchanged (no reordering)

  Rule: Mid-stream failure terminates, never silently switches provider

    @integration @unimplemented
    Scenario: upstream drops mid-stream -> terminal error event, connection closes
      Given upstream emits 3 SSE chunks then connection drops
      When the client reads
      Then the client receives the 3 legit chunks
      And then receives a terminal `event: error` with `data: {"type":"error","error":{"type":"provider_error","message":"upstream connection reset"}}`
      And the HTTP connection is closed (chunked-encoding end)
      And the gateway does NOT switch to fallback provider mid-stream

  Rule: Post-response guardrails are non-blocking on streaming

    @integration @unimplemented
    Scenario: post guardrail flags the assembled response without altering the stream
      Given a VK with a post-guardrail "pii-check" configured
      When I POST /v1/chat/completions with stream=true
      Then every chunk reaches the client in real time (never buffered waiting for guardrail)
      And after the stream closes, the gateway reassembles the full response
      And runs the post-guardrail asynchronously
      And records span attribute `langwatch.guardrail.post_flag` on the trace if it flags
      And the client's response was NOT modified retroactively

  Rule: Stream-chunk guardrails gate each chunk with a 50ms budget

    @integration @unimplemented
    Scenario: chunk guardrail blocks a forbidden chunk
      Given a VK with a `direction: stream_chunk` guardrail that blocks on "SECRET:"
      When upstream emits a chunk containing "here is the SECRET: abc"
      Then the gateway emits a terminal `event: error` with error.type "guardrail_blocked"
      And the subsequent upstream chunks are NOT forwarded

    @integration @unimplemented
    Scenario: chunk guardrail exceeds 50ms -> gateway falls through, logs warning
      Given a stream_chunk guardrail that takes 120ms
      When a chunk is processed
      Then the chunk is emitted to the client unmodified after the 50ms budget elapses
      And the OTel trace has `langwatch.guardrail.stream_chunk.timeout` attribute set
      And a warning log is emitted

    @integration @unimplemented
    Scenario: chunk guardrail modifies chunk text (PII redaction)
      Given a `direction: stream_chunk` guardrail that redacts emails
      When upstream emits a chunk containing "contact me at foo@bar.com"
      Then the chunk forwarded to the client has "foo@bar.com" replaced with "[REDACTED]"
      And the guardrail's policies_triggered is recorded in the trace

  Rule: Bifrost streaming channel mapped directly to SSE writer

    @unit @unimplemented
    Scenario: each BifrostStreamChunk becomes one SSE data: line
      Given a bifrost.ChatCompletionStreamRequest that yields 5 chunks
      When the gateway proxies the channel to the client
      Then the client sees 5 `data: {...}` lines plus a trailing `data: [DONE]`
      And no additional heartbeats / buffering is introduced

    @unit @unimplemented
    Scenario: Flush is called after every chunk so CLI gets bytes promptly
      When each chunk arrives
      Then the HTTP ResponseWriter's Flusher.Flush() is invoked
      And the test harness confirms bytes reach the client socket within 5ms of bifrost emission

  Rule: Streaming usage capture — gateway injects stream_options.include_usage for OpenAI-shape providers

    # OpenAI's /v1/chat/completions ONLY emits the final `usage` SSE chunk
    # (prompt/completion tokens) when the request body carries
    # `stream_options:{include_usage:true}`. Callers without that flag see
    # tokens_in=0 + tokens_out=0 in the gateway trace. Since the gateway
    # needs usage for cost enrichment + budget accounting, it injects the
    # flag on-the-fly when the caller hasn't set it. Anthropic, Gemini,
    # Vertex, and Bedrock emit usage natively in their stream deltas, so
    # this injection is skipped for those providers.

    @unit @unimplemented
    Scenario: OpenAI stream without stream_options gets include_usage injected
      Given an inbound /v1/chat/completions body with "stream":true and no "stream_options"
      And the resolved provider is OpenAI
      When the gateway prepares the upstream request
      Then the forwarded body contains "stream_options":{"include_usage":true}
      And the rest of the body is byte-identical to the input (no re-ordering of messages)

    @unit @unimplemented
    Scenario: OpenAI stream with stream_options.include_usage=false is left untouched
      Given an inbound /v1/chat/completions body with "stream_options":{"include_usage":false}
      And the resolved provider is OpenAI
      When the gateway prepares the upstream request
      Then the forwarded body still has "include_usage":false
      And the gateway accepts the caller's override without complaint

    @unit @unimplemented
    Scenario: OpenAI stream with caller-provided stream_options.include_usage=true is left intact
      Given an inbound /v1/chat/completions body with "stream_options":{"include_usage":true}
      When the gateway prepares the upstream request
      Then the body is forwarded verbatim (no double-set)

    @unit @unimplemented
    Scenario: non-OpenAI providers are NOT mutated — Anthropic / Gemini / Bedrock emit usage natively
      Given an inbound /v1/chat/completions body with "stream":true against an Anthropic-bound VK
      When the gateway prepares the upstream request
      Then the body does NOT gain "stream_options"
      And Bifrost's Anthropic translator handles usage via native message_delta

    @unit @unimplemented
    Scenario: non-streaming requests are NOT mutated
      Given an inbound /v1/chat/completions body with "stream":false or "stream" absent
      When the gateway prepares the upstream request
      Then the body does NOT gain "stream_options"

    @integration @unimplemented
    Scenario: a real OpenAI streaming call without stream_options yields non-zero tokens on the trace
      Given a VK bound to OpenAI
      When the caller POSTs /v1/chat/completions with "stream":true and no stream_options
      And the upstream response completes
      Then the OTel span attached to the trace has gen_ai.usage.input_tokens > 0
      And gen_ai.usage.output_tokens > 0
      And the gateway does NOT emit the success_no_usage soft warning for this request

  Rule: Trailing diagnostics never ride a data: frame on OpenAI-compatible streams

    # When the upstream provider reports no usage, the gateway notes it for
    # operators. Strict OpenAI-compatible clients (Vercel AI SDK family)
    # schema-validate every data: payload against chunk | error and crash
    # the whole process on anything else. An SSE comment line is ignored by
    # every spec client but still visible to curl -N and log scrapers.

    @unit
    Scenario: provider reported no usage -> diagnostics go out as an SSE comment, not a data frame
      Given a chat completion stream whose upstream reported no usage block
      When the gateway emits the stream
      Then the response carries the "provider_did_not_report_usage_on_stream" note as an SSE comment line
      And no data: frame other than the forwarded chunks and [DONE] exists in the stream

    @unit
    Scenario: provider reported usage -> no trailing diagnostics frame at all
      Given a chat completion stream whose upstream reported a non-zero usage block
      When the gateway emits the stream
      Then the response contains no usage-warning comment or frame

    @unit
    Scenario: raw passthrough streams (Gemini) are never appended to
      Given a raw-framed passthrough stream whose upstream reported no usage block
      When the gateway emits the stream
      Then the bytes are exactly what upstream sent, with nothing appended

  Rule: Chat completion streams open with a role-carrying delta, matching OpenAI's contract

    # api.openai.com opens every streamed choice with
    # "delta":{"role":"assistant","content":""} before any content arrives.
    # The gateway's stream engine consumes that opening chunk internally and
    # re-emits starting from the first content delta, so clients that key
    # their accumulator off the opening role delta index a message that was
    # never created (our own python-sdk streaming tracer crashed with
    # KeyError: 0 on every streamed chat completion through the gateway).
    # The gateway therefore guarantees the role on the first delta it emits
    # per choice, whatever the upstream engine swallowed.

    @unit
    Scenario: the first emitted delta of a chat completion stream carries the assistant role
      Given a chat completion stream that would otherwise reach the client with no role on any delta
      When the gateway emits the stream
      Then the first delta of the stream carries "role":"assistant"
      And every later chunk of the stream is emitted unchanged

    @unit
    Scenario: a turn that opens with a tool call still carries the role
      Given a chat completion stream whose first delta carries tool calls and no content
      When the gateway emits the stream
      Then that first delta carries "role":"assistant" alongside its tool calls

    @unit
    Scenario: every choice of a multi-choice stream opens with its own role delta
      Given a chat completion request with n greater than 1
      When the gateway emits the stream
      Then the first delta of each choice index carries "role":"assistant"

    @unit
    Scenario: a provider that sends its own role delta passes through untouched
      Given a chat completion stream whose upstream already opens with a role-carrying delta
      When the gateway emits the stream
      Then the stream is emitted unchanged
      And no chunk gains a second role

    @unit
    Scenario: terminal chunks are not reshaped by the role repair
      Given a chat completion stream that ends with a usage-only chunk and the [DONE] sentinel
      When the gateway emits the stream
      Then the usage-only chunk passes through with no choices invented
      And the [DONE] sentinel is unchanged

    @unit
    Scenario: a choice with no delta is not given one
      Given a chat completion chunk whose choice carries a finish reason and no delta
      When the gateway emits the stream
      Then the chunk passes through without a delta object being invented

    @unit
    Scenario: OpenAI-compatible providers inherit the role repair
      Given a chat completion stream served through a self-hosted OpenAI-compatible endpoint
      When the gateway emits the stream
      Then the first delta of the stream carries "role":"assistant"
