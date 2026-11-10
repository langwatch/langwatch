Feature: A process event that loses a revision race is retried in place
  As an operator reading worker error spans
  I want a process manager event that races another commit to be re-applied quietly
  So that an ordinary optimistic-concurrency loss is neither an error nor a queue retry

  # Why this exists (prod, 2026-10-22)
  #
  # About 3k error spans per 3h read 'Process manager "refusedOrganizations"
  # revision conflict on event ...'. Each refused organization's wake fires
  # every five minutes and queues a recount delayed by five minutes, so the
  # recount's month_counted event reaches the process within milliseconds of
  # the next wake. The wake commits first, the event's commit loses the
  # compare-and-swap, the delivery throws, and the queue retries it three
  # seconds later, when it succeeds. Nothing was lost; the error was noise.
  #
  # Signals already retried a lost compare-and-swap against the winning
  # revision. Events now do the same. Evolution is pure, so re-reading and
  # re-evolving is safe, and the inbox check runs again on each attempt.

  @unit
  Scenario: An event that loses a revision race is re-applied to the winning revision
    Given a process instance at some revision
    And another commit lands between the event's read and its write
    When the process manager handles the event
    Then it re-reads the instance and evolves the event against the winning revision
    And the event commits without failing its delivery

  @unit
  Scenario: A race won by the same event stands down as a duplicate
    Given a redelivery of the same event commits first
    When the losing delivery retries
    Then it reports a duplicate and applies the event only once

  @unit
  Scenario: An event that keeps losing its revision race is handed back to the queue
    Given every commit attempt loses to a competing commit
    When the bounded in-place retries are spent
    Then the conflict is reported without changing the state
    And the delivery fails so the queue retries it with backoff
