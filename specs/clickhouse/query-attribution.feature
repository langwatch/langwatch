Feature: A failed analytics query can be traced back to the query that failed

  When an analytics query fails in production, the first question is always
  "which query?" — and until now nothing could answer it. The failure arrives as
  a log line carrying the driver's generic wording and nothing else: the
  statement, the table, the tenant and the driver's own identifier for the query
  are all attached to the record the application writes, and all of them are
  dropped before the line is stored. The storage keeps its own log of every
  query it ran, which holds the statement, how much it read and how much memory
  it took, but that log is keyed by an identifier the application never chose
  and never recorded, so the two cannot be lined up.

  So the query is described where descriptions survive: on the trace. Every
  query and insert records what it ran, against what table, and under which
  identifier, and that identifier is one WE choose and send — which is what
  makes the storage's own record of the same query findable afterwards.

  Scenario: a query is described on the trace
    When a query runs against analytics storage
    Then the trace records the statement, the table and the operation

  Scenario: a failed query is described on the trace with its failure
    When a query runs against analytics storage and fails
    Then the trace records the statement, the table and the operation
    And it records the failure alongside them

  Scenario: the identifier the application sends is the one it records
    When a query runs against analytics storage
    Then the application chooses the query's identifier rather than letting the
      driver generate one
    And the trace records that same identifier
    And the storage's own log of that query can be found by it

  Scenario: an insert is described the same way as a query
    When an insert runs against analytics storage
    Then the trace records the table, the operation and the identifier

  Scenario: describing a query never breaks the query
    Given recording the description fails
    When a query runs against analytics storage
    Then the query still runs and returns its result

  Scenario: a retried attempt is not reported as a failure
    Given a query fails once with a transient condition and succeeds when retried
    When the query runs against analytics storage
    Then the recovered attempt is reported as a retry, not as an error
    And only a query that fails after its retries are exhausted is reported as
      an error
