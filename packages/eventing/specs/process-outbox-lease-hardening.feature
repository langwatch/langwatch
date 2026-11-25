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

  @integration @fencing
  Scenario: Two acknowledgements of one lease: the second is refused
    Given a dispatcher leased a message
    When its delivery is acknowledged as dispatched and as failed at the same moment
    Then the message row carries the first acknowledgement
    And the second is reported as not applied
    # The second waits on the first's row lock and re-reads the lease and the
    # status as the first left them, rather than deciding on the row as it
    # read it before the wait.

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

  @unit @stuck-drain
  Scenario: A drain still renewing its lease is never taken for stuck
    Given a drain whose delivery runs for an hour and renews its lease throughout
    When the stuck-drain threshold passes many times over
    Then the worker raises no stuck-drain alarm
    And a drain that stops renewing is abandoned once the threshold passes with no progress

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

  @unit @lease-renewal
  Scenario: A long-running intent keeps its lease while it runs
    Given a dispatcher delivering a message whose handler runs for an hour on a short lease
    And the handler calls a repository every minute
    When other dispatchers poll while the handler runs
    Then the holder renews its lease every third of the lease length
    And no other dispatcher leases the message while the handler runs
    And the delivery is acknowledged as dispatched once the handler finishes

  @unit @lease-renewal
  Scenario: A handler silent past its limit loses its lease and the message is redelivered
    Given a dispatcher delivering a message whose handler awaits nothing through its dependencies
    And a silence limit of 5 minutes unless the process manager sets its own
    When the silence limit passes
    Then the holder stops renewing the lease and logs a warning naming the process and message
    And once the lease lapses another dispatcher leases and delivers the message
    And a handler that keeps calling a repository past the same limit keeps its lease
    And a hung handler whose only activity is a lock renewal armed outside the delivery loses its lease

  @unit @lease-renewal
  Scenario: Only calls made inside a delivery mark its progress
    Given a repository tracked for delivery progress and shared by two running deliveries
    When one delivery calls it
    Then that delivery's progress is marked when the call starts and when it settles
    And the other delivery's progress is not marked
    And a call made outside any delivery marks nothing and passes straight through

  @unit @lease-renewal
  Scenario: A crashed worker's intent is taken again within one short lease
    Given a worker that leased a message and died without renewing it
    When one lease length has passed
    Then another dispatcher leases and delivers the message
    And the new delivery is charged a further attempt
    And a message whose crashes used every attempt retires as dead

  @unit @lease-renewal
  Scenario: A worker whose lease was taken over does not record its result
    Given a worker whose renewals failed until another dispatcher leased its message
    When its next renewal is refused
    Then it stops renewing
    And neither its handler's success nor its failure is written to the message
    And the delivery is reported as fenced

  @integration @lease-renewal
  Scenario: Renewing a lease is fenced on the lease token
    Given a leased outbox message in Postgres
    When its holder renews the lease
    Then the message stays leased one more lease length from the renewal
    And a renewal by a holder whose lease was taken over is refused and changes nothing

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

  @unit
  Scenario: A message whose ClickHouse is unavailable is retried, never dead-lettered on its first attempt
    Given an outbox message whose dispatch is refused as clickhouse_unavailable over a dropped connection
    When the dispatcher delivers it
    Then it is scheduled for retry with the usual backoff

  @unit
  Scenario: A platform-fault refusal is retried like the group queue retries it
    Given an outbox message whose dispatch is refused with a platform fault and retryable false
    When the dispatcher delivers it
    Then it is scheduled for retry, as the group queue's refusal rule decides

  @unit
  Scenario: A customer-fault refusal is dead on its first attempt
    Given an outbox message whose dispatch is refused with a customer fault and retryable false
    When the dispatcher delivers it
    Then it is dead on its first attempt instead of retrying ten times

  @unit
  Scenario: A redacted delivery failure keeps where it failed in the server log
    Given an outbox message whose handler throws an error we did not write
    When the dispatcher delivers it and the delivery fails
    Then the attempt log records only the redacted sentence
    And the server log records the error's class and stack frames once
    And the server log records neither the error's own message nor the message payload

  @unit
  Scenario: A redacted cause is logged at the level of the delivery outcome
    Given an outbox message whose handler throws an error we did not write
    When the delivery fails with a retry scheduled, or is dead-lettered by a customer fault
    Then the redacted cause is logged at warn level
    But when it is dead-lettered by any other fault it is logged at error level

  @unit
  Scenario: A message dead-lettered by the customer's own setup is logged as a warning
    Given an outbox message whose dispatch is refused with a customer fault
    When it is dead-lettered
    Then the dead-letter is logged at warn level, not error

  @unit
  Scenario: A message dead-lettered by our own or a provider's failure is logged as an error
    Given an outbox message whose dispatch fails with a platform, provider or unattributed fault
    When it is dead-lettered
    Then the dead-letter is logged at error level

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

  @unit @idle-backoff
  Scenario: An idle outbox worker backs off its recovery poll until notified
    Given an outbox worker whose drains lease nothing
    When its recovery polls keep coming back empty
    Then each empty poll doubles the interval to the next poll, up to 30 seconds
    And the next poll is armed only once a drain settles, with the interval that drain chose
    And a drain that fails doubles the interval as an empty poll does, never resetting it
    And a notification drains at once and returns the poll to its base interval
    And a poll that leases a message returns the poll to its base interval
    And a drain that leased a full batch drains again at once instead of waiting a poll

  @unit @notify-on-insert
  Scenario: A commit that inserted no intent does not nudge the outbox
    Given a process manager mounted with consumers enabled
    When an event commits a new state without inserting an intent
    Then its outbox worker is not nudged
    And when an event commits an intent, its outbox worker drains at once

  @unit @notify-on-insert
  Scenario: A wake nudges only the outbox of the process it woke
    Given two process managers mounted on one runtime
    When a wake commits an intent for one of them
    Then only that process manager's outbox worker drains
