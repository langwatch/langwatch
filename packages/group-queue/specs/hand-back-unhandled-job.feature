Feature: GroupQueue hands back a job the worker has no handler for
  As the queue shared by every worker of a rolling deploy
  I want a worker that takes a job it has no handler for to hand it back unspent
  So that an older release's workers never use up a newer release's job's attempts
  or block its group, and a worker that knows the job runs it (Alex, 2026-10-12).

  A hand-back keeps the job's attempt count, records no failure for the group and
  logs at warn. It returns the job ready after a short delay, so the same worker
  does not take it straight back. A job handed back for longer than the hand-back
  window falls back to spending attempts, logged at error, so a kind no worker
  knows still surfaces and is dead-lettered once its attempts are spent.

  @unit
  Scenario: A handed-back job keeps its attempt count and its group is not blocked
    Given a claimed job on its first attempt
    When the handler hands it back because this worker has no handler for it
    Then the job is re-staged ready after a short delay on the same attempt
    And no failure is recorded for its group and the group is not blocked
    And the hand-back is logged at warn

  @integration
  Scenario: Another worker with the handler runs a handed-back job
    Given two workers on one queue, only one of which has the job's handler
    When the worker without the handler takes the job and hands it back
    Then the worker with the handler runs it on its first attempt

  @unit
  Scenario: A job handed back for longer than the window spends attempts at error
    Given a claimed job first handed back longer ago than the hand-back window
    When the handler hands it back again
    Then the job is retried on its next attempt and the failure is counted for its group
    And the queue logs at error that no worker has run it

  @unit
  Scenario: A job whose event type the worker does not declare is handed back too
    Given a worker that has the job's pipeline but does not declare the queued event's type
    When the group queue runs the job on that worker
    Then the refusal reaches the queue as a hand-back that keeps its cause
    And it is handed back under the same window as a job with no handler

  @unit
  Scenario: The hand-back window starts at the first hand-back
    Given a job that has never been handed back
    When a worker hands it back
    Then the window starts now and the job is handed back
    And the start is carried unchanged on every later hand-back and retry
