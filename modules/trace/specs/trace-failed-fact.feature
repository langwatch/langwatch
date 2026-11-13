Feature: A trace that becomes failed is recorded once, by trace's own rule

  Trace decides whether a trace failed: any of its spans with an error status, an exception or
  error.has_error marks the trace summary failed (containsErrorStatus). Peers that count failed
  traces (nurturing's per-email usage) read that decision from one fact, lw.trace.trace_failed,
  instead of keeping their own copy of the rule. The fact is recorded once per trace: a span
  that finds the trace failed records it, later spans of the trace record nothing more. A trace
  only counts as newly failed within an hour of its first span, so a span re-emitted by a
  replay or resync, or one that arrives hours later, never records it again: the fact's
  idempotency key is collapsed only when the log is read, so a second append would still reach
  every peer subscriber. The fact carries
  the trace's origin, so a peer can leave samples and Langy's turns out.

  @unit
  Scenario: A child span's error makes the trace failed and records trace_failed
    Given a trace whose root span succeeded
    When a child span with an error status is folded into its summary
    Then the trace counts as newly failed
    And trace records trace_failed with its project, trace, the failing span's time and origin

  @unit
  Scenario: A trace without an error records nothing
    Given a trace whose spans all succeeded
    When its spans are folded
    Then the trace does not count as newly failed

  @unit
  Scenario: Later spans of a failed trace record nothing more
    Given a trace already recorded failed
    When more of its spans arrive, failing or not
    Then they share the first span's deduplication key, held past the window
    And trace_failed is not recorded again

  @unit
  Scenario: A span outside the hour records nothing
    Given a failed trace
    When a span arrives over an hour after the trace's first span, or over an hour after its append
    Then the trace does not count as newly failed

  @unit
  Scenario: The trace_failed fact is keyed by its project and trace
    Given trace_failed is recorded for two traces of one project
    Then each fact's aggregate is its project and trace, so neither waits for the other
    And a resent fact carries the same idempotency key
