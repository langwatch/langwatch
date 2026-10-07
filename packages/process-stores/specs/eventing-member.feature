Feature: The eventing member holds one process store in every role
  The producer role holds the process store too, so every role reads and
  writes one process store (Alex, 2026-09-27).

  @unit
  Scenario: The producer role holds the process store too
    Given a process that states the producer role
    When its eventing member is built
    Then the member supplies a process store beside its producer-only event store

  @unit
  Scenario: A registry is handed the role's event read seat like any store
    Given a process whose eventing reads the event log
    When a repository registry reads the event read seat member
    Then it is handed eventing's one-event read seat

  @unit
  Scenario: A role that reads no event log hands a seat that refuses by name
    Given a process whose eventing has no event log, or no eventing at all
    When a repository reads one event through the event read seat member
    Then the read is refused naming the event read seat, and building the member never fails
