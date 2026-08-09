Feature: Process-manager inbox and outbox rows are reaped on a schedule
  As the platform
  I want completed process-manager bookkeeping to be deleted on a schedule
  So that a high-frequency process manager cannot fill the database forever

  # The process-manager substrate (ADR-049 §5, ADR-052) writes three durable
  # tables. Two of them grow with TRAFFIC and had no deletion path at all:
  #
  #   ProcessManagerInbox   one row per consumed source event, the idempotency
  #                         marker. Nothing deleted these, ever.
  #   ProcessManagerOutbox  one row per intent. Only `deleteDispatchedBefore`
  #                         existed, it took a single processName, and half the
  #                         registered process managers never called it.
  #
  # In production that produced 2.8M inbox rows and 473k outbox rows in twenty
  # days, of which 99.98% of the outbox rows were `dispatched` (completed work
  # kept forever). See dev/docs/runbooks/process-manager-table-purge.md for the
  # one-time backlog purge that preceded this sweep.
  #
  # This sweep replaces per-process opt-in retention with one scheduled
  # singleton that reaps by PREDICATE across every processName. That is what
  # makes it cover the processes nobody remembered to register, and every
  # future one, with no registration step to forget.
  #
  # WHY 7 DAYS IS SAFE FOR THE INBOX. An inbox row only has to outlive the
  # window in which the same source event could be redelivered. The origin
  # guards reject events older than 1 hour and traces older than 24 hours, the
  # evaluation subscriber uses the same 1 hour cutoff, and the longest debounce
  # bucket is 600 seconds. That puts the redelivery horizon at about 25 hours.
  # Seven days is a wide margin over it, and the `TriggerSent` claim is a second
  # layer against a double side effect even if a marker were somehow dropped
  # early.
  #
  # EXPLICIT NON-GOAL: ProcessManagerInstance is not swept. It is bounded by
  # entity population rather than by traffic, and deleting an instance row
  # resets its revision and state, which is a correctness hazard rather than a
  # cleanup. It stays out of scope until something makes it grow.

  Rule: The sweep deletes completed bookkeeping and nothing else

    @integration
    Scenario: Dispatched outbox rows past the retention window are deleted
      Given dispatched outbox rows older than the dispatched retention window
      When the retention sweep runs
      Then those rows are deleted
      And dispatched rows inside the window are kept

    @integration
    Scenario: Pending outbox rows are never swept
      Given a pending outbox row older than every retention window
      When the retention sweep runs
      Then the pending row is still there
      And it is still leasable for dispatch

    @integration
    Scenario: Dead outbox rows are kept far longer than dispatched ones
      Given a dead outbox row older than the dispatched retention window
      And a dead outbox row older than the dead retention window
      When the retention sweep runs
      Then only the row past the dead retention window is deleted

    @integration
    Scenario: Consumed inbox rows past the retention window are deleted
      Given consumed inbox rows older than the inbox retention window
      When the retention sweep runs
      Then those rows are deleted
      And inbox rows inside the window are kept

    @integration
    Scenario: The sweep reaches process names that never registered retention
      Given dispatched outbox rows belonging to several different process names
      When the retention sweep runs
      Then rows of every one of those process names are deleted
      And no process name has to opt in to be covered

    @integration
    Scenario: Process instances are left alone
      Given a process instance whose rows the sweep deleted
      When the retention sweep runs
      Then the instance row is untouched
      And its revision is unchanged

  Rule: One wake is bounded so the sweep cannot monopolise the database

    @unit
    Scenario: A wake stops at its batch budget
      Given more expired rows than one wake is allowed to delete
      When the sweep wakes
      Then it deletes at most its per-wake budget
      And it leaves the rest for the next wake

    @unit
    Scenario: A family that runs dry ends its drain loop early
      Given fewer expired rows than one batch holds
      When the sweep wakes
      Then it stops asking for more batches of that family
      And it does not issue a delete that would match nothing

    @unit
    Scenario: One family failing does not stop the others
      Given the dispatched-outbox delete fails
      When the sweep wakes
      Then the inbox and dead-outbox families are still swept
      And the failure is reported without failing the wake

    @unit
    Scenario: The sweep reports how much it deleted per table
      Given expired rows in more than one family
      When the sweep wakes
      Then the totals it reports name the table each count belongs to
