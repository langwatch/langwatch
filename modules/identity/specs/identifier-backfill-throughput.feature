Feature: Identifier backfill throughput
  As the operator of a cloud fleet with hundreds of thousands of users
  I want the identifier backfill to hand its commands to the queue without waiting on each one
  So that it finishes in a reasonable time and leaves room for live traffic

  # The backfill proves each user from the rows the fold built. A user whose fold has not landed
  # is held on proof, and the next level-triggered pass finalizes them. Proof and hold rules are
  # those of specs/identity/identifier-model.feature, unchanged.

  @unit
  Scenario: The identifier backfill stages each user's commands without waiting for the fold
    Given 1,000 users with a verified address and no backfill yet
    And the worker's queue has not drained
    When the identifier backfill migrates every one of them
    Then each planned write is staged once
    And the projection is never read to wait for a fold
    And no user is finalized before their writes are proven
    When the queue drains and the backfill runs its next pass
    Then nothing is staged again and every user is finalized

  # Pacing (Alex, 2026-10-12): one insert per write stays; the backfill waits for the worker.
  @unit
  Scenario: The identifier backfill holds while the queue is over its limit and resumes as it drains
    Given the group queues hold more waiting jobs than the backfill's limit, 5,000 by default
    When a migration pass reaches its next page of users
    Then it queues no new user until the waiting count is at or under the limit
    And it carries on with every user once the queue has drained

  @unit
  Scenario: An unreadable queue holds the identifier backfill rather than reading as empty
    Given the queue depth cannot be read
    When a migration pass reaches its next page of users
    Then it waits briefly and reads again
    And it queues users only after a read at or under the limit

  # On the worker the pass runs on a queue list of its own and counts only its own jobs, so other
  # steps' backlog never holds it (Alex, 2026-10-12); the whole queue's depth is read only where
  # no listed work runs.
  @unit
  Scenario: A large unrelated backlog does not hold the identifier backfill
    Given the queue holds a million jobs that are not the backfill's
    And the pass runs on a queue list of its own on the worker
    When the pass runs
    Then it waits before each page only for its own jobs to drop to its limit
    And it migrates every user without reading the whole queue's depth
