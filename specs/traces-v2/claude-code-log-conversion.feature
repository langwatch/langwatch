Feature: Claude Code model-call logs become gen_ai spans
  Claude Code emits its model calls as OTLP log records, not spans, so a
  Path B (OTLP-from-claude-code) trace had no span data and the v2 waterfall
  showed nothing. At ingest, the model-call log events are trapped and
  converted into one standard gen_ai span per call, so the existing span
  fold lifts model / tokens / cost / input / output and the waterfall
  populates from real stored spans — with no read-path code.

  As a user observing my Claude Code usage in LangWatch
  I want each model call to appear as a normal LLM span
  So that the waterfall, token counts, and cost render like any other trace

  Rule: only the three model-call events are converted; the converted log
  is dropped (not also stored as a log), so the pipeline never double-writes
  or double-counts.

  Scenario: A model call is converted into one gen_ai span
    Given Claude Code emits the model-call triplet for one turn:
      | api_request       | model, tokens, cost, duration, request_id |
      | api_request_body  | the request messages                      |
      | api_response_body | the assistant reply, with request_id      |
    When the OTLP logs are ingested
    Then the three records collapse into one llm span for that turn
    And the span carries the model, token counts, and cost
    And the span input is the user's request and the output is the reply
    And none of the three records is stored as a log

  Scenario: Lifecycle events stay on the log path
    Given Claude Code emits user_prompt, hook, mcp, and plugin log events
    When the OTLP logs are ingested
    Then those events are stored as logs unchanged
    And they remain visible in the trace's events/logs view

  Scenario: The trace cost is not double-counted
    Given a converted Claude Code turn with a known cost
    When the trace summary is computed
    Then the trace's total cost equals that turn's cost, not twice it

  Scenario: A utility model call keeps its cost but not its text as the reply
    Given a generate_session_title or prompt_suggestion model call
    When it is converted into a span
    Then the span still contributes its tokens and cost to the trace
    But its text is not surfaced as the assistant's reply

  Scenario: Re-ingesting the same batch does not duplicate the span
    Given a model-call turn that was already converted and stored
    When the same OTLP batch is ingested again
    Then the same span is produced, so the store dedups it

  Scenario: A model call with no request/response bodies still appears
    Given an api_request with token counts and cost but no bodies
    When it is ingested
    Then an llm span is still emitted with the model, tokens, and cost
    And it simply has no input or output text
