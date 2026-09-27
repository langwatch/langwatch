Feature: The eventing member holds one process store in every role
  The producer role holds the process store too, so every role reads and
  writes one process store (Alex, 2026-09-27).

  @unit
  Scenario: The producer role holds the process store too
    Given a process that states the producer role
    When its eventing member is built
    Then the member supplies a process store beside its producer-only event store
