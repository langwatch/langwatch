Feature: An experiment run executes on its pipeline

  A run is started by a command and executed by the worker, never inside the request that asked
  for it. The run's process manager sends one cell at a time up to the run's concurrency, each
  cell appends its results and its finish, and the run's projections fold the progress that the
  event stream and the poller read. Design: experiment-run-execution.md.

  # Bound to the collaborators the cell command keeps (spec section 8); rebind when they move.
  @unit
  Scenario: A process without Redis refuses to start a run by name
    Given a process with no Redis
    When a run is started
    Then it is refused as service_unavailable naming the progress store
    And no run loop is composed

  @unit
  Scenario: A process without a public address refuses to start a run but still answers polls
    Given a process with Redis but no public address
    When a run is started
    Then it is refused as service_unavailable naming the public address
    But a poll still reads the run's progress from Redis

  @unit
  Scenario: A run's stop signal is shared through the deployment's Redis
    Given a process with Redis and a public address
    When a stop is requested for a run
    Then the run reads the stop from Redis, and another run does not

  @unit
  Scenario: A cell is priced at the project's own cost rule before the catalogue
    Given a project with its own cost rule for a model
    When a cell of that model is priced
    Then the project's rates are handed to the price cascade as the custom rate

  @unit
  Scenario: A run lends the project's shared sandbox key to the code it executes
    Given a project whose organization can mint a sandbox key
    When a run executes code
    Then the run lends the project's sandbox key

  @unit
  Scenario: A run whose sandbox key cannot be minted still runs without one
    Given a project whose sandbox key mint refuses
    When a run executes code
    Then the run lends no key and is not stopped

  @unit
  Scenario: A run carries its plan in its start, and a run started before the pipeline still reads
    Given a run started with its plan of target and comparison cells
    When its start is read back
    Then the plan's cells are in ordinal order, phase 1 before phase 2
    And a start recorded before runs carried a plan still reads, with no plan

  @unit
  Scenario: A run without an experiment is keyed by its run id and writes no ClickHouse rows
    Given a run started with no experiment
    When its events are keyed and projected
    Then its aggregate is its run id alone
    And neither its run row nor its result rows are written to ClickHouse

  @unit
  Scenario: A cell failed as lost that finishes after all is recorded once
    Given a cell the stall wake failed as lost
    When the same cell's own finish arrives later
    Then both carry one idempotency key, so the second is dropped

  @unit
  Scenario: An abort is recorded once however often it is asked for
    Given a run a project asks to abort twice
    When both requests are recorded
    Then both carry one idempotency key on the run's own aggregate

  @unit
  Scenario: A run's cell window defaults to main's concurrency knob
    Given a deployment that names EVAL_V3_CONCURRENCY
    When the experiment config is read
    Then a run with no limit of its own uses that many cells at once
    And a deployment that names none uses ten

  @integration @unimplemented
  Scenario: A streamed workbench run executes on the worker and ends with done
    Given the experiment module installed in an api and a worker sharing one event store
    When the workbench posts one row against one prompt target to execute
    Then the stream carries the cell's result frames in order, produced by the worker's cell command
    And it ends with done carrying the run's summary

  @integration @unimplemented
  Scenario: A polled run answers at once and is read back completed from the fold
    Given a saved workbench with one row and one prompt target
    When the run is started without accepting events
    Then it answers the run id, the total and the link at once
    And polling the run reads it as completed once the worker has finished its cells

  @integration @unimplemented
  Scenario: The worker runs a requested workflow evaluation to completion
    Given the experiment module installed in the worker with a committed workflow
    When a workflow evaluation is requested for a registered run
    Then the worker starts the run on its pipeline and it completes for the poller to read

  @integration @unimplemented
  Scenario: A workflow evaluation the worker cannot prepare completes as failed with its code
    Given a workflow evaluation requested for a workflow with no committed version
    When the worker prepares the run
    Then the run completes as failed carrying the refusal's code
    And no cell is executed

  @integration @unimplemented
  Scenario: Cells of one run never exceed its concurrency
    Given a run of six cells started with a concurrency of two
    When the worker executes it
    Then at most two of its cells are in flight at any moment
    And every cell finishes and the run completes

  @integration @unimplemented
  Scenario: Comparison cells run only after every target cell has finished
    Given a run with two targets and a pairwise comparison evaluator
    When the worker executes it
    Then the run's total counts the comparison cells from the start
    And no comparison cell starts before both targets' cells have finished for every row
    And each comparison reads the targets' outputs the run has folded

  @integration @unimplemented
  Scenario: A comparison row whose variant produced no output finishes skipped
    Given a run with a pairwise comparison where one target fails on a row
    When the worker reaches that row's comparison cell
    Then the comparison records its skip as an evaluator error naming the missing variant
    And the cell finishes skipped and the run completes

  @integration @unimplemented
  Scenario: A comparison that cannot be built is skipped for every row
    Given a run whose comparison evaluator names fewer than two variants
    When the run is planned
    Then every row's comparison cell carries the setup skip
    And each finishes skipped with the setup error, without reaching an evaluator

  @integration @unimplemented
  Scenario: Aborting a running run stops its remaining cells
    Given a run in flight with cells still to execute
    When its project asks to abort it
    Then the cells not yet dispatched finish as stopped without reaching a target
    And no comparison cell is planned
    And the stream ends with stopped and the fold reads the run as stopped

  @integration @unimplemented
  Scenario: Aborting a run of another project is refused as not found
    Given a run in flight in one project
    When another project asks to abort it
    Then the abort is refused as run_not_found
    And the run carries on

  @integration @unimplemented
  Scenario: A run against someone else's personal agent is refused before any cell
    Given a workbench whose target is another person's personal development agent
    When the workbench posts it to execute
    Then the run is refused as agent_owner_only
    And no run is started and no cell command is sent

  @integration @unimplemented
  Scenario: A redelivered cell counts once
    Given a run whose cell command and cell finish are each delivered twice
    When the worker executes it
    Then the run's progress ends at its total and not beyond
    And each result is recorded once

  @integration @unimplemented
  Scenario: A cell lost with its worker fails once the run stalls, and the run completes with errors
    Given a run with a cell whose command never finishes
    When no cell of the run has finished for the stall window
    Then the manager fails every unfinished cell as experiment_cell_lost
    And the run completes with those cells counted as failed

  @integration @unimplemented
  Scenario: A failing target is a failed cell, not a failed run
    Given a run whose target answers an error for one row
    When the worker executes it
    Then that cell finishes as failed with the error on its result
    And the other cells finish and the run completes

  @integration @unimplemented
  Scenario: A cell is priced and lent the project's sandbox key
    Given a run whose target executes code on a model the engine reports untariffed
    When the worker executes the cell
    Then the cell's result carries the price from the project's cost rule
    And the code ran with the project's sandbox key

  @integration @unimplemented
  Scenario: A run past the row bound is refused before it starts
    Given a dataset with more rows than the project's tier allows in one run
    When a run over it is started
    Then it is refused as experiment_evaluation_too_many_rows
    And no run is started
