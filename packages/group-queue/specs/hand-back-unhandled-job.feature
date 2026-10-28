Feature: GroupQueue hands back a job the worker has no handler for
  As the queue shared by every worker of a rolling deploy
  I want a worker that takes a job it has no handler for to hand it back unspent
  So that an older release's workers never use up a newer release's job's attempts
  or block its group, and a worker that knows the job runs it (Alex, 2026-10-12).

  A hand-back keeps the job's attempt count, records no failure for the group and
  logs at warn. It returns the job ready after a short delay and adds the worker
  that handed it back to the group's record. Each worker in the record passes the
  group over for two signal waits from its own hand-back, so a peer asleep in its
  wait claims the job first; meanwhile it waits for that pass-over to lapse rather
  than polling the group. The job's completion clears the record. Each entry's
  expiry is the only other bound: the only worker, or one whose peers are gone,
  takes the job back once its own entry lapses. A job handed back for longer than
  the hand-back window falls back to spending attempts, logged at error, so a kind
  no worker knows still surfaces and is dead-lettered once its attempts are spent
  (#9148).

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

  @integration
  Scenario: A worker with the handler, asleep when the job is handed back, runs it first
    Given a worker with the job's handler, asleep in its signal wait while another worker holds the job
    When the worker without the handler hands the job back
    Then the worker with the handler runs it on its first attempt
    And the job is handed back only once

  @integration
  Scenario: Every worker that handed a job back passes it over, so the worker with the handler runs it
    Given two workers without the job's handler and one with it
    When each worker without the handler has handed the job back
    Then neither of them claims it again
    And the worker with the handler runs it on its first attempt

  @integration
  Scenario: The worker that handed a job back passes over that group only
    Given a worker that handed back the job of one group while another group has a job ready
    When that worker claims
    Then it claims the other group's job
    And the handed-back job stays ready for another worker
    And the claim says when that worker's pass-over lapses

  @unit
  Scenario: The worker that handed a job back waits out its pass-over instead of polling
    Given the worker's last claim passed over a group that is due
    When it waits for its next signal
    Then it waits until the pass-over lapses, or a group due after that claim comes due
    And it does not poll at the shortest interval

  @unit
  Scenario: A listed run's worker that handed a job back waits out its pass-over instead of polling
    Given the worker's last claim from a listed run passed over a group that is due
    When it waits for its next poll
    Then it waits until the pass-over lapses, or a candidate due after that claim comes due
    And the group stays due for every other worker

  @integration
  Scenario: Each worker's pass-over lapses on its own
    Given a job two workers handed back, one of them with a short pass-over
    When that worker's pass-over lapses
    Then that worker claims the job on the same attempt
    And the other still passes it over

  @integration
  Scenario: A completion clears the hand-back record
    Given a job one worker handed back
    When another worker claims it and completes it
    Then the group holds no record of who handed it back
    And the worker that handed it back claims the group's next job

  @integration
  Scenario: An ordinary retry is not passed over
    Given a job re-staged by a retry, not a hand-back
    When the worker that retried it claims after the backoff
    Then it claims the job again

  @integration
  Scenario: The only worker, or one whose peers are gone, takes back a job it handed back once its pass-over lapses
    Given one worker on the queue, with no handler for the job
    When it hands the job back
    Then it takes the job again only after two signal waits
    And the job is still on its first attempt
