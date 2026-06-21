Feature: Queued scenario run orphan recovery

  When a scenario worker restarts (it recycles itself after a maximum runtime,
  or it crashes), any scenario runs it was about to execute or had already
  started can be left behind. Before this recovery existed, those runs stayed
  QUEUED forever: no terminal event was ever written, so the suites page kept
  polling a run that no living worker would ever finish.

  Recovery has two layers. The first is graceful: when a worker shuts down it
  marks every run it still owns as failed before it goes away, so the common
  case (a planned max-runtime restart) never orphans anything. The second is a
  safety net for hard kills (OOM, SIGKILL) where the worker has no chance to
  clean up: on startup a worker looks for runs that have sat QUEUED with no
  progress for too long and marks them failed so the user sees a terminal
  result instead of a spinner.

  A freshly queued run is never touched by recovery — only runs that have been
  abandoned long enough to prove no worker is coming for them.

  Background:
    Given scenario runs are executed by worker processes
    And a scenario run is marked QUEUED when it is accepted for execution
    And a worker recycles itself after it reaches its maximum runtime

  # ---------------------------------------------------------------------------
  # Layer 1: graceful drain on worker restart
  # ---------------------------------------------------------------------------

  @unit
  Scenario: In-flight runs are failed when the worker restarts
    Given a worker is executing one scenario run and has another buffered
    When the worker reaches its maximum runtime and begins shutting down
    Then both runs are marked failed before the worker restarts
    And neither run is left QUEUED

  # ---------------------------------------------------------------------------
  # Layer 2: startup reconciler for hard kills
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A long-abandoned queued run is reconciled to failed on startup
    Given a scenario run has been QUEUED with no progress for longer than the orphan threshold
    And no worker is currently executing it
    When a worker starts up and reconciles orphaned queued runs
    Then the run is marked failed

  @unit
  Scenario: A freshly queued run is not failed by the reconciler
    Given a scenario run was queued moments ago
    When a worker starts up and reconciles orphaned queued runs
    Then the run is left QUEUED
    And it is not marked failed
