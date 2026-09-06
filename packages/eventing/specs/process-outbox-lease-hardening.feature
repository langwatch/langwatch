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

  @unit @claim-connection
  Scenario: Claiming due messages does not hold an interactive transaction open
    Given a process running one outbox worker per process manager on a shared connection pool
    When a worker claims its due messages
    Then the claim is issued as a single locking statement
    And no interactive transaction is opened for it
    And a poll cannot fail for want of a transaction slot while the pool has connections

  # outboxDispatcherService.ts, processOutboxWorker.ts, processWakeWorker.ts,
  # failureDiagnostic.ts, commandDispatcher.ts, process-manager-maintenance.pipeline.ts

  @integration @unimplemented
  Scenario: An outbox message is dispatched exactly once across two workers
    Given two workers polling the same outbox
    When one message becomes due
    Then it is dispatched once

  @integration @unimplemented
  Scenario: A dispatcher that dies mid-send releases its claim for another worker
    Given a worker holding a claim on an outbox message
    When that worker stops without finishing
    Then the message becomes claimable again after its lease elapses

  @integration @unimplemented
  Scenario: A dispatch that runs longer than its lease does not send twice
    Given a dispatch still running when its lease elapses
    When another worker claims the message
    Then the recipient receives the message once

  @unit @unimplemented
  Scenario: A message that fails repeatedly stops being retried and is reported
    Given an outbox message whose dispatch keeps failing
    When it reaches its attempt ceiling
    Then it stops being retried and its failure is reported with a diagnosis

  @unit @unimplemented
  Scenario: A wake scheduled for a process that no longer exists is discarded
    Given a wake for a completed process instance
    When the wake worker runs
    Then the wake is discarded without error

  @unit
  Scenario: A message already leased by one dispatcher is not dispatched again by another
    Given a dispatcher holding the lease on a message mid-delivery
    When a second dispatcher runs
    Then it does not dispatch that message
