Feature: Queued scenario run orphan recovery

  When a scenario worker restarts (it recycles itself after a maximum runtime,
  or it crashes), any scenario runs it was about to execute or had already
  started can be left behind. Before this recovery existed, those runs stayed
  QUEUED forever: no terminal event was ever written, so the suites page kept
  polling a run that no living worker would ever finish.

  Recovery now has two layers. The primary mechanism is the durable
  simulation_run_execution process manager (ADR-094): every queued run gets a
  per-run process instance whose execute intent rides the leased PG outbox
  (retried until dispatched — a worker restart cannot lose it) and whose stall
  watchdog wake force-finishes the run ERROR "stalled" once it has been quiet
  past STALL_THRESHOLD_MS. The second layer is graceful: when a worker shuts
  down it marks every run it still owns as failed before it goes away, so the
  common case (a planned max-runtime restart) never orphans anything.

  Runs queued BEFORE the process manager existed have no process instance, so
  no watchdog covers them: they may remain non-terminal. That is an accepted
  deployment-window loss — the legacy boot-time startup reconciler
  (scenario-orphan-reconciler.ts) that used to sweep them was deleted outright
  rather than kept for a deprecation cycle.

  A freshly queued run is never touched by recovery — only runs that have been
  abandoned long enough to prove no worker is coming for them.

  Background:
    Given scenario runs are executed by worker processes
    And a scenario run is marked QUEUED when it is accepted for execution
    And a worker recycles itself after it reaches its maximum runtime

  # ---------------------------------------------------------------------------
  # Layer 0 (primary): process manager stall watchdog + durable execute intent
  # ---------------------------------------------------------------------------

  @unit @unimplemented
  Scenario: A queued run whose execute intent never lands is finished as stalled
    Given a scenario run has been QUEUED with no activity for longer than the stall threshold
    When the process manager's stall watchdog wake fires
    Then the run is finished with status ERROR and reason "stalled"

  @unit @unimplemented
  Scenario: The execute intent survives a worker restart
    Given a queued run's execute intent is persisted in the process manager outbox
    When the worker restarts before the intent is dispatched
    Then the outbox retries the intent until the job reaches the execution pool

  # ---------------------------------------------------------------------------
  # Layer 1: graceful drain on worker restart
  # ---------------------------------------------------------------------------

  @unit
  Scenario: In-flight runs are failed when the worker restarts
    Given a worker is executing one scenario run and has another buffered
    When the worker reaches its maximum runtime and begins shutting down
    Then both runs are marked failed before the worker restarts
    And neither run is left QUEUED

  @unit
  Scenario: A cancelled in-flight run is preserved as cancelled, not failed
    Given a worker is executing a scenario run that was cancelled before it finished
    When the worker begins shutting down
    Then the run is marked cancelled
    And it is not marked failed
