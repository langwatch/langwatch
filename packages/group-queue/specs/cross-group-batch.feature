Feature: Cross-group batches
  As the LangWatch worker draining a backed-up queue
  I want ready groups of one handler and one tenant to run as one call
  So that a slot waits on one store write and one fold-state read, not one per group

  # Throughput is slots divided by job latency, and a fold job's latency is mostly
  # waiting: a ClickHouse insert acknowledgement and a fold-state read. One claim
  # already takes several groups; running them as one call shares those waits.
  # Batches fill only from groups already ready, never by waiting past the settling
  # window, and every group keeps its own claim, attempts, order and outcome
  # (ARCHITECTURE §9, Alex 2026-10-16).

  @integration
  Scenario: Sixteen ready groups of one handler run as one call
    Given sixteen groups of one handler and one tenant are ready
    When a worker claims them
    Then one call carries all sixteen groups
    And every group completes

  @integration
  Scenario: Order inside each group is kept
    Given several ready groups each holding jobs in a known order
    When they run as one call
    Then each group's payloads arrive in that order

  @integration
  Scenario: Groups of different tenants never share a call
    Given ready groups of one handler for two tenants
    When a worker claims them
    Then no call carries groups of both tenants

  @integration
  Scenario: Claims from separate listed runs never share a worker slot
    Given three open listed runs holding one ready group each, of three tenants
    And a listed consumer with two slots
    When it claims from every run in one pass
    Then each group runs alone, never in a call with another run's group
    And no more than two groups run at once

  @unit
  Scenario: One failing group is retried alone while the others complete
    Given a cross-group call fails because of one group
    When the call is split in halves until the failure is attributable
    Then only that group fails and is retried
    And every other group completes

  @integration
  Scenario: A failing group in a claimed batch is retried while the rest complete
    Given sixteen ready groups of which one always fails
    When they run as one call
    Then the other fifteen groups complete
    And the failing group is retried on its own

  @unit
  Scenario: A shared overload backs every group off without splitting
    Given a cross-group call fails naming a retry delay
    When the failure is handled
    Then the call is not split
    And every group in it backs off

  @integration
  Scenario: A stale completion is fenced
    Given a group in a running batch was recovered by another worker
    When the batch completes
    Then the recovered group's new claim is left untouched

  @integration
  Scenario: An old and a new worker drain one queue together
    Given a worker that runs every group alone beside one that batches groups
    When both drain the same queue
    Then every job runs exactly once
    And each group's jobs run in order
