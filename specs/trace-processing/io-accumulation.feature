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
