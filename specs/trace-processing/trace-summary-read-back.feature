Feature: A trace summary is only continued from a shape this build can read
  As an operator upgrading a running trace-processing deployment
  I want the fold to refuse a summary row written under a different row shape
  So that an upgrade never silently continues a trace from state that was
  never true, and never overwrites the real state with a partial one.

  # Why this exists — ADR-066
  #
  # `trace_summaries` is the trace fold's OWN state, not a report derived from
  # it: the fold reads its last committed row back and carries on from there.
  # A row written before a column existed reads that column back as a
  # ClickHouse default, and a default is indistinguishable from a real value —
  # `ContainsAi = 0` says "no model was called" whether or not one was. Folding
  # onto such a row does not produce a stale read, it produces a WRONG trace,
  # committed at the current shape's stamp, where the check that would have
  # caught it now passes forever.
  #
  # So the row's projection stamp is the discriminator, and the two halves of
  # the answer are inseparable:
  #   - refusing a row this build cannot read, and
  #   - rebuilding that trace from the event log before folding anything new.
  # Refusing WITHOUT the rebuild is worse than not refusing at all: the trace
  # would restart from nothing and its whole accumulated history would be
  # overwritten. The fold refuses to run in that configuration rather than
  # take the risk.
  #
  # Only the CURRENT stamp is readable here, unlike the sibling analytics fold
  # which reads one predecessor. That is a fact about this table's history: the
  # stamp before this one predates the span-flag and prompt columns, whose
  # zero-defaults could each be a real value, so nothing can be concluded from
  # them. The cost is bounded — the platform default retention is far shorter
  # than the age of that stamp, and each surviving trace is rebuilt once and
  # then stored in the current shape.

  Background:
    Given the trace-processing pipeline is running

  Rule: A summary written by the current build is read straight back

    @unit
    Scenario: A trace summary written by the current build is read straight back
      Given a trace whose committed summary carries the current shape
      When a later span arrives for that trace
      Then the fold continues from the committed summary
      And the event log is not read

  Rule: A summary written by an older build is rebuilt, never trusted and never restarted

    @unit
    Scenario: A trace summary an older build wrote is refused rather than decoded
      Given a trace whose committed summary was written under an older shape
      When the fold reads the summary back
      Then no summary is returned
      And the read is reported as a refusal rather than a missing row

    @unit
    Scenario: A refused trace summary is rebuilt from the event log, not restarted
      Given a trace whose committed summary was written under an older shape
      When a later span arrives for that trace
      Then the trace is rebuilt from its recorded history
      And every span the trace ever had is still counted
      And a detail the older shape could not record is recovered
      And the rebuilt summary is stored in the current shape
