Feature: A trace summary lookup is anchored on the event's own time
  Another module reads a trace's folded summary through TraceApi.findSummary while it
  reacts to one of the trace's events. The lookup carries that event's occurredAt and
  trace searches trace_summaries outward from it in adjacent slices: three days back to
  one day forward, then 3 to 7, 7 to 21 and 21 to 30 days back. It stops at the first
  hit; a miss at 30 days is final, having read 31 days once. Every step is a bounded
  read, never every partition. The anchor is when the span happened, never wall-clock
  now. A caller retrying a live trace may ask for the first slice only.

  @unit
  Scenario: A trace found in the narrowest window takes one read
    Given a trace whose summary was stored a minute ago
    When a module looks up the summary anchored on a span that happened now
    Then the summary is found
    And trace_summaries was read once, bounded to three days back and one day forward

  @unit
  Scenario: A trace 20 days before its anchor is found on the 21-day step
    Given a trace whose summary was stored 20 days before the anchor
    When a module looks up the summary anchored on now
    Then the summary is found
    And trace_summaries was read three times, reaching 3, 7 and 21 days back
    And each read began where the one before it ended, so no day was read twice

  @unit
  Scenario: A trace 40 days before its anchor is final not-found after the 30-day step
    Given a trace whose summary was stored 40 days before the anchor
    When a module looks up the summary anchored on now
    Then no summary is found
    And trace_summaries was read four times, reaching 3, 7, 21 and 30 days back
    And the four reads together covered 31 days, each day once
    And no resolving read follows the miss

  @unit
  Scenario: A replayed 300-day-old span finds its 300-day-old trace with only bounded reads
    Given a trace whose summary was stored 300 days ago
    When a module looks up the summary anchored on that trace's 300-day-old span
    Then the summary is found
    And every read of trace_summaries is bounded by OccurredAt around 300 days ago

  @unit
  Scenario: No anchored lookup ever makes an unbounded read
    Given traces stored from a minute to 300 days before their anchors
    When a module looks up each summary anchored on its span
    Then every read of trace_summaries is bounded by OccurredAt
    And no lookup reads more than four times or further than 30 days back

  @unit
  Scenario: A lookup with no anchor behaves as before
    Given a trace whose summary was stored
    When a module looks up the summary without an anchor
    Then the summary is found by resolving its OccurredAt first, as before

  @unit
  Scenario: A lookup that does not widen reads only the first slice
    Given a trace whose summary was stored 20 days before the anchor
    When a module looks up the summary anchored on now, asking it not to widen
    Then no summary is found
    And trace_summaries was read once, bounded to three days back and one day forward

  @unit
  Scenario: The evaluation trigger's lookup is anchored on the span and widens
    Given a span of a trace that began more than 3 days before it
    When the evaluation trigger looks up the trace's summary
    Then the lookup is anchored on the span's own time and may widen
    And a late span of a long trace is still evaluated

