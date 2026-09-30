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

  @unit
  Scenario: The run manager sends cells up to the run's concurrency, then one per finished cell
    Given a run of six cells started with a concurrency of two
    When the run starts and its cells finish one by one
    Then the manager sends two cells, each carrying only its ordinal and phase
    And sends the next cell as each one finishes
    And completes the run finished after the last

  @unit
  Scenario: The run manager opens the comparison cells only once every target cell has finished
    Given a run with two target cells and two comparison cells
    When only the first target cell has finished
    Then no comparison cell is sent
    And both are sent once the second target cell finishes

  @unit
  Scenario: The run manager counts a redelivered finish once
    Given a run with a concurrency of one
    When the same cell's finish is delivered twice
    Then one more cell is sent, not two

  @unit
  Scenario: The run manager stops sending on abort and completes once its cells in flight finish
    Given a run asked to abort with one cell in flight
    When that cell finishes
    Then no further cell is sent
    And the run completes stopped

  @unit
  Scenario: The run manager fails every unfinished cell as lost after the stall window
    Given a run where no cell has finished for fifteen minutes
    When the manager's wake fires
    Then every unfinished cell, sent or not, is failed
    And no further cell is sent

  @unit
  Scenario: A lost cell is failed as experiment_cell_lost
    Given a cell the stall wake gave up on
    When the manager's failure is delivered
    Then the cell finishes failed with code "experiment_cell_lost" in the run's tenant

  @unit
  Scenario: A run started without a plan is folded but never driven
    Given a run started before runs carried a plan
    When the manager sees its start
    Then it sends no cell and arms no wake

  @unit
  Scenario: The worker runs an opened cell by its ordinal and phase
    Given the run manager opened cell 3 of phase 1
    When its intent is delivered
    Then the worker's ExecuteExperimentCell command names only the run, the ordinal and the phase
    And the cell's results and its finish are appended together, results first

  @unit
  Scenario: A cell reads its row, target and evaluators from the run's plan fold
    Given a run whose start carried its plan
    When one of its target cells runs
    Then it dispatches the planned target on the planned row, then that cell's evaluators
    And it appends the target's result and each verdict

  @unit
  Scenario: A cell run twice appends nothing twice
    Given a cell whose command was delivered twice
    When both deliveries append their results
    Then each result and the finish carry the identity their own record command would give them

  @unit
  Scenario: A run's cells run side by side
    Given a run with several cells open
    Then each cell's command queues in its own group and collapses onto one job while queued

  @unit
  Scenario: A cell whose target fails finishes failed with the target's error
    Given the engine fails a cell's target
    Then the cell appends the target's error and runs none of its evaluators
    And it finishes failed while the run carries on

  @unit
  Scenario: A cell whose target was removed since the run started fails, not the run
    Given the saved prompt a target names was deleted after the run started
    When that target's cell runs
    Then it finishes failed with code "experiment_evaluation_reference_not_found" and no result

  @unit
  Scenario: An aborted run's cell stops without running
    Given a run asked to abort
    When one of its cells is delivered
    Then it finishes stopped without dispatching anything

  @unit
  Scenario: A comparison cell reads its row's variant outputs from the run's fold
    Given every target cell of a row has finished with an output
    When the row's comparison cell runs
    Then it judges the folded outputs without re-running any target

  @unit
  Scenario: A comparison cell waits until every target cell's results are folded
    Given a target cell whose finish has not been folded yet
    When a comparison cell of the run is delivered
    Then it throws, and the queue retries it once the fold catches up

  @unit
  Scenario: A comparison cell whose variant has no output finishes skipped with the reason
    Given a row where one variant produced no output
    When the row's comparison cell runs
    Then its verdict column reads why, and the cell finishes skipped

  @unit
  Scenario: A comparison that cannot be built finishes skipped without waiting
    Given a comparison with fewer than two variants, known when the run started
    When its cell runs
    Then it finishes skipped with the reason, reading no progress

  @unit
  Scenario: A verdict carries every detail its frame showed
    Given an evaluator that spends, and one that fails
    When their cells record the verdicts
    Then the scored verdict keeps its cost currency
    And the failed verdict keeps its error type, traceback and code, under its own evaluator

  @integration
  Scenario: A streamed workbench run executes on the worker and ends with done
    Given the experiment module installed in an api and a worker sharing one event store
    When the workbench posts one row against one prompt target to execute
    Then the stream carries the cell's result frames in order, produced by the worker's cell command
    And it ends with done carrying the run's summary

  @integration
  Scenario: A polled run answers at once and is read back completed from the fold
    Given a saved workbench with one row and one prompt target
    When the run is started without accepting events
    Then it answers the run id, the total and the link at once
    And polling the run reads it as completed once the worker has finished its cells

  @integration
  Scenario: The worker runs a requested workflow evaluation to completion
    Given the experiment module installed in the worker with a committed workflow
    When a workflow evaluation is requested for a registered run
    Then the worker starts the run on its pipeline and it completes for the poller to read

  @integration
  Scenario: A workflow evaluation the worker cannot prepare completes as failed with its code
    Given a workflow evaluation requested for a workflow with no committed version
    When the worker prepares the run
    Then the run completes as failed carrying the refusal's code
    And no cell is executed

  @integration
  Scenario: Cells of one run never exceed its concurrency
    Given a run of six cells started with a concurrency of two
    When the worker executes it
    Then at most two of its cells are in flight at any moment
    And every cell finishes and the run completes

  @integration
  Scenario: Comparison cells run only after every target cell has finished
    Given a run with two targets and a pairwise comparison evaluator
    When the worker executes it
    Then the run's total counts the comparison cells from the start
    And no comparison cell starts before both targets' cells have finished for every row
    And each comparison reads the targets' outputs the run has folded

  @integration
  Scenario: A comparison row whose variant produced no output finishes skipped
    Given a run with a pairwise comparison where one target fails on a row
    When the worker reaches that row's comparison cell
    Then the comparison records its skip as an evaluator error naming the missing variant
    And the cell finishes skipped and the run completes

  @integration
  Scenario: A comparison that cannot be built is skipped for every row
    Given a run whose comparison evaluator names fewer than two variants
    When the run is planned
    Then every row's comparison cell carries the setup skip
    And each finishes skipped with the setup error, without reaching an evaluator

  @integration
  Scenario: Aborting a running run stops its remaining cells
    Given a run in flight with cells still to execute
    When its project asks to abort it
    Then the cells not yet dispatched finish as stopped without reaching a target
    And no comparison cell is planned
    And the stream ends with stopped and the fold reads the run as stopped

  @integration
  Scenario: Aborting a run of another project is refused as not found
    Given a run in flight in one project
    When another project asks to abort it
    Then the abort is refused as run_not_found
    And the run carries on

  @integration
  Scenario: A run against someone else's personal agent is refused before any cell
    Given a workbench whose target is another person's personal development agent
    When the workbench posts it to execute
    Then the run is refused as agent_owner_only
    And no run is started and no cell command is sent

  @integration
  Scenario: A redelivered cell counts once
    Given a run whose cell command and cell finish are each delivered twice
    When the worker executes it
    Then the run's progress ends at its total and not beyond
    And each result is recorded once

  @integration
  Scenario: A cell lost with its worker fails once the run stalls, and the run completes with errors
    Given a run with a cell whose command never finishes
    When no cell of the run has finished for the stall window
    Then the manager fails every unfinished cell as experiment_cell_lost
    And the run completes with those cells counted as failed

  @integration
  Scenario: A failing target is a failed cell, not a failed run
    Given a run whose target answers an error for one row
    When the worker executes it
    Then that cell finishes as failed with the error on its result
    And the other cells finish and the run completes

  @integration
  Scenario: A cell is priced and lent the project's sandbox key
    Given a run whose target executes code on a model the engine reports untariffed
    When the worker executes the cell
    Then the cell's result carries the price from the project's cost rule
    And the code ran with the project's sandbox key

  @integration
  Scenario: A run past the row bound is refused before it starts
    Given a dataset with more rows than the project's tier allows in one run
    When a run over it is started
    Then it is refused as experiment_evaluation_too_many_rows
    And no run is started

  # The SSE push path's worker half (spec section 7); bound to the frame rules and the channel.
  @unit
  Scenario: A run's recorded events stream as main's SSE frames
    Given a run whose start is recorded with its total
    When the event is read back as frames
    Then it is main's execution_started frame with the run's id and total

  @unit
  Scenario: A board cell carried into a run is not streamed
    Given a target result copied into the run from the board
    When the event is read back as frames
    Then no frame is streamed for it, as main streamed none

  @unit
  Scenario: A stopped run's stream ends stopped, and a failed run's with main's error frame
    Given a run completed as stopped, and another completed as failed with a handled error
    When their completions are read back as frames
    Then the stopped run streams main's stopped frame
    And the failed run streams main's error frame carrying the error's code

  @unit
  Scenario: A run's frames reach the stream that subscribed to the run, and no other
    Given a stream subscribed to one run and another subscribed to a second run
    When frames are published for the first run
    Then the first stream hears them in order and the second hears none

  # The progress fold as main's poller JSON, and the frames it publishes (spec section 7).
  @unit
  Scenario: A run's live frames are published from its progress fold with their seq
    Given a planned run whose progress fold has folded a cell's finish
    When the fold's frames subscriber handles that event
    Then it publishes main's progress frame with the run's counts, numbered by the fold's seq
    And a redelivered finish counts nothing and streams nothing again

  @unit
  Scenario: A poll reads a pipeline run's status and counts from its progress fold
    Given a planned run whose cells finish, one of them failed and one finish redelivered
    When the progress fold folds them
    Then it reads as running with each cell counted once and the failure counted apart
    And once the run finishes it reads as completed with main's summary and the run's link

  @unit
  Scenario: A run's progress is read by its runId alone
    Given a planned run's progress stored under main's poller key
    When it is read by the run's id
    Then it is found, and another experiment's run with the same id reads as empty

  # The start path (switchover step 5a, spec sections 7 and 9).
  @integration
  Scenario: A streamed workbench run subscribes to its frames, then starts on the run's pipeline
    Given a workbench run posted to execute
    When the api plans it and sends its start
    Then the start carries the plan, credited to the person who posted it
    And the stream carries the run's frames once each, in seq order, and ends with done

  @integration
  Scenario: A workbench run against someone else's personal agent streams its refusal and starts nothing
    Given a workbench whose target is another person's personal development agent
    When the workbench posts it to execute
    Then the stream carries main's error frame with code "agent_owner_only"
    And no start is sent

  @unit
  Scenario: A run's cells land on the board before it is completed
    Given a finished or stopped run that writes its results back
    When the run manager completes it
    Then the run's result frames are merged into the board, credited to whoever the plan credits
    And only then is the run completed
    And a run that keeps its results off the board writes nothing

  @unit
  Scenario: The board write waits until the progress fold has every finished cell
    Given a run whose manager counted more finished cells than its progress fold has folded
    When the completion is delivered
    Then it throws and is retried, writing and completing nothing
    And its last attempt writes what is folded and completes the run

  # Polls, abort and saved runs over the pipeline (switchover step 5b, spec sections 6, 7 and 9).
  @integration
  Scenario: A poll answers main's poller body from the run's progress fold
    Given a run whose progress fold reads it running, and another whose fold reads it completed
    When each is polled by its runId
    Then the running run answers its progress only
    And the completed run answers its finish and main's summary with the run's link
    And a run the fold does not hold, or holds for another project, answers run_not_found

  @integration
  Scenario: Aborting a run reads its progress fold and refuses another project's run
    Given a run in flight whose progress fold names its project and experiment
    When another project asks to abort it
    Then it is refused as run_not_found and nothing is stopped
    When its own project asks to abort it
    Then the run's stop flag is set and the abort is sent under the fold's experiment

  @integration
  Scenario: A polled saved run starts on the run's pipeline and answers at once
    Given a saved workbench and a caller that does not accept events
    When the run is started by slug
    Then the start carries a saved-origin plan that writes the board, credited to the key's person
    And it answers main's body with the run id, the total and the link to its results

  @integration
  Scenario: A polled saved run against someone else's personal agent is stored failed
    Given a saved workbench whose target is another person's personal development agent
    When the run is started by slug without accepting events
    Then it answers started as main did, sends no start
    And the run is completed failed carrying the refusal's code for the poller

  @integration
  Scenario: A polled saved run answers as soon as its start command is written
    Given a saved workbench and a worker that has not folded the run's start
    When the run is started by slug without accepting events
    Then it answers 200 with the run id at once, the start sent once
    And a poll straight after the answer reads the run running with no progress and its planned total

  @integration
  Scenario: A started run the worker has not folded is not readable by another project
    Given a run started by slug that the worker has not folded
    When another project polls it or asks to abort it
    Then each is refused as run_not_found and nothing is stopped

  @integration
  Scenario: A started run the worker has not folded can be aborted by its own project
    Given a run started by slug that the worker has not folded
    When its own project asks to abort it
    Then the run's stop flag is set and the abort is sent under the run's experiment

  @integration
  Scenario: A started run the worker has since folded is polled from its fold
    Given a run started by slug whose progress fold now holds its progress
    When it is polled by its runId
    Then it answers the fold's progress, not the recorded start

  @unit
  Scenario: A polled run refused before its start polls failed with its planned total
    Given a run refused before its start whose refusal carries the planned total
    When its completion is folded
    Then the poller reads it failed with the refusal's code and that total

  @unit
  Scenario: A run refused before its start leaves no run row
    Given a run that folded only its failed completion
    When its run state is stored
    Then no ClickHouse run row is written, as main wrote none
    And a run that started and then failed still writes its row

  @integration
  Scenario: A streamed saved run starts on the run's pipeline and streams its frames
    Given a saved workbench and a caller that accepts events
    When the run is started by slug
    Then the start carries a saved-origin plan that leaves the board alone and names no link
    And the stream carries the run's frames until done

  @unit
  Scenario: A cell's start is published on the run's channel with the last folded seq
    Given a cell whose run's progress fold has numbered its frames up to a seq
    When the cell starts
    Then main's cell_started frame is published on the run's channel carrying that seq
    And nothing is appended or folded for it

  @integration
  Scenario: A streamed run passes a cell's start through without deduplicating it
    Given a run whose channel carries a cell_started frame repeating the last folded seq
    When the run streams
    Then the cell_started frame reaches the client, and a repeated folded frame does not

  @unit
  Scenario: A redelivered completion writes the run's cells to the board once
    Given a run whose board write already landed, and a later run that wrote the board since
    When its completion is delivered again
    Then the board's version history holds the run, so the board is not written again
    And the later run's results stay on the board

  # The run's plan, built in the request before StartExperimentRun (spec sections 2, 4 and 8, D4, D5).
  @unit
  Scenario: A run's plan lists its target cells, then its comparison cells, in one ordinal order
    Given a full run over two targets with a comparison between them
    When its plan is built
    Then its target cells come first, row by row, each with its non-comparison evaluators
    And one comparison cell per row follows them, numbered on from the last target cell
    And every row a cell touches is kept once, and mappings read from the active dataset

  @unit
  Scenario: A run's plan pins each prompt and workflow at the version the run loaded
    Given a prompt target and a workflow target loaded at their current versions
    When the run's plan is built
    Then the plan pins each target to the version that was loaded

  @unit
  Scenario: A comparison that cannot be built is planned skipped for every row it covers
    Given a comparison with too few variants, no golden field, or a variant that no longer exists
    When the run's plan is built
    Then each non-empty row in scope has a comparison cell carrying that setup skip
    And a chip comparison's cells sit under its first column that still exists

  @unit
  Scenario: A run scoped to some rows plans only those rows
    Given a run scoped to rows 2 and 0 of three
    When its plan is built
    Then its target and comparison cells cover only those rows, in the order asked
    And a target whose output a scoped comparison reuses is not run again

  @unit
  Scenario: An evaluator re-run plans its precomputed outputs and no comparison
    Given an evaluator re-run over outputs the targets already produced
    When its plan is built
    Then each output is a cell that skips its target and carries the output and its trace
    And no comparison cell is planned

  @unit
  Scenario: A run's plan credits whoever started it and names its slug and link
    Given a run started by a person, a Langy session or a key that names no person
    When its plan is built
    Then the plan credits each as it was
    And it carries the experiment's slug and the run's link for the poller

  @unit
  Scenario: The comparison set is planned from the run's configuration alone
    Given a chip comparison and a column comparison, and no target output yet
    When the comparison set is built
    Then each comparison is listed under its verdict column with the rows in scope it covers
