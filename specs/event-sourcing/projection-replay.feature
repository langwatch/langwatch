Feature: Projection replay

  Operators can rebuild a projection's stored output from the event history
  without losing live events. While a replay is running, live processing for
  the affected aggregates is coordinated against a snapshot cutoff: history up
  to the cutoff is rebuilt by the replay, and anything newer is held back
  until the replay finishes, so the projection ends up consistent with both
  the historical events and the live stream.

  Background:
    Given a registered map projection "spanStorage" for aggregate type "trace"

  Scenario: Replaying a map projection rebuilds its records from history
    Given aggregates with existing event history
    When an operator starts a replay of the "spanStorage" projection
    Then live processing for the affected aggregates is paused
    And a cutoff is taken marking the last historical event covered by the replay
    And the projection's records are rewritten from the event history up to the cutoff
    And live processing resumes once the replay completes

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
    And live processing for both projections resumes once the replay completes
