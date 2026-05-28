Feature: Reactor Outbox for stake-sensitive dispatch

  Some reactors do work that cannot be silently swallowed: sending an
  email, posting a Slack message, writing to a customer dataset. These
  "stake-sensitive" reactors register through `.withOutbox` instead of
  `.withReactor` so that every dispatch attempt is durable, retried with
  backoff, and queryable for operator surfaces.

  Best-effort reactors (UI websockets, fold projections, idempotent
  syncs) keep using `.withReactor` — they do not pay the outbox cost.

  Background:
    Given a pipeline registers a reactor "alertDispatch" via .withOutbox
    And the ReactorOutbox table is empty

  # Enqueueing matches

  Scenario: Reactor enqueues a row instead of dispatching inline
    When the reactor's handler decides a match dispatches
    Then a ReactorOutbox row is created with status "queued"
    And the row carries reactorName, projectId, dedupKey, and payload
    And no side effect (email, Slack, dataset write) has fired yet

  Scenario: Duplicate matches are claimed once
    Given a ReactorOutbox row exists for (reactorName, dedupKey)
    When the same match is observed again (e.g. replay, retry, fan-in)
    Then the second enqueue is a no-op
    And only one row exists for (reactorName, dedupKey)

  # Lease + dispatch

  Scenario: Drainer claims the next queued row atomically
    Given a queued ReactorOutbox row whose nextAttemptAt has elapsed
    When the drainer wakes up for (reactorName, groupKey)
    Then exactly one worker observes status "dispatching"
    And the row carries a leasedUntil timestamp in the future
    And competing drainers see no claimable row

  Scenario: Successful dispatch marks the row "dispatched"
    Given a leased ReactorOutbox row
    When the dispatch endpoint returns success
    Then the row moves to status "dispatched"
    And leasedUntil is cleared
    And the row is retained for operator inspection

  # Retry semantics

  Scenario: Retryable failure schedules a backoff retry
    Given a leased ReactorOutbox row
    When the dispatch endpoint raises a retryable DispatchError
    Then the row moves to status "failed_retryable"
    And attempts is incremented
    And nextAttemptAt is set per exponential backoff
    And lastError records the error message

  Scenario: Non-retryable failure marks the row "dead"
    Given a leased ReactorOutbox row
    When the dispatch endpoint raises a non-retryable DispatchError
    Then the row moves to status "dead"
    And no further attempts are scheduled
    And lastError records the error message

  Scenario: Lease expires when a worker crashes mid-dispatch
    Given a row leased to a worker that never completed
    When the leasedUntil timestamp passes
    Then a future drainer wake-up may re-lease the row
    And attempts is incremented on the re-lease
    And the row is not silently stuck in "dispatching"

  Scenario: Attempts cap promotes a retryable failure to "dead"
    Given a row that has reached the maximum retry count
    When another retryable failure occurs
    Then the row moves to status "dead" rather than "failed_retryable"

  # Wakeup / scheduling

  Scenario: Enqueue sends a wakeup with the row's group key
    When a new row is enqueued
    Then a wakeup payload {reactorName, groupKey} is sent to the GroupQueue
    And the wakeup payload does NOT carry the row's variable-size data
    And the groupKey begins with "${projectId}/" so per-tenant fairness routing works

  Scenario: A groupKey missing the project prefix is rejected at enqueue
    When the producer calls enqueue with a groupKey that does NOT start with "${projectId}/"
    Then enqueue throws before any row is written
    And the contract violation is surfaced to the producer rather than landing in the wrong tenant bucket

  Scenario: Backoff retries schedule a delayed wakeup
    Given a row moved to "failed_retryable" with nextAttemptAt in the future
    When the row is rescheduled
    Then a delayed wakeup is enqueued matching nextAttemptAt
    And the drainer pulls the row only after the delay elapses

  # Replay safety

  Scenario: Replaying past events does not re-dispatch
    Given a pipeline replays historical events
    And those events previously produced ReactorOutbox rows
    When the reactor re-evaluates the same matches
    Then no new rows are created (dedupKey collision)
    And no additional side effects fire

  # Operator surface

  Scenario: Stuck dispatches are queryable per (project, reactor)
    Given rows in statuses "queued", "failed_retryable", and "dead"
    When an operator queries the outbox for a project
    Then rows are filterable by reactorName and status
    And each row exposes attempts, lastError, and timestamps
