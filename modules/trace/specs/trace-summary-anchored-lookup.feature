Feature: A trace summary lookup is anchored on the event's own time
  Another module reads a trace's folded summary through TraceApi.findSummary while it
  reacts to one of the trace's events. The lookup carries that event's occurredAt and
  trace reads trace_summaries only from three days before it to one day after it, so a
  live span and a replayed old span both read a bounded slice, never every partition.
  The anchor is when the span happened, never wall-clock now.

  @unit
  Scenario: A live span's lookup finds its trace with only bounded reads
    Given a trace whose summary was stored a minute ago
    When a module looks up the summary anchored on a span that happened now
    Then the summary is found
    And every read of trace_summaries is bounded by OccurredAt

  @unit
  Scenario: A replayed 300-day-old span finds its 300-day-old trace with only bounded reads
    Given a trace whose summary was stored 300 days ago
    When a module looks up the summary anchored on that trace's 300-day-old span
    Then the summary is found
    And every read of trace_summaries is bounded by OccurredAt around 300 days ago

  @unit
  Scenario: A lookup anchored far outside its trace's time finds nothing without scanning
    Given a trace whose summary was stored 30 days before the anchor
    When a module looks up the summary anchored on now
    Then no summary is found
    And the one read is bounded by OccurredAt and no unbounded resolve follows the miss

  @unit
  Scenario: A lookup with no anchor behaves as before
    Given a trace whose summary was stored
    When a module looks up the summary without an anchor
    Then the summary is found by resolving its OccurredAt first, as before
