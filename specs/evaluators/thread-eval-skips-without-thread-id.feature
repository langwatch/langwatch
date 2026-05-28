Feature: Thread-based evaluations skip traces that have no thread_id
  As the evaluation pipeline
  I want a thread-based monitor to skip a trace that has no thread_id
  So that a misconfigured thread monitor on non-thread traces cannot error or fold doomed result events

  # Context: a bulk re-evaluation enabled thread-based monitors over historical
  # traces that carry no thread_id. Every such evaluation used to attempt
  # thread-data building, throw, and emit an error result whose projection fold
  # is expensive. Skipping a thread evaluation that can never succeed runs no
  # evaluator and emits no event, so the whole class stays quiet. The span reads
  # that precede the skip are separately bounded by a per-trace ceiling, so even
  # a leaked trace_id cannot make them heavy.

  Background:
    Given a project with a thread-based monitor enabled

  Scenario: a thread-based monitor skips a trace without a thread_id
    Given a trace that has no thread_id
    When the pipeline executes the thread-based monitor for that trace
    Then the evaluation is skipped
    And the evaluator is not called

  Scenario: a skipped thread evaluation emits no result event
    Given a trace that has no thread_id
    When the pipeline executes the thread-based monitor for that trace
    Then no evaluation result event is emitted

  Scenario: a thread-based monitor still runs for a trace with a thread_id
    Given a trace that has a thread_id
    When the pipeline executes the thread-based monitor for that trace
    Then the evaluation runs normally
