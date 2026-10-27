# See dev/docs/adr/087-trace-summary-storage-anchor.md for the architectural rationale,
# and dev/docs/adr/071-coding-agent-session-immutable-storage-anchor.md for the rule it applies.
Feature: Trace summaries are filed under a real time, and their span reads stay bounded

  A trace's summary is filed under a time. That time decides which week of storage
  it lives in, when retention discards it, and how much of the store a read has to
  open to find its spans.

  Traces that carry only log records and never a span are a real, supported shape:
  Claude Code and Codex both emit them. Those traces had no span to take a time
  from, so their summaries were filed at the beginning of 1970 - already past their
  retention deadline, and outside every window a read could bound itself to. A read
  for such a trace's spans fell back to opening every week of stored spans, cold
  archive included, which is what exhausted the query memory limit and took
  unrelated queries down with it.

  Background:
    Given a project whose traces are stored and read back

  Rule: A trace summary is filed under a real time it was observed at, and stays there

    @unit
    Scenario: A trace whose only signal is a log record is filed under a real time
      Given a trace that emits log records and never emits a span
      When its summary is written
      Then the summary is filed under the time its first signal was accepted
      And it is not filed under a time so old that retention would already have discarded it
      And the trace still reports no measured duration, because it has no spans

    @unit
    Scenario: A trace whose first contribution is a span is filed under that span's start
      Given a trace whose first contribution is a span
      When its summary is written
      Then the summary is filed under that span's own start time
      And not under the time the span was received

    @unit
    Scenario: A late earlier-starting span moves the trace's reported start, not where it is filed
      Given a trace already filed under its first span's start
      When a span that started earlier arrives late
      Then the trace's reported start moves back to the earlier span
      But the summary stays filed where it was first stored

    @unit
    Scenario: A trace claiming to start years ahead is not filed years ahead
      Given a trace whose reported start time is years in the future
      When its summary is written
      Then it is not filed under that time
      And it is discarded on the normal retention schedule rather than outliving it

  Rule: A summary written before this change keeps its meaning when read back

    @unit
    Scenario: A summary written before the change reports the same start it always did
      Given a trace summary written before filing time was held separately
      When it is read back
      Then it still reports the earliest start its spans reported
      And it is still filed exactly where it already was, so nothing is rewritten

    @unit
    Scenario: A summary written after the change reports its spans' start, not its filing time
      Given a trace summary written after filing time was held separately
      When it is read back
      Then it reports the earliest start its spans reported
      And the time it is filed under is not mistaken for a span's start

    @unit
    Scenario: A trace with no spans reports the time its first signal arrived rather than 1970
      Given a trace whose only signal is a log record
      When the trace is presented to a reader
      Then its start is the time its first signal was accepted
      And it is not presented as having started in 1970

    @unit
    Scenario: The trace list shows the same fallback time, not the epoch
      Given a trace whose only signal is a log record
      When the trace list renders its row
      Then the row's time is the time its first signal was accepted
      # The list once rendered the span baseline raw, so a span-less trace
      # read "20684d ago" in the list and in the drawer header while the
      # single-trace read reported the honest time.

  Rule: A trace summary exists once the trace says something

    Log-only traces are a supported shape, but a log record proves only that
    a process was alive, not that anything happened worth a row. Twelve
    agents dying at login produced twelve span-less summaries with no input,
    no output, no cost and no duration. A summary is stored once the trace
    carries something a reader can see; a content-free record batch stores
    nothing, and the records themselves stay stored and reachable.

    @unit
    Scenario: A content-free log batch persists no summary
      Given a trace whose log records carry no input, output, cost, tokens or model
      When its records are folded
      Then no trace summary is stored

    @unit
    Scenario: A log record carrying content persists the summary
      Given a trace whose log record carries a user prompt as its input
      When the record is folded
      Then the trace summary is stored
      And it reports that input

    @unit
    Scenario: A log record whose only contribution is a cost persists the summary
      Given a trace whose log record carries a cost and no input or output
      When the record is folded
      Then the trace summary is stored

    @unit
    Scenario: A span persists the summary regardless of content
      Given a trace whose first signal is a span
      When the span is folded
      Then the trace summary is stored

  Rule: Reading a page of traces' spans is always bounded in time

    @unit
    Scenario: Spans are read from the weeks the page's traces were filed under
      Given a page of traces whose summaries are all filed under real times
      When their spans are read
      Then the span read is bounded to the weeks those traces were filed under

    @unit
    Scenario: A page whose summaries carry no usable filing time still reads spans within a bounded window
      Given a page of traces whose summaries were all written before this change
      And none of them carries a usable filing time
      When their spans are read
      Then the span read is still bounded to a window
      And it does not open every week of stored spans

    @unit
    Scenario: One trace with no usable filing time does not unbound the whole page
      Given a page of traces where one summary carries no usable filing time
      And the rest carry real ones
      When their spans are read
      Then the span read is bounded by the times the other traces supply
