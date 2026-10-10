Feature: The ClickHouse member bounds what it sends to the server

  Every process sizes its ClickHouse pool from the server's stated budget, as
  main's managed client did, and holds each statement to a slot sized from that
  pool. A burst larger than the server allows queues in the process instead of
  failing on the server with TOO_MANY_SIMULTANEOUS_QUERIES.

  @integration
  Scenario: A burst over the server's cap queues within the resolved pool size
    Given a server that states a cap of 25 concurrent queries
    When a module sends 40 statements at once
    Then at most 17 statements reach the server at the same time
    And every statement is answered

  @integration
  Scenario: A stated statement bound below the pool size binds instead
    Given a process that bounds its statements at 3 in flight
    When a module sends 12 statements at once
    Then at most 3 statements reach the server at the same time

  @integration
  Scenario: A statement the server refused as too many simultaneous queries is retried
    Given a server that refuses statements over 25 at once and a process that does not state that cap
    When a module sends 40 statements at once
    Then the refused statements are retried with backoff, as main's resilient client did
    And every statement is answered

  @integration
  Scenario: Statements parse ISO timestamps
    Given a module writing a row whose DateTime64 columns hold ISO timestamps
    When the statement reaches the server
    Then it carries date_time_input_format best_effort, as main's managed client did

  # Main refused a statement that could not get a slot in time rather than leave it waiting past
  # its caller (origin/main statementLimit.ts): a wait of at most 20 seconds, a queue of
  # max(64, slots x 8). The refusal is the 503 clickhouse_overloaded, which the event-sourcing
  # classifier reads as transient. Its HTTP body follows the 5xx rule in transport-conventions.
  Rule: A statement that cannot get a slot is refused as overloaded, as main refused it

    @integration
    Scenario: A statement that waits past the deadline for a slot is refused as overloaded
      Given a process bounded at 1 statement in flight, with one statement holding the slot
      When another statement waits 20 seconds without a slot freeing
      Then it is refused with clickhouse_overloaded at 503, a platform fault marked retryable
      And it never reaches the server
      And the statement holding the slot still completes

    @integration
    Scenario: A statement beyond a full wait queue is refused at once
      Given a process bounded at 1 statement in flight, whose wait queue of 64 is full
      When one more statement is sent
      Then it is refused at once with clickhouse_overloaded and never reaches the server

    @integration
    Scenario: An overloaded refusal is transient, so a job re-stages it rather than dropping it
      Given a statement the process refused as overloaded
      When the event-sourcing error classifier reads it
      Then it is recoverable
