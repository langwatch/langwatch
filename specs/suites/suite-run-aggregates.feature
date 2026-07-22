Feature: Suite run progress is derived from its simulation runs
  A suite run is a group of simulation runs sharing a batch. Its progress and
  outcome are computed from those runs when they are read, not accumulated
  into a separate record, so a lost or repeated update cannot change what the
  user sees. (ADR-061; run liveness per ADR-062.)

  Background:
    Given a suite with scenarios and targets

  # --- Derivation ---

  Scenario: Batch progress reflects the simulation runs in the batch
    Given a suite run whose scenarios have partly finished
    When the user opens the suite's run history
    Then the passed, failed and running counts match its simulation runs
    And a cancelled run is counted as failed rather than passed

  Scenario: A repeated run update does not inflate progress
    Given a suite run with one finished scenario
    When that scenario's state is recorded more than once
    Then the batch still reports one finished run

  Scenario: A corrected simulation run changes the batch immediately
    Given a batch showing a failed scenario
    When that scenario's run is later recorded as succeeded
    Then the batch reflects the success on the next read
    And no projection has to be rebuilt

  Scenario: Archived runs are left out of the batch
    Given a batch containing an archived scenario run
    When the user opens the suite's run history
    Then the archived run is not counted

  # --- Outcome ---

  Scenario: A batch is unfinished while any scenario is still in flight
    Given a batch with one scenario still running
    When the user opens the suite's run history
    Then the batch is reported as still running

  Scenario: A batch finishes when every scenario has finished
    Given a batch whose scenarios have all reached a terminal state
    When the user opens the suite's run history
    Then the batch reports a completion time

  # --- The denominator ---

  Scenario: The expected total is known from the first run in the batch
    Given a suite run whose scenarios are still being queued
    When the user opens the suite's run history
    Then the expected total is the size of the whole batch
    And it does not grow as the remaining scenarios appear

  Scenario: A partly dispatched batch reports a shortfall
    Given a suite run where one scenario was never queued
    When the user opens the suite's run history
    Then the batch reports fewer runs than were expected

  Scenario: A batch from before the total was recorded counts its runs
    Given a batch recorded without an expected total
    When the user opens the suite's run history
    Then the expected total is the number of simulation runs in the batch

  # --- No second record ---

  Scenario: Starting and finishing a scenario writes no suite-level record
    Given a scenario belonging to a suite
    When it starts and later finishes
    Then no separate suite-run record is written for it
    And the batch's progress is still readable
