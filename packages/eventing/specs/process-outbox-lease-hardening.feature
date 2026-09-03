Feature: Process outbox lease hardening
  As an operator of the process-manager substrate
  I want lease lapses to be visible, bounded, and self-limiting
  So that a slow intent handler degrades gracefully instead of wedging its domain.

  A dispatcher leases a bounded batch and delivers it sequentially. It must
  never start work that cannot finish inside the remaining lease, and a stale
  acknowledgement must remain fenced and observable.

  Background:
    Given a process store with pending outbox messages for one process manager

  @integration @fencing
  Scenario: A lease-lapsed acknowledgement is counted, never silent
    Given a dispatcher leased a message and its lease expired mid-handling
    And a second dispatcher re-leased the same message
    When the first dispatcher's acknowledgement lands
    Then the message row is not modified by the stale acknowledgement
    And the delivery is reported as fenced, not as dispatched
    And a fenced outcome is counted for the process

  @integration @lease-budget
  Scenario: A batch running out of lease releases its tail instead of dispatching past it
    Given a leased batch whose earlier deliveries consume nearly the whole lease
    When the dispatcher reaches the remaining messages of the batch
    Then the remaining messages are released without invoking their handlers
    And the released messages are immediately leasable by any dispatcher
    And no delivery starts on a lease that is about to lapse

  @integration @retirement
  Scenario: A message that keeps lapsing its lease retires instead of retrying forever
    Given a message that was leased the maximum number of attempts without any acknowledgement
    When a dispatcher leases it again
    Then the message is retired as dead without invoking the handler
    And the retirement is logged and counted

  @unit @stuck-drain
  Scenario: A never-settling delivery cannot wedge a worker's drain loop
    Given a drain whose dispatch never settles
    When the stuck-drain threshold passes
    Then the worker abandons the stuck drain and resumes polling
    And the abandonment is counted
    And a drain that is merely slow but under the threshold is not abandoned

  @unit @poll-phase
  Scenario: Outbox workers registered together do not poll in lockstep
    Given several process managers whose outbox workers start in the same tick
    When each worker arms its recovery poll
    Then each worker's poll is phase-shifted by its own fraction of one interval
    And no two workers registered together lease on the same schedule

  @unit @attempt-accounting
  Scenario: Attempt counting survives crashes between delivery and acknowledgement
    Given a message whose delivery crashed after the handler ran but before the acknowledgement
    When the lease lapses and another dispatcher leases the message
    Then the new delivery carries a higher attempt number
    And first-attempt dispatch lag is observed exactly once per message
