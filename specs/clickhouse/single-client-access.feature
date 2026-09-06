Feature: One ClickHouse client, reached one way, bounded where it can be seen

  Every statement this platform sends to ClickHouse goes through one client
  built in one place, and reaches its caller through a repository that the
  application object hands out. That is two rules with one purpose: a policy
  added to the client — bounded concurrency, retries, tenant scoping, logging,
  metrics — applies everywhere the moment it is added, and cannot be bypassed by
  a caller that constructs its own client or reaches around the repository.

  The bound matters most. A connection pool caps sockets, not statements. Work
  arrives from queues whose concurrency is set somewhere else entirely, so a
  process will happily try to run far more statements than it has sockets, and
  the surplus waits inside the pool: no timeout, no metric, no upper bound on
  the wait. The server then admits more than it can serve, rejects, and the
  retries go back into the same wall. Bounding the statements instead — with a
  queue that is finite and refuses when it is full — turns that invisible
  latency cliff into a refusal somebody can see, count, and alert on.

  Background:
    Given the platform is configured with a ClickHouse instance

  @unit
  Scenario: every client is built the same way
    Given the shared instance and a customer's own instance are both configured
    When the platform builds a client for each
    Then both carry the same concurrency bound, retry policy, logging and metrics
    And neither was assembled by hand at its call site

  @unit
  Scenario: statements are bounded, and the bound is the one that binds
    Given more statements are issued at once than the bound allows
    When the surplus statements are issued
    Then the statements beyond the bound wait for a slot rather than reaching the server
    And the number waiting and the number in flight are both reported

  @unit
  Scenario: a slot is held across retries, not taken per attempt
    Given a statement that fails transiently and is retried
    When the retry runs
    Then it keeps the slot it already holds
    And it does not rejoin the queue behind statements that arrived later

  @unit
  Scenario: an overloaded process refuses rather than queueing without limit
    Given the wait queue is already full
    When another statement is issued
    Then it is refused immediately with an error that names overload as the cause
    And the refusal is counted so the operator can see the platform shedding

  @unit
  Scenario: a caller that gives up stops waiting
    Given a statement is waiting for a slot
    When the caller abandons the request
    Then the statement leaves the queue instead of occupying it until a slot frees

  # The queue was bounded by depth but not by time, so a statement could wait
  # for as long as everything ahead of it took and THEN still spend the driver's
  # full request timeout on the wire. That is how a 46-second failure was
  # assembled out of two limits, neither of which was 46 seconds. Refusing is
  # not losing: overload classifies as transient, so a read retries and a job is
  # re-staged.
  @unit
  Scenario: a statement that waits too long is refused, not left waiting
    Given a statement is waiting for a slot
    When no slot frees before the wait bound elapses
    Then it is refused with an error that names overload as the cause
    And the refusal is classified as recoverable, so the job is re-staged rather than dropped
    And the statement already running is left alone
    And the wait bound is shorter than the time one statement may spend on the wire

  # Sizing the bound is where this went wrong in practice. The budget was read
  # as one server's allowance and then divided across the whole fleet, but the
  # cluster runs several nodes and the fleet's statements spread over all of
  # them. Dividing a single node's allowance by every pod understated the real
  # capacity by roughly the node count, so the platform throttled itself —
  # waiting seconds for a slot and refusing work — while the cluster sat mostly
  # idle and rejected nothing. A budget that is wrong in the safe direction is
  # still wrong: it produces refusals nobody can act on, and a warning that
  # fires forever teaches everyone to ignore it.
  Rule: The bound is sized from the cluster's real capacity

    @unit
    Scenario: The budget counts every node the cluster runs
      Given a cluster of several nodes each allowing the same number of concurrent queries
      When the platform sizes each process's bound
      Then the budget it divides is the whole cluster's capacity, not one node's
      And a fleet of the same size is allowed a proportionally larger bound

    @unit
    Scenario: A single-node cluster is sized exactly as before
      Given a deployment that does not say how many nodes its cluster has
      When the platform sizes each process's bound
      Then it assumes one node
      And the bound is the same one it chose before the cluster size was considered

    @unit
    Scenario: An operator override beyond the cluster budget is reported, not silently obeyed
      Given an operator sets a bound larger than the cluster budget allows
      When the platform sizes each process's bound
      Then it uses the operator's number
      And it reports that the fleet may exceed the cluster's concurrent-query budget

    @unit
    Scenario: An override within the corrected budget is not reported as excessive
      Given an operator sets a bound the cluster's full capacity can afford
      When the platform sizes each process's bound
      Then it uses the operator's number
      And it does not warn that the budget is exceeded

  @unit
  Scenario: ClickHouse is reached through a repository, from the application object
    Given a service needs data that lives in ClickHouse
    When it asks for that data
    Then it asks a repository it obtained from the application object
    And it never holds a ClickHouse client of its own

  @unit
  Scenario: a new bypass cannot be introduced unnoticed
    Given a change adds a direct ClickHouse client to a service, route or worker
    When the test suite runs
    Then the change fails a test that names the file and the rule it broke
