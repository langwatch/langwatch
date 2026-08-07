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
    And the statement already running is left alone
    And the wait bound is shorter than the time one statement may spend on the wire

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
