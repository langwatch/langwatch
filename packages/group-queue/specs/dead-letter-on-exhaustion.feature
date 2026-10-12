Feature: A spent job can be dead-lettered instead of blocking its group
  As the LangWatch event-sourcing queue processing per-aggregate FIFO groups
  I want a registration whose order is not load-bearing to dead-letter a job that exhausts its
  retries or fails non-retryably, while every other registration keeps blocking
  So that one bad trace span never holds back the rest of its trace, and an operator can still
  redrive it from the dead-letter queue once its cause is fixed.

  The dead-letter layout (`<queue>:gq:dlq` and `dlq:<groupId>:jobs|data|error`) is owned by the
  group queue; ops lists, redrives and discards it through the queue's exported helpers.
  Rulings: dev/docs/ARCHITECTURE.md section 9 (Alex, 2026-09-30).

  @integration
  Scenario: A dead-lettering group keeps draining past a failed job
    Given a queue whose jobs dead-letter when spent
    And a group holding a job that fails non-retryably followed by a healthy job
    When the worker processes the group
    Then the healthy job runs
    And the failed job sits in the group's dead-letter entries with its error
    And the group is not blocked

  @integration
  Scenario: A queue that names no outcome still blocks the group
    Given a queue with no exhaustion outcome declared
    And a group holding a job that fails non-retryably followed by a healthy job
    When the worker processes the group
    Then the group is blocked with the failed job re-staged
    And the healthy job does not run

  @integration
  Scenario: A coalesced batch dead-letters only the payload bisection isolated
    Given a queue whose jobs dead-letter when spent and coalesce into batches
    And a batch in which one payload fails on every attempt
    When the batch exhausts its budget
    Then only that payload is dead-lettered
    And the rest of the batch runs

  @integration
  Scenario: A dead-lettered job is redriven by the operator
    Given a job the queue dead-lettered
    And its cause has since been fixed
    When the operator redrives its group from the dead-letter queue
    Then the job runs
    And the group leaves the dead-letter queue
