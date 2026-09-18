Feature: ON_MESSAGE evaluations only re-run on real, recent messages
  As the evaluation pipeline
  I want monitors to re-run only when a trace gains genuine new message content and only while the trace is recent
  So that derived enrichments and re-touched historical traces cannot spray thousands of evaluations and starve the queue

  # Context (2026-05-27 incident): the daily topic-clustering pass appends a
  # topic_assigned event to thousands of historical traces. The trigger subscriber
  # treated every trace event as a reason to re-run all ON_MESSAGE monitors, so
  # one clustering pass re-ran 12 monitors over ~863 old traces and saturated
  # ClickHouse. Two guards close it: derived events do not trigger, and old
  # traces are never re-evaluated.

  Background:
    Given a project with an enabled ON_MESSAGE monitor

  @unit
  Scenario: a topic assignment does not re-run evaluations
    Given a trace that already has spans
    When the topic-clustering pass assigns a topic to that trace
    Then no evaluation is dispatched

  @unit
  Scenario: evaluations do not re-run for a trace older than the cutoff
    Given a trace whose first span is older than the evaluation cutoff
    When a new span arrives on that trace
    Then no evaluation is dispatched

  @unit
  Scenario: a new span on a recent trace re-runs evaluations
    Given a recent trace
    When a new span arrives on that trace
    Then an evaluation is dispatched

  Rule: a trace with no recorded spans never re-runs evaluations

    # The trace-age cutoff compares the trace's first-span time against now.
    # A trace whose stored summary sits outside the fold's read window loads
    # as an empty state: no spans, no first-span time. A late origin
    # resolution for such a trace must not slip past the cutoff just because
    # there is no start time to compare. The signal is "no spans folded", not
    # "no start time": a recent span without valid timing also leaves the
    # start time unknown, and that trace must still be evaluated.
    #
    # This rule is scoped to evaluations on purpose: trace alerts run off the
    # same shared trace guards, and a shared chain should not decide the
    # alerting question for both consumers. Scoping is ALL that is claimed
    # here. The alert path on an empty fold is separately broken — trigger
    # filters are matched against that same empty fold state, so a filtered
    # alert fails its confirm and an unfiltered one renders empty content —
    # and the scenario below records that behaviour as it is today, not as
    # what it should be. Tracked on its own issue.

    @unit
    Scenario: a late origin resolution on a trace with no recorded spans does not re-run evaluations
      Given a trace whose fold state holds no spans
      When the trace's origin is resolved
      Then no evaluation is dispatched

    # "Age unknown", not "recent": with no valid first-span time the age cap
    # has nothing to compare and short-circuits, so this trace is dispatched
    # without its age ever being established. That is the accepted trade for
    # keying the rule on spanCount — one real span is the signal — but the
    # scenario must not call the trace recent when nothing here proves it is.
    @unit
    Scenario: a late origin resolution on a trace of unknown age whose span has no valid timing still re-runs evaluations
      Given a trace with one recorded span whose first-span time is unknown
      When the trace's origin is resolved
      Then an evaluation is dispatched

    # Recorded behaviour, not endorsed behaviour: the match is recorded, and
    # what happens after it is the broken part described above.
    @unit
    Scenario: a trace alert still records a match for a trace with no recorded spans
      Given a project with an active trace alert
      And a trace whose fold state holds no spans
      When the trace's origin is resolved
      Then the trace alert records a match
