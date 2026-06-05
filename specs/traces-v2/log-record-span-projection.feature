Feature: Log-only traces show a populated span waterfall

  Some coding assistants (notably Claude Code over OTLP) report every model
  call, prompt, tool and hook as a log record rather than a span, so the trace
  carries content but zero spans. Before this feature the v2 drawer waterfall
  showed "No span data available" for those traces even though the Summary tab
  was fully populated. The drawer now derives display spans from the trace's log
  records at read time, so the waterfall reflects the session.

  This is read-only display derivation: it never writes spans or trace-summary
  fold state, runs only when the trace has no stored spans, and is bounded by
  the log-record count.

  Background:
    Given a trace whose events arrived as log records and that has no stored spans

  Scenario: The waterfall is populated from the trace's log records
    When I open the trace in the v2 drawer
    Then the waterfall shows a span for the session and its events
    And no spans are written to storage

  Scenario: Each model call is shown as a single call span
    Given the trace contains a model call reported across request, body and response records
    When I open the waterfall
    Then that model call appears as one span carrying its model, tokens and cost

  Scenario: The conversation turn shows its prompt and reply
    Given a main-thread model call with a request body and a response body
    When I open the call span
    Then it shows the prompt as input and the assistant reply as output

  Scenario: Utility-call replies are not shown as the assistant's answer
    Given a title-generation model call whose reply is housekeeping text
    When I open that call span
    Then its prompt is shown but its reply is not surfaced as an assistant answer

  Scenario: A title-generation turn never borrows a main-thread prompt
    Given the trace contains both a title-generation call and a main-thread call
    When the prompts are matched to their calls
    Then each call shows only its own prompt

  Scenario: Very large log-only traces are bounded with an elision marker
    Given the trace has more log records than the read cap
    When I open the waterfall
    Then it shows the capped set plus a marker reporting how many records were elided
