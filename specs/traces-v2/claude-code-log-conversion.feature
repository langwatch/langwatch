Feature: Claude Code logs become gen_ai and tool spans by folding the whole turn
  Claude Code emits its model calls and tool calls as OTLP log records, not
  spans. It logs a model call as three events split in time: the request body
  (the input) when the call starts, and the anchor (model, tokens, cost) plus
  the response body (the output) when the call ends. Because the exporter
  flushes on an interval, any call that runs longer than that interval — which
  is every tool-using turn — has its start and end events delivered in
  different batches.

  Converting one batch at a time can never rejoin those halves, so model spans
  lost their input and/or output on exactly the turns that matter most. Instead
  the receiver saves the Claude Code logs and the spans are folded from the
  whole turn's saved logs, where every batch is already visible. One trace is
  one turn, so this set is small.

  As a user observing my Claude Code usage in LangWatch
  I want each model call and tool call to appear as a complete span
  So that the waterfall, input, output, tokens, and cost render like any other trace

  Rule: a model call's span is folded from the whole turn's logs, so a request
  body delivered in an earlier batch than its anchor still becomes that span's
  input rather than being dropped or duplicated.

    @unit
    Scenario: A model call split across export batches still has input and output
      Given Claude Code logs a model call's request body in one export batch
      And the matching anchor and response body arrive in a later batch
      When both batches have been ingested
      Then the call is one llm span carrying the model, tokens, and cost
      And the span input is the user's request
      And the span output is the assistant's reply
      And there is no second, input-only duplicate of the same call

    @unit
    Scenario: The model call that invokes a tool shows the tool call as its output
      Given a turn where the model responds by calling a tool
      And that model call's response was delivered in a different batch than its anchor
      When the turn has been ingested
      Then the model call's span output reflects the tool the model chose to call
      And its input is the user's request for that turn

    @unit
    Scenario: Two model calls in one turn keep their own input and output
      Given a turn with a tool-deciding model call and a final reply model call
      When the turn has been ingested across several batches
      Then each model call is its own span with its own input and output
      And neither call's input or output is attributed to the other

  Rule: a turn is one root span, so the model calls and tool calls of a turn
  hang under the user's prompt instead of appearing as a flat fan of separate
  parentless spans.

    @unit
    Scenario: A turn's model and tool calls are children of one root span
      Given a turn with a user prompt, a model call, and a Bash tool call
      When the turn has been ingested
      Then the turn is one root span carrying the user's prompt as its input
      And the model call and the Bash tool call are children of that root

  Rule: Claude Code never reports a tool's stdout in telemetry, so a tool
  span's output is recovered from the conversation of the next model call,
  where the tool result is fed back to the model.

    @unit
    Scenario: A tool call's output is recovered from the following model call
      Given a turn that runs a Bash tool and then replies
      And the tool's telemetry event carries the command but no stdout
      When the turn has been ingested
      Then the Bash span shows the command as its input
      And the Bash span shows the tool's result as its output
      And the result is taken from the next model call's conversation

    @unit
    Scenario: A tool whose result never reaches a later call has no invented output
      Given a tool call that is the last thing in the turn
      When the turn has been ingested
      Then the tool span shows its input
      And its output is left empty rather than fabricated

  Rule: the saved Claude Code logs are an implementation detail of building the
  spans, so they are not shown again as raw log rows.

    Scenario: The converted Claude Code logs do not clutter the events view
      Given a Claude Code turn that has been folded into spans
      When I open the trace's events and logs view
      Then the model-call and tool log records are not listed as raw logs
      And the spans built from them appear in the waterfall

    Scenario: Lifecycle events stay on the log path
      Given Claude Code emits user_prompt, hook, mcp, and plugin log events
      When the OTLP logs are ingested
      Then those events remain visible in the trace's events and logs view

  Rule: folding is idempotent, so retries, replays, and a late-arriving batch
  converge on the same spans without duplicating them.

    @unit
    Scenario: Re-ingesting the same logs does not duplicate the spans
      Given a turn that was already folded into spans
      When the same OTLP logs are ingested again
      Then the same spans are produced, so the store dedups them

    @unit
    Scenario: A late batch completes the span instead of duplicating it
      Given a model call whose anchor was ingested before its request body
      When the request body arrives in a later batch
      Then the existing span gains the input
      And no separate input-only span is created

  Rule: cost and reply attribution are unchanged by the new folding.

    Scenario: The trace cost is not double-counted
      Given a folded Claude Code turn with a known cost
      When the trace summary is computed
      Then the trace's total cost equals that turn's cost, not twice it

    Scenario: A utility model call keeps its cost but not its text as the reply
      Given a generate_session_title or prompt_suggestion model call
      When it is folded into a span
      Then the span still contributes its tokens and cost to the trace
      But its text is not surfaced as the assistant's reply

    @unit
    Scenario: A model call with genuinely no bodies still appears
      Given an anchor with token counts and cost whose bodies never arrive in any batch
      When the turn has been ingested
      Then an llm span is still emitted with the model, tokens, and cost
      And it simply has no input or output text

  Rule: nothing the logs carried is dropped on the way to the span, so a model
  call keeps its full request and response bodies — the system prompt, every
  tool and skill schema, and the whole message history that drive its cache
  tokens — next to the light readable input and output.

    @unit
    Scenario: A model call keeps its full request and response bodies on the span
      Given a folded model call whose request and response bodies were ingested
      When the call becomes an llm span
      Then the span carries the verbatim request body next to its readable input
      And the span carries the verbatim response body next to its readable output

  Rule: once a turn's logs are folded into spans the spans carry every field the
  logs did, so the raw Claude Code logs are duplicated data and are evicted far
  sooner than the platform default retention.

    @unit
    Scenario: A folded Claude Code log is retained only briefly
      Given a Claude Code log record that the span fold consumes
      When the receiver stores it
      Then its retention is capped to the short claude-fold floor instead of the platform default

    @unit
    Scenario: A log record outside the Claude Code fold keeps the platform default retention
      Given an OTLP log record that is not part of a Claude Code fold
      When the receiver stores it
      Then its retention is the platform default
