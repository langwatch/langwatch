Feature: Projection replay

  Operators can rebuild a projection's stored output from the event history
  without losing live events. While a replay is running, live processing for
  the affected aggregates is coordinated against a snapshot cutoff: history up
  to the cutoff is rebuilt by the replay, and anything newer is held back
  until the replay finishes, so the projection ends up consistent with both
  the historical events and the live stream.

  # Related ADRs: 015 (projection replay coordination)

  Background:
    Given a registered map projection "spanStorage" for aggregate type "trace"

  Scenario: Replaying a map projection rebuilds its records from history
    Given aggregates with existing event history
    When an operator starts a replay of the "spanStorage" projection
    Then live processing for the affected aggregates is paused
    And a cutoff is taken marking the last historical event covered by the replay
    And the projection's records are rewritten from the event history up to the cutoff
    And live processing for those aggregates resumes as soon as their batch is replayed

  Scenario: Live events at or before the cutoff are skipped during replay
    Given a replay of the "spanStorage" projection is in progress
    When a live event arrives that is at or before the replay cutoff
    Then the live handler does not write a record for that event
    And the replay produces the record for that event instead

  Scenario: Live events after the cutoff are deferred until the replay completes
    Given a replay of the "spanStorage" projection is in progress
    When a live event arrives that is after the replay cutoff
    Then the event is not processed immediately
    And it is retried until the replay for its aggregate completes
    And it is then processed normally

  Scenario: Resuming an interrupted replay skips completed aggregates
    Given a replay of the "spanStorage" projection was interrupted partway through
    And some aggregates were already fully replayed
    When the operator resumes the replay
    Then aggregates that already completed are not replayed again
    And the remaining aggregates are replayed to completion

  Scenario: Replaying fold and map projections together
    Given a registered fold projection "traceSummary" for aggregate type "trace"
    When an operator starts a replay covering both "traceSummary" and "spanStorage"
    Then each projection's output is rebuilt from the same event history
    And live events for the affected aggregates are skipped or deferred for both projections
    And live processing for both projections resumes as soon as each batch is replayed

  Scenario: Only the batch being replayed pauses live processing
    Given a replay of the "spanStorage" projection spanning multiple batches
    When the replay works through its batches
    Then live processing is paused only while a batch is being replayed
    And live processing resumes between batches
    And live processing is never paused for the whole run at once

  Scenario: A batch failure resumes live processing
    Given a replay of the "spanStorage" projection is in progress
    When a batch fails partway through
    Then the replay stops and reports the failure
    And live processing for the affected projections resumes
    And live events for the failed batch's aggregates are processed normally right away

  Scenario: Rebuilt records are written in bulk
    Given aggregates with existing event history across many traces
    When the replay rebuilds the "spanStorage" projection
    Then rebuilt records land in large batched writes per tenant
    And the rebuild does not wait on one write per trace

  Scenario: A long replay keeps reporting progress until it finishes
    Given a replay is running for longer than its coordination lock's initial lifetime
    When the run continues past that lifetime
    Then progress and cancellation keep working for the whole run
    And this holds even when a single batch takes longer than that lifetime
