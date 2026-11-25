Feature: Trace I/O accumulation — human-readable summary text
  As an operator scanning trace summaries in the Studio
  I want the input/output columns to show the extracted text from
  message-shaped payloads, not the raw JSON wrapper
  So that the summary surface is actually readable.

  # Why this exists — 2026-05-14 prod regression
  #
  # nlpgo's workflow evaluators emit `langwatch.output` as a wrapper
  # object like `{"output":"Hey there"}`. The IO extraction service
  # ran `messagesToText` / `extractTextFromPlainJson` to pull out
  # the clean text into `outputResult.text`, but the accumulator
  # ignored that field and `JSON.stringify(outputResult.raw)` instead.
  # Result: trace summaries showed `{"output":"Hey there"}` to users
  # instead of `Hey there`.

  Background:
    Given the trace-processing pipeline is folding span events

  @unit @trace-summary
  Scenario: Accumulator uses extracted text not raw JSON wrapper
    Given a span has `langwatch.output` = `{"output":"Hey there"}`
    And the IO extraction service unwraps it into text "Hey there"
    When the IO accumulator folds the span into the trace summary
    Then computedOutput is "Hey there" (not the JSON wrapper)

  @unit @trace-summary
  Scenario: Accumulator falls back to raw stringification when no text extracted
    Given a span has a wrapper of an unknown shape
    And the IO extraction service returns empty text
    When the IO accumulator folds the span
    Then computedOutput is JSON.stringify(raw) (non-null guarantee preserved)

  # A trace whose top-level span points at a parent that is never exported
  # (e.g. an uninstrumented client) has no span with a null parent. The input
  # then comes from the top-most span present: the earliest-starting one. Its
  # start time rides a reserved summary attribute so the rule holds across
  # batches. Summaries folded before this keep their input until refolded.

  @unit @trace-summary
  Scenario: Input comes from the top-most span when no root span is present
    Given no span in the trace has a null parent
    And a child span with an input is folded first
    When its earlier-starting parent span with an input is folded
    Then computedInput is the parent span's input

  @unit @trace-summary
  Scenario: A later-starting span does not replace the top-most span's input
    Given no span in the trace has a null parent
    And the top-most span's input has been folded
    When a later-starting child span with an input is folded
    Then computedInput is still the top-most span's input

  @unit @trace-summary
  Scenario: A root span's input is never replaced by a non-root span
    Given a root span's input has been folded
    When a non-root span that started earlier is folded
    Then computedInput is still the root span's input

Rule: A launcher's declared input and output win over Claude Code's raw text

  A tool that launches Claude Code (Laze) wraps each request in context the
  agent needs: memory, the sender, the command that answers. The agent then
  answers through a tool call, so its last text is a marker, not the reply.
  The launcher knows both, and declares them on the log records it forwards.

  @unit @trace-summary
  Scenario: A user prompt's declared input replaces the wrapped prompt
    Given a Claude Code user_prompt record whose prompt is a launcher's wrapper
    And the record declares langwatch.input as the request inside it
    When the record's input is read
    Then the trace input is the declared request

  @unit @trace-summary
  Scenario: A declared output is kept over the agent's later closing text
    Given a Claude Code record that declares langwatch.output as the reply the agent posted
    And a later conversational response carries the agent's closing marker
    When both records are folded into the trace summary
    Then the trace output is still the declared reply
