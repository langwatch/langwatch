Feature: A scheduled maintenance process keeps its own deadline
  As the platform
  I want a fixed-interval maintenance process to come due on its interval
  So that the housekeeping it owns actually runs, however often workers restart

  # These schedules are the only mechanism behind a class of housekeeping the
  # platform used to leave to cron jobs that were never deployed — pruning
  # delivery history, sweeping unreferenced blobs, reaping expired session
  # keys. Each one is a singleton process holding a single deadline, and the
  # only thing that moves that deadline forward is the work itself completing.
  #
  # A worker boot gives a schedule its FIRST deadline and nothing more. That
  # distinction is the whole feature: arming on every boot recomputes the
  # deadline from the present, so any interval longer than the gap between
  # worker boots is pushed forward before it ever matures. Nothing fails, no
  # count moves — the work simply never happens, and the first symptom is a
  # table that has been growing for months.
  #
  # See ADR-049 (the process-manager substrate) and ADR-051 (durable wakes).

  Background:
    Given a maintenance process that runs on a fixed interval
    And a fleet whose workers restart on their own schedule

  @unit
  Scenario: a schedule with no deadline yet is armed by a worker boot
    Given a maintenance process that has never been armed
    When a worker boots
    Then the process is given a deadline one interval away

  @unit
  Scenario: a schedule longer than the gap between worker boots still comes due
    Given a maintenance process whose interval is a day
    And workers that boot more than once a day
    When the deadline passes
    Then the maintenance work runs
    And the deadline that was already set is never pushed forward by a boot

  @unit
  Scenario: a schedule that cannot be armed leaves the worker running
    Given a maintenance process whose arming fails
    When a worker boots
    Then the failure is reported to operators
    And the worker starts anyway, and the next boot arms the schedule
