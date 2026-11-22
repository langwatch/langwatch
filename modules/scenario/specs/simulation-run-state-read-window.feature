Feature: Reading a scenario run's state reads only the weeks around its start

  Every event a scenario run receives reads the run's current state back before
  it folds. simulation_runs is partitioned by the week the run started, so a
  read with no time bound opens every week the tenant ever ran. The fold
  declares a read window around the event's time; the read is bounded to that
  window in both the latest-version lookup and the row read. A run the window
  misses is still found, because the platform retries the read without the
  window (fold-read-window.feature). A read with no window is unbounded, as
  before.

  # simulation-run-state.projection.ts (options.readWindow),
  # clickhouse.simulation-run-state.repository.ts (findProjection),
  # packages/eventing repositoryFoldStore.ts (forwards the window)

  @unit
  Scenario: The scenario-run fold declares a read window around each event
    Given the scenario-run state fold
    When an event of a run is folded
    Then the run's state is read back within a window around the event's time

  @unit
  Scenario: A windowed read of a run bounds both the latest-version lookup and the row read by start time
    Given a read window around an event's time
    When the run's state is read
    Then the row read is bounded by start time to the window
    And the latest-version lookup is bounded by start time to a wider window around it
    And a read without a window carries no start-time bound

  @integration
  Scenario: A run that started inside the window is found by the bounded read
    Given a run whose start lies inside the read window
    When its state is read with the window
    Then the run's latest state is returned

  @integration
  Scenario: A run that started outside the window is still found by the fold
    Given a run whose start lies weeks before the event being folded
    When the run's next event is folded
    Then the windowed read misses and the fold reads the run again without the window
    And the event is folded onto the run's stored state, not onto an empty run

  @integration
  Scenario: A run whose start moved out of the window reads as a miss, never as an older version
    Given a run whose older version started inside the read window
    And whose latest version started just outside it
    When its state is read with the window
    Then nothing is returned, so the fold retries without the window
    And the older version is never returned as the run's state

  @integration
  Scenario: The bounded read searches fewer parts than an unbounded read
    Given a tenant whose runs started across many weeks
    When one run's state is read with the window and then without it
    Then the windowed read searches only the parts of the weeks around the event
    And the unbounded read searches the parts of every week
