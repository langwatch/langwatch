Feature: Coding Agent Trace Fidelity (Path B direct OTLP)

  Coding assistants (claude, cowork, codex, gemini, opencode, copilot) export
  OpenTelemetry straight to LangWatch on the direct-OTLP "Path B". This feature captures the
  fidelity guarantees for what lands on the trace: token accuracy, reasoning
  signals, tool calls, and how the bundled cost classification is surfaced.

  Background:
    Given the trace processing pipeline is running

  # --- Codex token accuracy -------------------------------------------------

  @unit
  Scenario: Codex turn tokens are counted once when two spans report the same usage
    Given a codex Path B turn where the turn rollup span and its response span both report the same token usage
    When the trace summary is computed
    Then the trace's input and output token totals count that usage once, not twice
    And the per-span detail still shows the usage on each span

  @unit
  Scenario: Codex exec turn tokens are counted once when the rollup repeats the response spans' usage
    Given a codex exec turn whose turn rollup span repeats the usage its response spans already report per call
    When the spans are canonicalised
    Then the rollup defers and the response spans are what the trace totals count

  @unit
  Scenario: Codex reasoning output tokens are captured
    Given a codex Path B turn span reporting reasoning output tokens
    When the span is canonicalised
    Then the span carries the reasoning tokens under the canonical usage key
    And the trace summary reasoning token total includes them

  # --- Reasoning effort (the request setting, not the token count) -----------

  @unit
  Scenario: Codex reasoning effort is canonicalised from the turn span
    Given a codex Path B turn span reporting a reasoning effort setting
    When the span is canonicalised
    Then the span carries the reasoning effort under the canonical request key

  @unit
  Scenario: Codex reasoning effort is canonicalised from the response span when no turn rollup exists
    Given a codex exec session whose response span reports a reasoning effort setting and no turn rollup span exists
    When the span is canonicalised
    Then the span carries the reasoning effort under the canonical request key

  @unit
  Scenario: Claude Code reasoning effort is lifted from the model call log event
    Given a claude code api_request log event reporting an effort setting for a conversation turn
    When the log record's canonical attributes are lifted
    Then the trace summary attributes carry the reasoning effort

  @unit
  Scenario: Reasoning effort is lifted onto the trace summary
    Given a trace whose model call span carries a reasoning effort setting
    When the trace summary is computed
    Then the trace summary attributes carry the reasoning effort
    And the drawer header reads it from the trace summary to show next to the model

  # --- Anthropic prompt-cache TTL split (5m vs 1h) ---------------------------
  # Anthropic reports cache writes split by TTL (ephemeral_5m_input_tokens vs
  # ephemeral_1h_input_tokens) inside the response body usage. The split is
  # what tells a reader WHICH cache claude is paying for: a 1h write bills at
  # 2x base input while a 5m write bills at 1.25x.

  @unit
  Scenario: Claude Code cache TTL split is lifted from the response body log event
    Given a claude code api_response_body log event whose usage reports 5m and 1h cache creation tokens
    When the log record's canonical attributes are lifted
    Then the per-call 5m and 1h cache creation token counts are lifted

  @unit
  Scenario: Cache TTL split sums accumulate across a session's model calls
    Given a trace with two model call log events each reporting 1h cache creation tokens
    When the trace summary is computed
    Then the trace summary attributes carry the summed 1h cache creation tokens
    And the token breakdown popover shows the 5m and 1h cache write rows

  # --- Codex cache writes -----------------------------------------------------

  @unit
  Scenario: Codex cache write tokens are canonicalised from the turn span
    Given a codex Path B turn span reporting cache write input tokens
    When the span is canonicalised
    Then the span carries the cache write count under the canonical cache creation key

  # --- Claude request body salvage (system prompt + tools) --------------------
  # Claude truncates api_request_body at ~60KB inline, cutting the JSON
  # mid-string. The system prompt and the tool definitions sit AFTER the
  # rolling message history in Anthropic's request layout, so they are exactly
  # what the cut destroys. A salvage parse recovers every complete leading
  # message, the system text (whole or partial), and the tool names, instead
  # of throwing the whole body away and falling back to the bare user prompt.

  @unit
  Scenario: A truncated request body still yields its leading messages
    Given a claude code api_request_body cut mid-way through its message history
    When the span input is built from the request body
    Then every complete message before the cut is in the span input
    And the input notes that the body was truncated

  @unit
  Scenario: A truncated request body still yields the system prompt when the cut lands inside it
    Given a claude code api_request_body cut mid-way through the system prompt text
    When the span input is built from the request body
    Then the span input carries a system message with the recovered text marked as truncated

  @unit
  Scenario: Tool definitions are surfaced from the request body
    Given a claude code api_request_body carrying a tools array
    When the span input is built from the request body
    Then the span input carries the tool names so MCP and built-in tools are visible

  @unit
  Scenario: Identical system prompts across a session's calls are shown once
    Given two model calls in one trace whose request bodies carry the same system prompt
    When the trace's spans are enriched from the logs
    Then the first call carries the full system text
    And later calls reference it instead of repeating it

  # --- Opencode tool calls --------------------------------------------------

  @unit
  Scenario: Opencode tool-call spans capture the tool name, arguments, and result
    Given an opencode Path B tool-call span reporting a tool name, arguments, and result
    When the span is canonicalised
    Then the span carries the tool name under the canonical tool name key
    And the tool arguments are captured as the span input
    And the tool result is captured as the span output

  # --- Bundled cost classification marker -----------------------------------

  @unit
  Scenario: The internal non-billable cost marker is hidden from the trace resources view
    Given a trace whose spans carry the internal non-billable cost resource marker
    When the trace resource attributes are read for the drawer
    Then the non-billable cost marker is not present in the returned resource attributes

  @unit
  Scenario: The bundled cost split is preserved when the non-billable marker is hidden
    Given a bundled coding-agent span priced from the model pricing tables
    When the trace summary is computed
    Then the bundled portion of the cost is recorded as non-billed cost

  # --- Span noise filter (codex/opencode only) ------------------------------
  # codex and opencode export their whole internal call graph (DB, file, auth,
  # websocket, session-init), drowning the AI spans and fragmenting a session
  # into hundreds of traces. We keep only the AI-semantic spans for those two
  # KNOWN tools and never touch any other OTLP.

  @unit
  Scenario: Codex infrastructure spans are filtered out at ingestion
    Given a codex Path B infrastructure span (session init, websocket, plugin list)
    When the span is ingested
    Then the span is filtered out and not stored

  @unit
  Scenario: The codex turn span survives the noise filter
    Given a codex Path B session_task.turn span
    When the span is ingested
    Then the span is kept

  @unit
  Scenario: Codex exec sessions get the same noise filter as the TUI
    Given a codex exec Path B infrastructure span (auth, rollout persistence, plugin list) under the codex_exec scope
    When the span is ingested
    Then the span is filtered out and not stored

  @unit
  Scenario: Codex tool spans are filtered so a tool call never mints its own trace
    Given a codex Path B tool span whose parent span lives in another trace
    When the span is ingested
    Then the span is filtered out and not stored
    And the tool call is still shown in the terminal view from its tool_result log

  @unit
  Scenario: Opencode infrastructure spans are filtered out at ingestion
    Given an opencode Path B infrastructure span (sql, config, filesystem, auth)
    When the span is ingested
    Then the span is filtered out and not stored

  @unit
  Scenario: Opencode AI SDK spans survive the noise filter
    Given an opencode Path B ai.* span (ai.streamText, ai.toolCall)
    When the span is ingested
    Then the span is kept

  @unit
  Scenario: Spans from other instrumentation scopes are never filtered
    Given a span from any scope other than codex_cli_rs or opencode
    When the span is ingested
    Then the span is kept regardless of its name or attributes

  # --- Context size (how full the window already was) ------------------------
  # A coding-agent turn re-sends its whole conversation on every model call, so
  # the trace's summed cache reads run into the millions while the number a
  # reader means by "how big is my context" is a single call's worth. The two
  # are different questions and the trace carries both.

  @unit
  Scenario: The context a trace started from is lifted onto the trace summary
    Given a trace whose first model call already carried cached and freshly written input
    When the trace summary is computed
    Then the trace summary attributes carry that call's context size
    And the value is that one call's context, not the sum across the trace's calls

  @unit
  Scenario: A later-arriving earlier call wins the context size
    Given a trace whose model call spans arrive out of order
    When the trace summary is computed
    Then the context size comes from the earliest-starting model call

  @unit
  Scenario: A trace whose calls report no cache carries no context size
    Given a trace whose model calls report no cached or written input
    When the trace summary is computed
    Then the trace summary attributes carry no context size

  @unit
  Scenario: Context size is shown in the trace list next to tokens
    Given a trace list row whose trace reported a context size
    When the Context Size column renders
    Then it shows that trace's starting context, and explains it is not a sum
