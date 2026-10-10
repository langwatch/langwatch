Feature: The scenario:close-stalled-runs upgrade step closes historical stalled runs

  Runs stored before the stall watchdog (ADR-094) existed may never have received
  a terminal event. A background data step on the worker closes every run quiet
  past the backfill staleness threshold; newer runs are the watchdog's. An operator
  re-runs it from Ops > Upgrades (Retry step).

  # services/stalled-runs-backfill.service.ts, declared in scenario.module.ts

  @unit
  Scenario: The background step closes stalled historical runs
    Given simulation runs are stored without a terminal event
    And each has been quiet for longer than the backfill staleness threshold
    When the scenario:close-stalled-runs step runs
    Then each run is finished with status ERROR and reason "stalled"
    And the step reports how many runs it found and closed

  @unit
  Scenario: A dry run of the step closes nothing
    Given stalled historical runs exist
    When the scenario:close-stalled-runs step runs as a dry run
    Then it reports how many runs would be closed
    And no terminal event is written

  @unit
  Scenario: A failed close fails the step so it retries
    Given three stalled historical runs exist
    And the terminal write for one of them fails
    When the scenario:close-stalled-runs step runs
    Then the other two runs are still closed
    And the step fails, so the upgrade runner retries it
