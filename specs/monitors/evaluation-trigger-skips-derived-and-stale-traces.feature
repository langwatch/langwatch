Feature: ON_MESSAGE evaluations only re-run on real, recent messages
  As the evaluation pipeline
  I want monitors to re-run only when a trace gains genuine new message content and only while the trace is recent
  So that derived enrichments and re-touched historical traces cannot spray thousands of evaluations and starve the queue

  # Context (2026-05-27 incident): the daily topic-clustering pass appends a
  # topic_assigned event to thousands of historical traces. The trigger reactor
  # treated every trace event as a reason to re-run all ON_MESSAGE monitors, so
  # one clustering pass re-ran 12 monitors over ~863 old traces and saturated
  # ClickHouse. Two guards close it: derived events do not trigger, and old
  # traces are never re-evaluated.

  Background:
    Given a project with an enabled ON_MESSAGE monitor

  Scenario: a topic assignment does not re-run evaluations
    Given a trace that already has spans
    When the topic-clustering pass assigns a topic to that trace
    Then no evaluation is dispatched

  Scenario: evaluations do not re-run for a trace older than the cutoff
    Given a trace whose first span is older than the evaluation cutoff
    When a new span arrives on that trace
    Then no evaluation is dispatched

  Scenario: a new span on a recent trace re-runs evaluations
    Given a recent trace
    When a new span arrives on that trace
    Then an evaluation is dispatched
