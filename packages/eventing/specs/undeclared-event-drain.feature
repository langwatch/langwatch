Feature: A worker retries a queued event type it does not declare, so a rolling deploy drains

  During a rolling deploy an older worker can dequeue an event a newer release appended, of a type
  its own pipelines do not declare. The job is retried with the queue's backoff instead of refused,
  so a worker that declares the type takes it; the queue's retry budget is the drain window, and a
  type still undeclared when it is spent is exhausted on its lane's outcome with a reason naming the
  type (dev/docs/ARCHITECTURE.md section 9).

  @unit
  Scenario: An older worker retries a peer-subscriber job whose event type it does not declare
    Given an older worker whose pipelines do not declare the event type a newer release appends
    When it dequeues a peer-subscriber job carrying that event
    Then the job fails retryably with a reason naming the type
    And the handler is not run

  @unit
  Scenario: A retried job is taken by a worker that declares the type
    Given a peer-subscriber job an older worker refused for retry
    When a worker of the newer release dequeues the same job
    Then its handler runs with the event

  @unit
  Scenario: A type still undeclared when the retries are spent is exhausted with a named reason
    Given no worker ever declares the queued event's type
    When the job keeps failing on every attempt
    Then each failure is retryable, so the queue's retry budget bounds the drain window
    And the reason the queue stores on exhaustion names the type

  @unit
  Scenario: A queued event with no type at all is still refused as invalid
    Given a queued job whose event carries no type
    When the worker dispatches it
    Then the job is refused as an invalid queued payload and not retried
