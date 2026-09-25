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
